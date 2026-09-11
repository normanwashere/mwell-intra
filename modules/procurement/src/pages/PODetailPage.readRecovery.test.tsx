// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PODetailPage } from './PODetailPage';

const rpc = vi.hoisted(() => vi.fn());
const client = { schema: () => ({ rpc }) };
const toast = { success: vi.fn(), error: vi.fn() };
const po = { id: 'po-kept', poNumber: 'PO-KEPT', vendorId: 'vendor', vendorName: 'Supplier', status: 'issued', origin: 'procurement', lines: [], total: 100, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
vi.mock('@intra/auth', () => ({
  Guard: ({ children }: { children: ReactNode }) => children,
  useCan: () => true,
  useSession: () => ({ profile: { id: 'approver' }, mode: 'supabase', supabaseClient: client }),
}));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => toast }));
vi.mock('../localStore', () => ({
  usePurchaseOrders: () => ({ rows: [po], loading: false, refresh: vi.fn() }),
  useProcurementRequests: () => ({ rows: [] }), useProcurementVendors: () => [], isAccredited: () => false,
}));
vi.mock('../components/PaymentReadinessPanel', () => ({ PaymentReadinessPanel: () => null }));
vi.mock('../components/CommitmentReadinessPanel', () => ({ CommitmentReadinessPanel: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  rpc.mockReset(); toast.error.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it.each(['network', 'rpc'])('keeps the PO and a persistent closure warning after a %s failure, then retries only the read', async failure => {
  if (failure === 'network') rpc.mockRejectedValueOnce(new Error('Network request failed'));
  else rpc.mockResolvedValueOnce({ data: null, error: { message: 'private backend message' } });
  rpc.mockResolvedValueOnce({ data: [], error: null });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/purchase-orders/po-kept'] },
    createElement(Routes, null, createElement(Route, { path: '/purchase-orders/:id', element: createElement(PODetailPage) })))));
  expect(host.textContent).toContain('PO-KEPT');
  expect(host.textContent).toContain('Closure review unavailable');
  expect(host.textContent).toContain('pending closure decision is not verified');
  expect(host.textContent).not.toContain('private backend message');
  expect(toast.error).not.toHaveBeenCalled();
  const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Retry closure review');
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  expect(host.textContent).not.toContain('Closure review unavailable');
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls.every(([name]) => name === 'purchase_order_closure_work_items')).toBe(true);
});
