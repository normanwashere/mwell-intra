import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllocationsPage } from './AllocationsPage';
import { ExceptionsPage } from './ExceptionsPage';
import { TasksPage } from './TasksPage';
import { OperationRoutesPage } from './OperationRoutesPage';
import { QualityPage } from './QualityPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { buildNotifications } from '@/app/notifications';
import type { QualityInspectionSummary, StockChangeRequest, WarehouseException } from '@intra/data-kit';

const inspection: QualityInspectionSummary = {
  id: 'inspection/second', sourceType: 'receipt', sourceId: 'receipt-second',
  productId: 'shirt-l', quantity: 2, disposition: 'pending', inspectedBy: 'receiver',
  inspectedAt: '2026-11-05T00:00:00Z', evidenceCount: 0,
};
const exception: WarehouseException = {
  id: 'exception-second', type: 'count_variance', severity: 'P2',
  sourceType: 'stock_change_request', sourceId: 'request-second', status: 'open',
  createdAt: '2026-11-05T00:00:00Z',
};
const request: StockChangeRequest = {
  id: 'request-second', sourceType: 'cycle_count', sourceId: 'count/second',
  productId: 'shirt-l', locationId: 'loc-wh', quantityDelta: -1, unitCost: 1,
  financialImpact: 1, reason: 'Recount', evidenceUrls: [], status: 'pending_supervisor',
  requestedBy: 'counter', requestedAt: '2026-11-05T00:00:00Z', canDecide: false,
};

async function identityRepo() {
  const data = await makeRepo().getData();
  data.products.find(p => p.id === 'shirt-l')!.name = 'Same name product';
  data.products.find(p => p.id === 'shirt-l')!.sku = 'SAME-L';
  data.products.find(p => p.id === 'doctor-token')!.name = 'Same name product';
  data.products.find(p => p.id === 'doctor-token')!.sku = 'SAME-S';
  data.allocations = [
    { id: 'allocation-first', productId: 'doctor-token', eventId: data.events[0]!.id, quantity: 1, status: 'reserved', createdAt: '2026-11-05' },
    { id: 'allocation/second', productId: 'shirt-l', eventId: data.events[0]!.id, quantity: 2, status: 'returned', createdAt: '2026-11-05' },
  ];
  data.receipts = [{ id: 'receipt-second', locationId: 'loc-wh', deliveryReference: 'DR-SECOND',
    lines: [{ productId: 'shirt-l', quantity: 2 }], actor: 'receiver', createdAt: '2026-11-05T00:00:00Z' }];
  data.returns = [];
  const repo = makeRepo(data);
  vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [inspection] });
  vi.spyOn(repo, 'listExceptions').mockResolvedValue({ rows: [exception] });
  vi.spyOn(repo, 'listStockChangeRequests').mockResolvedValue({ rows: [request] });
  return { repo, data };
}

