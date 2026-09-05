import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';

const state = vi.hoisted(() => ({ rpc: vi.fn(), session: {} as Record<string, unknown> }));
vi.mock('@intra/auth', () => ({ useSession: () => state.session, useCan: () => true }));
import { FinanceApp } from './FinanceApp';
import { useFinanceData } from './data';

function installSuccessfulSources() {
  state.rpc.mockImplementation(async (name: string, args: { p_source?: string }) => {
    if (name === 'platform_finance_totals') return { data: { committedValue: 500, receivedValue: 0, returnedValue: 0 }, error: null };
    if (args.p_source === 'close') return { data: { rows: [{ id: 'private-a', entry_type: 'adjustment', notes: 'Actor A private' }], next: null, total: 1 }, error: null };
    return response(args.p_source!);
  });
}

it.each(['actor', 'capability'])('does not expose previous-scope data when the new %s load throws', async (change) => {
  installSuccessfulSources();
  const { result, rerender } = renderHook(() => useFinanceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data.inventoryValue).toBe(280);
  expect(result.current.data.closeEntries[0]?.id).toBe('private-a');
  state.rpc.mockImplementation(async (name: string, args: { p_source?: string }) => {
    if (name === 'platform_finance_totals') throw new Error('New scope load rejected');
    return response(args.p_source!);
  });
  state.session = { ...state.session, ...(change === 'actor' ? { profile: { id: 'actor-b' } } : { userCapabilities: [{ capability: 'changed' }] }) };
  rerender();
  expect(result.current.data.closeEntries).toEqual([]);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('New scope load rejected');
  expect(result.current.data.inventoryValue).toBe(0);
  expect(result.current.data.activity).toEqual([]);
  expect(result.current.data.closeEntries).toEqual([]);
  expect(result.current.data.totals).toBeUndefined();
});

it('a captured old refresh cannot invalidate the new actor in-flight refresh', async () => {
  installSuccessfulSources();
  const { result, rerender } = renderHook(() => useFinanceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const oldRefresh = result.current.refresh;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.rpc.mockImplementation(async (name: string, args: { p_source?: string }) => {
    if (name === 'platform_finance_totals') {
      await pending;
      return { data: { committedValue: 999, receivedValue: 0, returnedValue: 0 }, error: null };
    }
    return response(args.p_source!);
  });
  state.session = { ...state.session, profile: { id: 'actor-b' } };
  rerender();
  await act(async () => { await oldRefresh(); });
  expect(result.current.loading).toBe(true);
  await act(async () => { release(); await pending; });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data.totals?.committedValue).toBe(999);
});

it('payment retry removes only payment warnings, preserving product valuation failures', async () => {
  state.rpc.mockImplementation(async (name: string, args: { p_source?: string }) => {
    if (name === 'platform_finance_totals') return { data: {}, error: null };
    if (args.p_source === 'products' || args.p_source === 'payments') return { data: null, error: { message: `${args.p_source} offline` } };
    return response(args.p_source!);
  });
  const { result } = renderHook(() => useFinanceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data.warnings).toContain('Inventory valuation: products offline');
  const inventoryWarnings = result.current.data.warnings.filter((warning) => warning.startsWith('Inventory valuation:'));
  installSuccessfulSources();
  await act(async () => { await result.current.retrySource('payments'); });
  expect(result.current.data.warnings).toEqual(inventoryWarnings);
  expect(result.current.data.sourceStates?.inventory).toBe('error');
  expect(result.current.data.sourceStates?.payments).toBe('complete');
});

it.each(['actor', 'capability'])('ignores a late old-scope retry after %s changes', async (change) => {
  installSuccessfulSources();
  const { result, rerender } = renderHook(() => useFinanceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.rpc.mockImplementation(async () => {
    await pending;
    return { data: { rows: [{ id: 'late-private-a', entry_type: 'adjustment' }], next: null, total: 1 }, error: null };
  });
  let retry!: Promise<void>;
  act(() => { retry = result.current.retrySource('close'); });
  installSuccessfulSources();
  state.session = { ...state.session, ...(change === 'actor' ? { profile: { id: 'actor-b' } } : { roleCapabilities: [{ capability: 'changed' }] }) };
  rerender();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const current = result.current.data;
  await act(async () => { release(); await retry; });
  expect(result.current.data).toBe(current);
  expect(result.current.data.closeEntries.some((entry) => entry.id === 'late-private-a')).toBe(false);
  expect(result.current.retryingSources).toEqual({});
});

beforeEach(() => {
  state.rpc.mockReset();
  state.session = { profile: { id: 'reviewer' }, mode: 'supabase', loading: false,
    supabaseClient: { schema: () => ({ rpc: state.rpc }) } };
});

function response(source: string) {
  const rows = source === 'activity' ? [{ source: 'procurement_po', ref_id: 'po-a', amount: 500, occurred_at: '2026-09-05' }]
    : source === 'products' ? [{ id: 'product-a', unit_cost: 7 }]
    : source === 'inventory' ? [{ product_id: 'product-a', on_hand: 40 }]
    : source === 'orders' ? [{ id: 'po-a', po_number: 'PO-A', vendor_name: 'Vendor A' }] : [];
  return { data: { rows, next: null, total: rows.length }, error: null };
}

it('PF10: retrying failed payments retains valid metrics and only reloads its dependencies', async () => {
  let retry = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  state.rpc.mockImplementation(async (name: string, args: { p_source?: string }) => {
    if (name === 'platform_finance_totals') return { data: { committedValue: 500, receivedValue: 0, returnedValue: 0 }, error: null };
    if (args.p_source === 'payments') {
      if (!retry) return { data: null, error: { message: 'Payment outage' } };
      await pending;
    }
    return response(args.p_source!);
  });
  render(<ToastProvider><FinanceApp /></ToastProvider>);
  await screen.findByRole('button', { name: 'Retry payment source' });
  expect(screen.getByLabelText('Finance summary')).toHaveTextContent('280');
  state.rpc.mockClear();
  retry = true;
  fireEvent.click(screen.getByRole('button', { name: 'Retry payment source' }));
  try {
    expect(screen.getByLabelText('Finance summary')).toHaveTextContent('280');
  } finally { await act(async () => { release(); await pending; }); }
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry payment source' })).not.toBeInTheDocument());
  const sources = state.rpc.mock.calls.map(([name, args]) => name === 'platform_finance_totals' ? 'totals' : args.p_source);
  expect([...new Set(sources)].sort()).toEqual(['orders', 'payments']);
  expect(screen.getByLabelText('Finance summary')).toHaveTextContent('280');
});
