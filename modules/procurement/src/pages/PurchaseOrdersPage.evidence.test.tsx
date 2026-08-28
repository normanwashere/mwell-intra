// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PurchaseOrderAmendmentEvidence } from './PurchaseOrdersPage';

type Props = ComponentProps<typeof PurchaseOrderAmendmentEvidence>;
let root: Root;
let container: HTMLDivElement;
const reference = 'request-A/amendment.pdf';
const url = 'https://storage.test/amendment?token=authorized';
const rpc = vi.fn();
const sign = vi.fn();
const orderResult = vi.fn();
const docResult = vi.fn();
const orderEq = vi.fn();
const docEq = vi.fn();
const client = {
  schema: vi.fn(() => ({ rpc, from: (table: string) => {
    const eq = table === 'purchase_orders' ? orderEq : docEq;
    const query = { select: () => query, eq, maybeSingle: table === 'purchase_orders' ? orderResult : docResult };
    eq.mockReturnValue(query); return query;
  } })),
  storage: { from: vi.fn(() => ({ createSignedUrl: sign })) },
};
function props(overrides: Partial<Props> = {}): Props {
  return { purchaseOrderId: 'PO-A', actorId: 'reviewer-A', reference,
    client: client as unknown as Props['client'], ...overrides };
}
async function render(value = props()) { await act(async () => root.render(createElement(PurchaseOrderAmendmentEvidence, value))); }
async function open() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Open evidence"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
  orderResult.mockResolvedValue({ data: { request_id: 'request-A' } });
  docResult.mockResolvedValue({ data: { id: 'attachment-A' } });
  rpc.mockResolvedValue({ data: { bucket: 'documents', storage_path: reference, filename: 'amendment.pdf', expires_in: 60 } });
  sign.mockResolvedValue({ data: { signedUrl: url } });
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens saved selected or uploaded amendment evidence only through its linked request attachment', async () => {
  await render();
  expect(container.querySelector('input')).toBeNull();
  await open();
  expect(orderEq).toHaveBeenCalledWith('id', 'PO-A');
  expect(docEq).toHaveBeenCalledWith('request_id', 'request-A');
  expect(docEq).toHaveBeenCalledWith('storage_path', reference);
  expect(rpc).toHaveBeenCalledWith('prepare_request_attachment_access', { payload: { attachment_id: 'attachment-A' } });
  expect(sign).toHaveBeenCalledWith(reference, 60, { download: 'amendment.pdf' });
  expect(window.open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(url);
});
it('does not sign an arbitrary or cross-request path without a registered matching document', async () => {
  docResult.mockResolvedValue({ data: null });
  await render(); await open();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('not registered');
  expect(rpc).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
});
it('fails closed when the PO linked request cannot be read', async () => {
  orderResult.mockResolvedValue({ data: null });
  await render(); await open();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('linked request');
  expect(docResult).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
});
it('surfaces source authorization denial before storage signing', async () => {
  rpc.mockResolvedValue({ error: { message: 'Access revoked' } });
  await render(); await open();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Access revoked');
  expect(sign).not.toHaveBeenCalled(); expect(container.querySelector('a')).toBeNull();
});
it('ignores late signed previews after the reviewer changes', async () => {
  let resolve!: (value: unknown) => void;
  sign.mockReturnValue(new Promise((yes) => { resolve = yes; }));
  await render(); await open();
  await render(props({ actorId: 'reviewer-B' }));
  await act(async () => resolve({ data: { signedUrl: url } }));
  expect(window.open).not.toHaveBeenCalled(); expect(container.querySelector('a')).toBeNull();
});
it('never persists a signed preview and drops its popup fallback before the 60-second expiry', async () => {
  vi.useFakeTimers();
  try {
    await render(); await open();
    expect(container.querySelector('a')?.getAttribute('href')).toBe(url);
    await act(async () => vi.advanceTimersByTime(55_000));
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('amendment.pdf');
    await open(); expect(rpc).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
