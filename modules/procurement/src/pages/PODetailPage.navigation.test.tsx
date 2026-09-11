// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PurchaseOrder } from '../types';
import { PODetailPage } from './PODetailPage';

let po: PurchaseOrder;
let access = true;
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('@intra/auth', () => ({
  Guard: ({ children }: { children: ReactNode }) => access ? children : null,
  useCan: () => access,
  useSession: () => ({ profile: { id: 'viewer' } }),
}));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => toast }));
vi.mock('../localStore', () => ({
  usePurchaseOrders: () => ({ rows: [po], loading: false }),
  useProcurementRequests: () => ({ rows: [] }),
  useProcurementVendors: () => [],
  isAccredited: () => false,
}));
vi.mock('../components/PaymentReadinessPanel', () => ({ PaymentReadinessPanel: () => null }));
vi.mock('../components/CommitmentReadinessPanel', () => ({ CommitmentReadinessPanel: () => null }));

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
const scroll = vi.fn();
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  po = { id: 'po-nav', poNumber: 'PO-NAV', vendorId: 'vendor', vendorName: 'Supplier', status: 'issued', origin: 'procurement', lines: [], total: 100, createdAt: '2026-09-01', updatedAt: '2026-09-01' };
  access = true;
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  HTMLElement.prototype.scrollIntoView = scroll;
  scroll.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLElement.prototype.scrollIntoView = originalScroll;
  vi.unstubAllGlobals();
});

function HistoryControls() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>History back</button>;
}
async function renderPage(suffix = '') {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/purchase-orders/po-nav${suffix}`]}>
      <HistoryControls />
      <Routes><Route path="/purchase-orders/:id" element={<PODetailPage />} /></Routes>
    </MemoryRouter>,
  ));
  flushFrames();
}
function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
  flushFrames();
}
function currentSection() {
  return host.querySelector('nav [aria-current="location"]')?.textContent;
}

it('follows section links and browser history with focused targets and retained Finance context', async () => {
  await renderPage('?from=finance&section=payment');
  expect(currentSection()).toBe('Payment handoff');
  expect(document.activeElement?.id).toBe('payment');
  const lines = host.querySelector<HTMLAnchorElement>('nav a[href$="#lines"]')!;
  expect(lines.getAttribute('href')).toContain('from=finance&section=payment#lines');
  await click(lines);
  expect(currentSection()).toBe('Line items');
  expect(document.activeElement?.id).toBe('lines');
  expect(scroll).toHaveBeenLastCalledWith({ block: 'start' });
  await click(host.querySelector('button')!);
  expect(currentSection()).toBe('Payment handoff');
  expect(document.activeElement?.id).toBe('payment');
  expect(host.querySelector('a[href="/finance"]')).not.toBeNull();
});

it('allows a selected section link to be followed again after moving away', async () => {
  await renderPage('#lines');
  host.querySelector('button')!.focus();
  await click(host.querySelector<HTMLAnchorElement>('nav a[href$="#lines"]')!);
  expect(document.activeElement?.id).toBe('lines');
  expect(scroll).toHaveBeenCalledTimes(2);
});

it('focuses a policy deep link when its section becomes available after the PO', async () => {
  await renderPage('#policy');
  expect(currentSection()).toBeUndefined();
  expect(scroll).not.toHaveBeenCalled();
  po.commitmentReadiness = { ready: true, phase: 'issue', requestId: 'request', vendorId: 'vendor', route: 'rfq', blockers: [], evidence: [], protections: [] };
  await renderPage('#policy');
  expect(currentSection()).toBe('Policy evidence');
  expect(document.activeElement?.id).toBe('policy');
});

it('does not expose section navigation or focus record content without view access', async () => {
  access = false;
  await renderPage('#payment');
  expect(host.textContent).toContain('No purchase order access');
  expect(host.querySelector('nav')).toBeNull();
  expect(scroll).not.toHaveBeenCalled();
});
