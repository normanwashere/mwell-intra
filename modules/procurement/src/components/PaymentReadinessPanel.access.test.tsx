// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PaymentReadinessPanel } from './PaymentReadinessPanel';

const auth = vi.hoisted(() => ({
  session: {
    mode: 'supabase', loading: false,
    profile: { id: 'ops-lead', kind: 'employee' },
    userCapabilities: { procurement: [] as string[] },
    roleCapabilities: { procurement: ['author_po'] },
    supabaseClient: { schema: vi.fn() },
  },
}));
vi.mock('@intra/auth', () => ({ useSession: () => auth.session }));
type Props = ComponentProps<typeof PaymentReadinessPanel>;
const rpc = vi.fn();
let root: Root;
let container: HTMLDivElement;
const data = { documents: [], packDocuments: [{ id: 'doc-a', filename: 'Invoice.pdf', purpose: 'invoice' }], foreignVendor: false };
const props = (): Props => ({
  purchaseOrderId: 'PO-A', acceptanceLines: [], canAccept: true, canPrepare: false, canReview: false, canRelease: false,
  purchaseOrderAmount: 100, acceptanceType: 'goods', onAccept: vi.fn(), onPrepare: vi.fn(), onReview: vi.fn(), onRelease: vi.fn(),
});
async function render(value = props()) {
  await act(async () => root.render(createElement(PaymentReadinessPanel, value)));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.clearAllMocks();
  auth.session.mode = 'supabase';
  auth.session.loading = false;
  auth.session.profile = { id: 'ops-lead', kind: 'employee' };
  auth.session.userCapabilities = { procurement: ['view_pos', 'approve_request'] };
  auth.session.supabaseClient.schema.mockReturnValue({ rpc });
  rpc.mockResolvedValue({ data, error: null });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('does not request restricted payment evidence for an OpsLead PO/acceptance viewer', async () => {
  await render();
  expect(rpc).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Payment evidence is not in your scope.');
  expect(container.textContent).not.toContain('Invoice.pdf');
});

it('does not treat raw uncertified grants or write-control props as evidence authority', async () => {
  await render({ ...props(), canPrepare: true, canReview: true, canRelease: true });
  expect(rpc).not.toHaveBeenCalled();
});

it.each(['author_po', 'admin', 'view_finance'])('retains evidence reads for effective %s without write controls', async (capability) => {
  auth.session.userCapabilities = { procurement: [capability] };
  await render();
  expect(auth.session.supabaseClient.schema).toHaveBeenCalledWith('procurement');
  expect(rpc).toHaveBeenCalledWith('payment_evidence_options', { payload: { purchase_order_id: 'PO-A', pack_id: undefined } });
  expect(container.textContent).toContain('Open invoice: Invoice.pdf');
  expect(container.textContent).not.toContain('Payment evidence is not in your scope.');
});

it('does not query while restoring capabilities or for a vendor profile', async () => {
  auth.session.userCapabilities = { procurement: ['view_finance'] };
  auth.session.loading = true;
  await render();
  expect(rpc).not.toHaveBeenCalled();
  auth.session.loading = false;
  auth.session.profile = { id: 'vendor-a', kind: 'vendor' };
  await render();
  expect(rpc).not.toHaveBeenCalled();
});

it('drops a pending authorized response after the actor loses evidence scope', async () => {
  let finish!: (value: { data: typeof data; error: null }) => void;
  rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  auth.session.userCapabilities = { procurement: ['view_finance'] };
  await render();
  auth.session.profile = { id: 'ops-lead-next', kind: 'employee' };
  auth.session.userCapabilities = { procurement: ['view_pos'] };
  await render();
  await act(async () => finish({ data, error: null }));
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain('Invoice.pdf');
  expect(container.textContent).toContain('Payment evidence is not in your scope.');
});

it('keeps real server denials visible to an authorized read-only reviewer', async () => {
  auth.session.userCapabilities = { procurement: ['view_finance'] };
  rpc.mockResolvedValue({ data: null, error: { message: 'Purchase order unavailable' } });
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Purchase order unavailable');
  expect(container.textContent).not.toContain('Invoice.pdf');
});

it('keeps demo payment readback without fetching or pretending to preview private documents', async () => {
  auth.session.mode = 'memory';
  await render({ ...props(), pack: {
    id: 'demo-pack', purchaseOrderId: 'PO-A', acceptancePackId: 'accept-a',
    poMatch: true, invoiceOrSiReference: 'DEMO-INVOICE', milestoneSupportReference: 'DEMO-ACCEPTANCE',
    taxWithholdingSupportReference: 'DEMO-TAX', status: 'accepted', preparedAt: '2026-09-05',
    invoiceNumber: 'INV-DEMO-001', invoiceAmount: 100,
  } });
  expect(rpc).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Finance accepted');
  expect(container.textContent).not.toContain('Payment evidence is not in your scope.');
  expect(container.querySelector('[aria-label="Payment pack documents"]')).toBeNull();
});
