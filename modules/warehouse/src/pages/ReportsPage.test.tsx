import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsPage } from './ReportsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import type { InventoryPosition, PageResult } from '@intra/data-kit';

let liveExportSession = false;
let sessionLoading = false;
const position = (overrides: Partial<InventoryPosition> = {}): InventoryPosition => ({
  productId: 'shirt-l', locationId: 'loc-wh', onHand: 1, committed: 0, held: 0, unavailable: 0, available: 1, ...overrides,
});
vi.mock('@/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/auth/session')>();
  return { ...actual, useSession: () => {
    const session = actual.useSession();
    if (sessionLoading) return { ...session, loading: true };
    return liveExportSession ? { ...session, mode: 'supabase', userCapabilities: { warehouse: ['register_exports'] } } : session;
  } };
});

describe('ReportsPage', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); liveExportSession = false; sessionLoading = false; });

  it('keeps the aggregate unknown while retaining verified rows and product-filtered totals', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listInventoryPositions').mockResolvedValue({ rows: [
      position({ productAvailable: null, availabilityVerified: false, available: 0, putawayAvailable: 0, unscopedCommitted: 0 }),
      position({ productId: 'doctor-token', productAvailable: 7, availabilityVerified: true, available: 7, putawayAvailable: 7, unscopedCommitted: 0 }),
    ] });
    renderWithProviders(<ReportsPage />, { repo, source: 'supabase', capabilities: ['view_inventory'] });
    const table = await screen.findByRole('table');
    expect(screen.getByLabelText('Available total')).toHaveTextContent('Not confirmed');
    expect(screen.getByLabelText('Unassigned commitment total')).toHaveTextContent('0');
    const known = within(table).getByRole('row', { name: /Doctor Token/ });
    expect(within(known).getByText('7')).toBeVisible();
    expect(within(table).getByText('Not confirmed')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Product filter'), 'doctor-token');
    expect(screen.getByLabelText('Available total')).toHaveTextContent('7');
  });

  it('deduplicates global availability and unassigned demand, but does not confirm a location', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listInventoryPositions').mockResolvedValue({ rows: [
      position({ locationId: 'loc-wh', onHand: 2, available: 0, productAvailable: 4, unscopedCommitted: 8, availabilityVerified: false, putawayAvailable: 2 }),
      position({ locationId: 'loc-cebu', onHand: 10, available: 0, productAvailable: 4, unscopedCommitted: 8, availabilityVerified: false, putawayAvailable: 10 }),
      position({ productId: 'doctor-token', onHand: 7, available: 7, productAvailable: 7, unscopedCommitted: 0, availabilityVerified: true, putawayAvailable: 7 }),
    ] });
    renderWithProviders(<ReportsPage />, { repo, role: 'warehouse_supervisor', source: 'supabase', capabilities: ['view_inventory'] });
    const table = await screen.findByRole('table', { name: 'Inventory position report' });
    expect(screen.getByLabelText('Available total')).toHaveTextContent('11');
    expect(screen.getByLabelText('Unassigned commitment total')).toHaveTextContent('8');
    expect(within(table).getAllByText('Unassigned demand')).toHaveLength(2);
    expect(within(table).getAllByText('Not confirmed')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Location filter'), 'loc-cebu');
    expect(screen.getByLabelText('Available total')).toHaveTextContent('Not confirmed');
    expect(screen.getByLabelText('Unassigned commitment total')).toHaveTextContent('8');
    expect(screen.getByRole('region', { name: 'Unassigned product commitments' })).toHaveTextContent('8');
    expect(screen.getByRole('button', { name: 'Export full inventory' })).toBeDisabled();
  });

  it('does not certify a missing legacy live summary', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listInventoryPositions').mockResolvedValue({ rows: [position()] });
    renderWithProviders(<ReportsPage />, { repo, role: 'warehouse_supervisor', source: 'supabase', capabilities: ['view_inventory'] });
    await screen.findByRole('table');
    expect(screen.getByLabelText('Available total')).toHaveTextContent('Not confirmed');
    expect(within(screen.getByRole('table')).getByText('Not confirmed')).toBeVisible();
  });

  it('does not claim verified zero when the live position view returns no product summary', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listInventoryPositions').mockResolvedValue({ rows: [] });
    renderWithProviders(<ReportsPage />, { repo, source: 'supabase', capabilities: ['view_inventory'] });
    await screen.findByText('No positions match these filters');
    expect(screen.getByLabelText('Available total')).toHaveTextContent('Not confirmed');
    expect(screen.getByLabelText('Unassigned commitment total')).toHaveTextContent('Not confirmed');
  });

  it('shows committed inventory-position columns, totals, and filters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportsPage />, { role: 'bi_analyst' });
    for (const heading of ['On hand', 'Committed', 'Held', 'Unavailable', 'Available']) {
      await screen.findByRole('columnheader', { name: heading });
    }
    expect(screen.getByLabelText('Inventory position totals')).toHaveTextContent(/on hand/i);
    await user.selectOptions(screen.getByLabelText('Location filter'), 'loc-cebu');
    expect(screen.getAllByText(/Cebu Hub/i).length).toBeGreaterThan(0);
  });

  it('labels live exports as full authorized inventory even when the screen is filtered', async () => {
    liveExportSession = true;
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job: { filename: 'inventory-position.csv' },
      download_url: 'https://signed.example/report.csv',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ReportsPage />, { role: 'bi_analyst', source: 'supabase' });
    await screen.findByRole('table', { name: 'Inventory position report' });
    await user.selectOptions(screen.getByLabelText('Location filter'), 'loc-cebu');
    await user.selectOptions(screen.getByLabelText('Product filter'), 'shirt-l');
    expect(screen.getByText('Filters apply to this view; export includes all authorized positions.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export full inventory' })).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/current access does not allow inventory exports/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export full inventory' }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/warehouse/exports', expect.objectContaining({
      body: JSON.stringify({ kind: 'inventory_position' }),
    }));
    expect(await screen.findByText(/private download link expires/i)).toBeInTheDocument();
  });

  it('loads every cursor page before filtering and paginates the complete result', async () => {
    const repo = makeRepo();
    const load = vi.spyOn(repo, 'listInventoryPositions')
      .mockResolvedValueOnce({ rows: Array.from({ length: 100 }, (_, i) => position({ binId: `BIN-${i}` })), nextCursor: 'page-two' })
      .mockResolvedValueOnce({ rows: [position({ productId: 'doctor-token', locationId: 'loc-cebu', onHand: 7, available: 7 })] });
    renderWithProviders(<ReportsPage />, { repo, role: 'bi_analyst' });
    await waitFor(() => expect(load).toHaveBeenCalledWith({ limit: 100, cursor: 'page-two' }));
    const table = await screen.findByRole('table', { name: 'Inventory position report' });
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(screen.getByText('101 position row(s)')).toBeVisible();
    expect(screen.getByLabelText('Inventory position totals')).toHaveTextContent('107');
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Location filter'), 'loc-cebu');
    await userEvent.selectOptions(screen.getByLabelText('Product filter'), 'doctor-token');
    expect(screen.getByText('1 position row(s)')).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('withholds partial totals and export while a later page is pending', async () => {
    const repo = makeRepo();
    let finish!: (result: PageResult<InventoryPosition>) => void;
    const load = vi.spyOn(repo, 'listInventoryPositions')
      .mockResolvedValueOnce({ rows: [position()], nextCursor: 'page-two' })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderWithProviders(<ReportsPage />, { repo, role: 'bi_analyst' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Inventory position totals')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export report' })).toHaveAccessibleDescription(/loading/i);
    expect(screen.queryByText(/current access does not allow inventory exports/i)).not.toBeInTheDocument();
    await act(async () => finish({ rows: [position({ locationId: 'loc-cebu' })] }));
    expect(await screen.findByText('2 position row(s)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export report' })).not.toHaveAttribute('aria-describedby');
  });

  it('fails closed on a later-page error and retries from the start', async () => {
    const repo = makeRepo();
    const load = vi.spyOn(repo, 'listInventoryPositions')
      .mockResolvedValueOnce({ rows: [position()], nextCursor: 'page-two' })
      .mockRejectedValueOnce(new Error('Report read interrupted.'))
      .mockResolvedValueOnce({ rows: [position({ onHand: 9, available: 9 })] });
    renderWithProviders(<ReportsPage />, { repo, role: 'bi_analyst' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Report read interrupted.');
    expect(screen.queryByLabelText('Inventory position totals')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No positions match these filters')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export report' })).toHaveAccessibleDescription(/report loads successfully/i);
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading report' }));
    expect(await screen.findByText('1 position row(s)')).toBeVisible();
    expect(load).toHaveBeenLastCalledWith({ limit: 100 });
    expect(screen.getByRole('button', { name: 'Export report' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export report' })).not.toHaveAttribute('aria-describedby');
  });

  it('rejects a repeated cursor instead of showing incomplete or duplicate positions', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listInventoryPositions').mockResolvedValue({ rows: [position()], nextCursor: 'loop' });
    renderWithProviders(<ReportsPage />, { repo, role: 'bi_analyst' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded completely/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeDisabled();
  });

  it('does not prepare a live export without separate export authority', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    renderWithProviders(<ReportsPage />, { role: 'bi_analyst', source: 'supabase', capabilities: ['view_analytics'] });
    await screen.findByRole('table', { name: 'Inventory position report' });
    await userEvent.click(screen.getByRole('button', { name: 'Export full inventory' }));
    expect(screen.getByRole('button', { name: 'Export full inventory' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export full inventory' })).toHaveAccessibleDescription(/current access does not allow inventory exports.*authorized colleague/i);
    expect(screen.getByText(/current access does not allow inventory exports/i)).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not describe pending session access as an export rights denial', async () => {
    sessionLoading = true;
    renderWithProviders(<ReportsPage />, { source: 'supabase', capabilities: ['view_inventory'] });
    await screen.findByRole('table', { name: 'Inventory position report' });
    expect(screen.getByRole('button', { name: 'Export full inventory' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export full inventory' })).toHaveAccessibleDescription(/access is loading/i);
    expect(screen.queryByText(/current access does not allow inventory exports/i)).not.toBeInTheDocument();
  });
});
