// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAcceptanceWorkItem } from './localStore';

const rpc = vi.hoisted(() => vi.fn());
const client = { schema: () => ({ rpc }) };
vi.mock('@intra/auth', () => ({ useCan: () => true, useSession: () => ({ mode: 'supabase', supabaseClient: client, profile: { id: 'requester' } }) }));
let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useAcceptanceWorkItem>;
function Probe({ id = 'po-kept' }: { id?: string }) {
  latest = useAcceptanceWorkItem(id);
  return createElement('p', { role: latest.error ? 'alert' : 'status' }, latest.error ?? (latest.loading ? 'Loading' : latest.item?.poNumber ?? 'Empty'));
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rpc.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('catches an acceptance network rejection and retries the same record without mutation', async () => {
  rpc.mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({ data: [], error: null });
  await act(async () => root.render(createElement(Probe)));
  expect(latest.error).toBe('Records could not be loaded. Please retry.');
  expect(host.textContent).not.toBe('Empty');
  await act(async () => { await latest.refresh(); });
  expect(host.textContent).toBe('Empty');
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls.every(([name, payload]) => name === 'acceptance_work_items' && payload.payload.purchase_order_id === 'po-kept')).toBe(true);
});
it('does not issue an acceptance read when the route does not need it', async () => {
  await act(async () => root.render(createElement(Probe, { id: '' })));
  expect(rpc).not.toHaveBeenCalled();
  expect(latest.loading).toBe(false);
});
it('keeps an RPC error distinct from an empty acceptance result', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'private backend message' } });
  await act(async () => root.render(createElement(Probe)));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('private backend message');
  expect(latest.item).toBeNull();
});