describe('F13-F15 navigation identity', () => {
  it('cold-opens and reloads the exact allocation read-only, including historical status', async () => {
    const { repo } = await identityRepo();
    const issue = vi.spyOn(repo, 'issue'), cancel = vi.spyOn(repo, 'cancelAllocation'), reserve = vi.spyOn(repo, 'reserveBatch');
    const before = await repo.getData();
    const route = '/allocations?allocation=allocation%2Fsecond';
    const view = renderWithProviders(<AllocationsPage />, { repo, role: 'warehouse_operator', route });
    const row = await screen.findByRole('listitem', { name: 'Allocation allocation/second' });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(within(row).getByText('SAME-L', { exact: false })).toBeVisible();
    expect(screen.queryByText('SAME-S', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
    renderWithProviders(<AllocationsPage />, { repo, role: 'warehouse_operator', route });
    expect(await screen.findByRole('listitem', { name: 'Allocation allocation/second' })).toHaveAttribute('aria-current', 'true');
    expect(issue).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
    expect(await repo.getData()).toEqual(before);
  });

  it.each(['missing', ''])('does not select a different allocation for an unknown cold link: %s', async (id) => {
    const { repo } = await identityRepo();
    renderWithProviders(<AllocationsPage />, { repo, route: '/allocations?allocation=' + id });
    expect(await screen.findByText(/allocation is unavailable or outside your access/i)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Allocations' })).not.toBeInTheDocument();
  });

  it('does not reveal a linked allocation to a role without route access', async () => {
    const { repo } = await identityRepo();
    renderWithProviders(<AllocationsPage />, { repo, source: 'supabase', capabilities: ['view_inventory'],
      role: 'marketing', route: '/allocations?allocation=allocation%2Fsecond' });
    expect(await screen.findByText(/allocation is unavailable or outside your access/i)).toBeVisible();
    expect(screen.queryByText('Same name product')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue|reserve|return/i })).not.toBeInTheDocument();
  });

  it('can leave exact selection without saving and retains full SKU identity', async () => {
    const { repo } = await identityRepo();
    renderWithProviders(<AllocationsPage />, { repo, route: '/allocations?allocation=allocation%2Fsecond' });
    await userEvent.click(await screen.findByRole('link', { name: 'Show all allocations' }));
    const list = await screen.findByRole('list', { name: 'Allocations' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('SAME-S', { exact: false })).toBeVisible();
    expect(within(list).getByRole('link', { name: 'View allocation allocation/second' })).toHaveAttribute('href', '/allocations?allocation=allocation%2Fsecond');
  });

  it('routes reservation alerts to the exact encoded allocation ahead of a generic event', async () => {
    const { data } = await identityRepo();
    data.allocations[1]!.status = 'reserved';
    const notes = buildNotifications(data, () => true);
    expect(notes.find(n => n.id === 'reserved-allocation/second')?.to).toBe('/allocations?allocation=allocation%2Fsecond');
    expect(buildNotifications(data, () => false).find(n => n.id === 'reserved-allocation/second')?.to).toBeUndefined();
  });

  it('identifies a count variance and links an operator to its exact count without resolution authority', async () => {
    const { repo } = await identityRepo();
    const resolve = vi.spyOn(repo, 'resolveException');
    renderWithProviders(<ExceptionsPage />, { repo, role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Warehouse exceptions' });
    expect(await within(list).findByText(/Same name product.*SAME-L/)).toBeVisible();
    expect(within(list).getByRole('link', { name: 'View source' })).toHaveAttribute('href', '/cycle-counts?count=count%2Fsecond');
    expect(within(list).queryByRole('button', { name: 'Review exception' })).not.toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('labels quality exceptions with SKU and delivery reference and preserves exact inspection identity', async () => {
    const { repo } = await identityRepo();
    vi.mocked(repo.listExceptions).mockResolvedValue({ rows: [{ ...exception, type: 'quality', sourceType: 'quality_inspection', sourceId: inspection.id }] });
    renderWithProviders(<ExceptionsPage />, { repo, role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Warehouse exceptions' });
    expect(await within(list).findByText(/Same name product.*SAME-L/)).toBeVisible();
    expect(within(list).getByText(/DR-SECOND/)).toBeVisible();
    expect(within(list).getByRole('link', { name: 'View source' })).toHaveAttribute('href', '/quality?inspection=inspection%2Fsecond');
  });

  it('keeps a variance visible when its source details are denied and never guesses a count ID', async () => {
    const { repo } = await identityRepo();
    vi.mocked(repo.listStockChangeRequests).mockRejectedValue(new Error('Not authorized'));
    renderWithProviders(<ExceptionsPage />, { repo, role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Warehouse exceptions' });
    expect(await within(list).findByText(/source details unavailable or outside your access/i)).toBeVisible();
    expect(within(list).queryByRole('link', { name: 'View source' })).not.toBeInTheDocument();
    await userEvent.click(within(list).getByText('Source reference'));
    expect(within(list).getByText(/request-second/)).toBeVisible();
  });

  it('does not misroute an unknown source type to a new cycle count', async () => {
    const { repo } = await identityRepo();
    vi.mocked(repo.listExceptions).mockResolvedValue({ rows: [{ ...exception, type: 'scan_mismatch', sourceType: 'unknown', sourceId: 'unknown-source' }] });
    renderWithProviders(<ExceptionsPage />, { repo });
    const list = await screen.findByRole('list', { name: 'Warehouse exceptions' });
    expect(await within(list).findByText(/source details unavailable or outside your access/i)).toBeVisible();
    expect(within(list).queryByRole('link', { name: 'View source' })).not.toBeInTheDocument();
  });

  it('puts a human quality task title and SKU before raw identifiers', async () => {
    const { repo } = await identityRepo();
    vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: [{
      id: 'task-second', type: 'quality', sourceId: inspection.id,
      title: 'Inspect inspection/second', status: 'due',
    }] });
    renderWithProviders(<TasksPage />, { repo });
    const list = await screen.findByRole('list', { name: 'due tasks' });
    expect(within(list).getByText('Inspect quality')).toBeVisible();
    expect(within(list).getByText(/Same name product.*SAME-L/)).toBeVisible();
    expect(within(list).getByText(/DR-SECOND/)).toBeVisible();
    expect(within(list).queryByText('Inspect inspection/second')).not.toBeInTheDocument();
  });

  it('resolves UUID operation types to human labels while keeping route identity and policies', async () => {
    const { data } = await identityRepo();
    data.operationTypes = [{ id: '11111111-2222-3333-4444-555555555555', code: 'transfer', label: 'Warehouse transfer', active: true }];
    data.operationRoutes = [
      { id: 'route-one', operationTypeId: data.operationTypes[0]!.id, sourceLocationTypes: ['warehouse'], destinationLocationTypes: ['warehouse'], requiresEvidence: true, requiresApproval: false, requiresOnline: true, active: true },
      { id: 'route-two', operationTypeId: data.operationTypes[0]!.id, sourceLocationTypes: ['warehouse'], destinationLocationTypes: ['warehouse'], requiresEvidence: false, requiresApproval: true, requiresOnline: false, active: true },
    ];
    const repo = makeRepo(data), save = vi.spyOn(repo, 'updateOperationRoute');
    // The memory repository normalizes route IDs; retain the live-shaped UUID fixture.
    vi.spyOn(repo, 'getData').mockResolvedValue(data);
    renderWithProviders(<OperationRoutesPage />, { repo });
    const list = await screen.findByRole('list', { name: 'Operation routes' });
    expect(within(list).getAllByText('Warehouse transfer')).toHaveLength(2);
    const second = within(list).getByText('Route: route-two').closest('li')!;
    await userEvent.click(within(second).getByRole('button', { name: 'Edit route' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit operation route' });
    expect(within(dialog).getByText(/Warehouse transfer/)).toBeVisible();
    expect(within(dialog).getByText('Route: route-two')).toBeVisible();
    expect(within(dialog).getByLabelText('Approval required')).toBeChecked();
    expect(save).not.toHaveBeenCalled();
  });

  it('distinguishes same-name Quality groups by SKU and exact receipt context', async () => {
    const { data } = await identityRepo();
    data.receipts.push({ ...data.receipts[0]!, id: 'receipt-first', deliveryReference: 'DR-FIRST',
      lines: [{ productId: 'doctor-token', quantity: 1 }] });
    const repo = makeRepo(data);
    vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [] });
    const save = vi.spyOn(repo, 'inspectQuality');
    renderWithProviders(<QualityPage />, { repo });
    const list = await screen.findByRole('list', { name: 'Pending inspections' });
    const summaries = [...list.querySelectorAll('li > details > summary')];
    expect(summaries.some(s => /Same name product.*SAME-L/.test(s.textContent ?? '') && /DR-SECOND/.test(s.textContent ?? ''))).toBe(true);
    expect(summaries.some(s => /Same name product.*SAME-S/.test(s.textContent ?? '') && /DR-FIRST/.test(s.textContent ?? ''))).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
