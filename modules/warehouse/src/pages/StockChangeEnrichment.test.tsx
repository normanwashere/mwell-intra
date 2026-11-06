import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { StockChangeRequest, WarehouseException } from '@intra/data-kit';
import type { Capability } from '@/auth/roles';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { TasksPage } from './TasksPage';
import { ExceptionsPage } from './ExceptionsPage';

const exception: WarehouseException = {
  id: 'exception/variance', type: 'count_variance', severity: 'P2',
  sourceType: 'stock_change_request', sourceId: 'request/variance', status: 'open',
  createdAt: '2026-11-06T00:00:00Z',
};
const request: StockChangeRequest = {
  id: exception.sourceId, sourceType: 'cycle_count', sourceId: 'count/own',
  productId: 'shirt-l', locationId: 'loc-wh', quantityDelta: -1, unitCost: 1,
  financialImpact: 1, reason: 'Recount', evidenceUrls: [], status: 'pending_supervisor',
  requestedBy: 'counter', requestedAt: '2026-11-06T00:00:00Z', canDecide: false,
};
const baseCapabilities: readonly Capability[] = ['view_inventory', 'view_exceptions', 'inspect_quality'];

async function fixture(capabilities: readonly Capability[], directCount = false) {
  const data = await makeRepo().getData();
  data.products.find(p => p.id === 'shirt-l')!.name = 'Reviewed item';
  data.products.find(p => p.id === 'shirt-l')!.sku = 'REVIEWED-L';
  data.cycleCounts = [{ id: 'count/own', locationId: 'loc-wh', actor: 'counter',
    createdAt: '2026-11-06T00:00:00Z', lines: [{ productId: 'shirt-l', expected: 2, counted: 1 }] }];
  const repo = makeRepo(data);
  vi.spyOn(repo, 'listExceptions').mockResolvedValue({ rows: [directCount
    ? { ...exception, sourceType: 'cycle_count', sourceId: 'count/own' } : exception] });
  vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: [{
    id: 'task-variance', type: directCount ? 'cycle_count' : 'exception',
    sourceId: directCount ? 'count/own' : exception.id, title: 'Review variance', status: 'due',
  }] });
  vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [] });
  // Match the live reader: physical custody/count capabilities do not grant approval-list reads.
  const read = vi.spyOn(repo, 'listStockChangeRequests').mockImplementation(async () => {
    if (!capabilities.some(cap => cap === 'approve_stock_adjustment' || cap === 'approve_stock_adjustment_finance')) {
      throw new Error('Not authorized: warehouse stock approvals');
    }
    return { rows: [request] };
  });
  const decide = vi.spyOn(repo, 'decideStockChange');
  const resolve = vi.spyOn(repo, 'resolveException');
  return { repo, read, decide, resolve };
}

describe.each([
  { name: 'Tasks', Page: TasksPage, list: 'due tasks' },
  { name: 'Exceptions', Page: ExceptionsPage, list: 'Warehouse exceptions' },
])('$name stock-request enrichment', ({ name, Page, list }) => {
  it.each([
    ['count only', ['cycle_count']],
    ['inventory only', ['manage_inventory']],
    ['Associate combined capabilities', ['cycle_count', 'manage_inventory']],
    ['no approval capability despite supervisor label', []],
  ] as const)('does not query the approval-only reader for %s', async (_label, extra) => {
    const capabilities: readonly Capability[] = [...baseCapabilities, ...extra];
    const { repo, read, decide, resolve } = await fixture(capabilities);
    renderWithProviders(<Page />, { repo, source: 'supabase', capabilities, role: 'warehouse_supervisor' });
    const queue = await screen.findByRole('list', { name: list });
    expect(within(queue).getByText(/source details unavailable or outside your access/i)).toBeVisible();
    expect(read).not.toHaveBeenCalled();
    expect(within(queue).queryByText(/Reviewed item/)).not.toBeInTheDocument();
    if (name === 'Tasks') {
      expect(within(queue).getByRole('link', { name: 'Open exception source' }))
        .toHaveAttribute('href', '/exceptions?source=exception%2Fvariance&taskStatus=due');
    } else expect(within(queue).queryByRole('link', { name: 'View source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['supervisor approval', ['approve_stock_adjustment']],
    ['Finance approval on an operator presentation', ['approve_stock_adjustment_finance']],
    ['combined multi-role capabilities', ['cycle_count', 'manage_inventory', 'approve_stock_adjustment', 'approve_stock_adjustment_finance']],
  ] as const)('enriches from actual %s capability, independent of the displayed role', async (_label, extra) => {
    const capabilities: readonly Capability[] = [...baseCapabilities, ...extra];
    const { repo, read, decide } = await fixture(capabilities);
    renderWithProviders(<Page />, { repo, source: 'supabase', capabilities, role: 'warehouse_operator' });
    const queue = await screen.findByRole('list', { name: list });
    expect(within(queue).getByText(/Reviewed item.*REVIEWED-L/)).toBeVisible();
    expect(read).toHaveBeenCalledOnce();
    if (name === 'Exceptions') expect(within(queue).getByRole('link', { name: 'View source' }))
      .toHaveAttribute('href', '/approvals?request=request%2Fvariance');
    expect(decide).not.toHaveBeenCalled();
  });

  it('retains the visible queue and safe links when an authorized enrichment read is denied', async () => {
    const capabilities: readonly Capability[] = [...baseCapabilities, 'approve_stock_adjustment'];
    const { repo, read } = await fixture(capabilities);
    read.mockRejectedValue(new Error('Not authorized: warehouse stock approvals'));
    renderWithProviders(<Page />, { repo, source: 'supabase', capabilities, role: 'warehouse_operator' });
    const queue = await screen.findByRole('list', { name: list });
    expect(read).toHaveBeenCalledOnce();
    expect(within(queue).getAllByRole('listitem')).toHaveLength(1);
    expect(within(queue).queryByText(/Reviewed item/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(queue).getByRole('link')).toHaveAttribute('href', name === 'Tasks'
      ? '/exceptions?source=exception%2Fvariance&taskStatus=due' : '/approvals?request=request%2Fvariance');
  });

  it('keeps a readable direct count linked to that exact record without approval enrichment', async () => {
    const capabilities: readonly Capability[] = [...baseCapabilities, 'cycle_count', 'manage_inventory'];
    const { repo, read } = await fixture(capabilities, true);
    renderWithProviders(<Page />, { repo, source: 'supabase', capabilities, role: 'warehouse_operator' });
    const queue = await screen.findByRole('list', { name: list });
    expect(within(queue).getByText(/Reviewed item.*REVIEWED-L/)).toBeVisible();
    expect(within(queue).getByRole('link')).toHaveAttribute('href', name === 'Tasks'
      ? '/cycle-counts?source=count%2Fown&taskStatus=due' : '/cycle-counts?count=count%2Fown');
    expect(read).not.toHaveBeenCalled();
  });
});
