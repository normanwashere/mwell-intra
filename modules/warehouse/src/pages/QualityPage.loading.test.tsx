import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { InMemoryRepository, type PageResult, type QualityInspection, type WarehouseData } from '@intra/data-kit';
import { QUALITY_CONTROL_LOAD_TIMEOUT_MS } from '@/domain/qualityControlLoad';

const state = vi.hoisted(() => ({
  data: null as WarehouseData | null,
  identity: 'actor-A',
  capabilities: ['inspect_quality'],
  inspections: vi.fn(), holds: vi.fn(), returns: vi.fn(),
}));
vi.mock('@intra/auth', () => ({ useSession: () => ({ mode: 'memory', supabaseClient: null }) }));
vi.mock('@/app/store', () => ({ useWarehouse: () => ({
  data: state.data, identityId: state.identity, capabilities: state.capabilities, can: () => false,
  // Deliberately fresh wrappers model ordinary provider rerenders.
  loadQualityInspections: (query: unknown) => state.inspections(query),
  loadHolds: (query: unknown) => state.holds(query),
  loadVendorReturns: (query: unknown) => state.returns(query),
}) }));
import { QualityPage } from './QualityPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const inspection = (id: string): QualityInspection => ({
  id, sourceType: 'receipt', sourceId: `receipt-${id}`, productId: 'shirt-l', quantity: 1,
  serialNumber: id, disposition: 'pending', inspectedAt: '2026-09-05T00:00:00Z',
  inspectedBy: 'receiver', evidenceUrls: [],
});
const mount = () => render(<QualityPage />, { wrapper: MemoryRouter });

describe('QualityPage bounded read recovery', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.identity = 'actor-A';
    state.capabilities = ['inspect_quality'];
    state.data = await new InMemoryRepository(undefined, { storage: null }).getData();
    state.data.receipts = [];
    state.data.returns = [];
    state.inspections.mockResolvedValue({ rows: [inspection('EXACT-A')] });
    state.holds.mockResolvedValue({ rows: [] });
    state.returns.mockResolvedValue({ rows: [] });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('bounds a never-resolving queue, offers Retry, and loads the complete exact population', async () => {
    const slow = deferred<PageResult<QualityInspection>>();
    state.inspections.mockReturnValueOnce(slow.promise);
    vi.useFakeTimers();
    mount();
    expect(screen.getByText('Loading quality controls...')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(QUALITY_CONTROL_LOAD_TIMEOUT_MS); });
    expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
    expect(screen.getByRole('button', { name: 'Retry quality queue' })).toBeEnabled();
    expect(screen.queryByText('No inspections waiting')).not.toBeInTheDocument();
    expect(screen.queryByText('0 pending inspections')).not.toBeInTheDocument();
    vi.useRealTimers();
    state.inspections.mockImplementation(async query => query.cursor
      ? { rows: [inspection('EXACT-C')] }
      : { rows: [inspection('EXACT-B')], nextCursor: 'older' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry quality queue' }));
    await screen.findByText('2 pending inspections');
    expect(screen.getByText('Serial EXACT-B')).toBeInTheDocument();
    expect(screen.getByText('Serial EXACT-C')).toBeInTheDocument();
    await act(async () => slow.resolve({ rows: [inspection('STALE-A')], nextCursor: 'must-not-load' }));
    expect(screen.queryByText('Serial STALE-A')).not.toBeInTheDocument();
    expect(state.inspections).not.toHaveBeenCalledWith({ limit: 100, cursor: 'must-not-load' });
    expect(screen.getByText('2 pending inspections')).toBeInTheDocument();
  });

  it('shows a rejected read as an error rather than empty and recovers on Retry', async () => {
    state.holds.mockRejectedValueOnce(new Error('inventory_holds: unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('inventory_holds: unavailable');
    expect(screen.queryByText('No inspections waiting')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry quality queue' }));
    await screen.findByText('Serial EXACT-A');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not reload for callback identity churn, and ignores superseded completions', async () => {
    const old = deferred<PageResult<QualityInspection>>();
    const current = deferred<PageResult<QualityInspection>>();
    state.inspections.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = mount();
    view.rerender(<QualityPage />);
    expect(state.inspections).toHaveBeenCalledTimes(1);
    state.identity = 'actor-B';
    view.rerender(<QualityPage />);
    expect(state.inspections).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve({ rows: [inspection('STALE-A')] }));
    expect(screen.getByText('Loading quality controls...')).toBeInTheDocument();
    expect(screen.queryByText('Serial STALE-A')).not.toBeInTheDocument();
    await act(async () => current.resolve({ rows: [inspection('EXACT-B')] }));
    await screen.findByText('Serial EXACT-B');
    expect(screen.queryByText('Serial STALE-A')).not.toBeInTheDocument();
  });

  it('invalidates on unmount and does not continue stale pagination', async () => {
    const old = deferred<PageResult<QualityInspection>>();
    state.inspections.mockReturnValueOnce(old.promise);
    const view = mount();
    view.unmount();
    mount();
    await screen.findByText('Serial EXACT-A');
    await act(async () => old.resolve({ rows: [inspection('UNMOUNTED')], nextCursor: 'stale-page' }));
    await waitFor(() => expect(state.inspections).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Serial UNMOUNTED')).not.toBeInTheDocument();
    expect(state.inspections).not.toHaveBeenCalledWith({ limit: 100, cursor: 'stale-page' });
  });

  it('reloads after a real data refresh or access change, but not equivalent capability arrays', async () => {
    const view = mount();
    await screen.findByText('Serial EXACT-A');
    state.capabilities = ['inspect_quality'];
    view.rerender(<QualityPage />);
    expect(state.inspections).toHaveBeenCalledTimes(1);
    state.inspections.mockResolvedValue({ rows: [inspection('REFRESHED')] });
    state.data = { ...state.data! };
    view.rerender(<QualityPage />);
    await screen.findByText('Serial REFRESHED');
    expect(state.inspections).toHaveBeenCalledTimes(2);
    state.inspections.mockResolvedValue({ rows: [] });
    state.capabilities = [];
    view.rerender(<QualityPage />);
    await screen.findByText('No inspections waiting');
    expect(state.inspections).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Serial REFRESHED')).not.toBeInTheDocument();
  });
});
