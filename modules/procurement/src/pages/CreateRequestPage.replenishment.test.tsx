// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionValue } from '@intra/auth';
import { CreateRequestPage } from './CreateRequestPage';

const mocks = vi.hoisted(() => ({ add: vi.fn(), read: vi.fn(), load: vi.fn(), save: vi.fn(), discard: vi.fn(), error: vi.fn(), success: vi.fn() }));
let session: SessionValue;
vi.mock('@intra/auth', () => ({ Guard: ({ children }: { children: ReactNode }) => children, useCan: () => true, useSession: () => session }));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => ({ error: mocks.error, success: mocks.success }) }));
vi.mock('../localStore', () => ({ useProcurementRequests: () => ({ add: mocks.add }), useProcurementVendors: () => [] }));
vi.mock('../replenishmentRequest', async () => ({ ...await vi.importActual('../replenishmentRequest'), readAcceptedReplenishment: mocks.read }));
vi.mock('../requestDrafts', () => ({ loadLatestRequestDraft: mocks.load, saveRequestDraft: mocks.save, discardRequestDraft: mocks.discard }));
const binding = { id: '11111111-1111-4111-8111-111111111111', productId: 'accepted-product', quantity: 2, rationale: 'Accepted need' };
let root: Root, host: HTMLDivElement, mobile: boolean;
const originalScroll = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  vi.clearAllMocks(); mobile = false;
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('scrollTo', vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();
  session = { mode: 'supabase', loading: false, profile: { id: 'actor', name: 'Actor', kind: 'employee' },
    userCapabilities: { procurement: ['create_request', 'manage_replenishment'] },
    supabaseClient: { schema: () => ({ from: () => ({ select: () => Promise.resolve({ data: [
      { department_code: 'operations', department_name: 'Operations', cost_center_code: 'cc', cost_center_name: 'Explicit center' },
    ], error: null }) }) }) },
  } as unknown as SessionValue;
  mocks.read.mockResolvedValue(binding); mocks.add.mockResolvedValue({ id: 'req_created' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); HTMLElement.prototype.scrollIntoView = originalScroll; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Location() { const location = useLocation(); return <output>{location.pathname + location.search}</output>; }
async function render(query = `?replenishment=${binding.id}`) {
  await act(async () => root.render(<MemoryRouter initialEntries={['/requests/new' + query]}><Routes><Route path="/requests/new" element={<CreateRequestPage />} /><Route path="/requests/:id" element={<p>Recorded draft</p>} /></Routes><Location /></MemoryRouter>));
}
function element<T extends HTMLElement>(selector: string): T { const found = host.querySelector<T>(selector); expect(found, selector).not.toBeNull(); return found!; }
async function fill(selector: string, value: string) {
  const input = element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text); expect(button, text).toBeDefined(); await act(async () => button!.click()); }
async function attach(kind: string) {
  const input = element<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fixture'], `${kind}.pdf`, { type: 'application/pdf' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await fill(`select[aria-label="Document type for ${kind}.pdf"]`, kind);
}
async function completeFields() {
  await act(async () => element<HTMLInputElement>('input[name=category][value=goods]').click());
  await act(async () => element<HTMLInputElement>('input[name=requirement-kind][value=materials]').click());
  await fill('[aria-label="Line 1 unit price"]', '25'); await click('Continue');
  await fill('#department', 'operations'); await fill('#costCenter', 'cc'); await fill('#budgetCode', 'explicit-budget'); await fill('#neededBy', '2099-01-01');
  await attach('spec'); await attach('budget'); await click('Continue');
  for (const key of ['acceptanceCriteria', 'deliveryTerms', 'paymentTerms', 'shippingTerms', 'validityPeriod', 'responseDeadline']) await fill(`#rfq-${key}`, `Explicit ${key}`);
}
it.each([false, true])('locks accepted lineage on desktop/mobile=%s without inferring classification or price', async compact => {
  mobile = compact; await render();
  expect(element<HTMLInputElement>('[aria-label="Line 1 description"]').value).toBe(binding.productId);
  for (const name of ['description', 'quantity', 'unit of measure']) expect(element<HTMLInputElement>(`[aria-label="Line 1 ${name}"]`).readOnly).toBe(true);
  expect(element<HTMLInputElement>('[aria-label="Line 1 unit price"]').value).toBe('');
  expect(host.querySelector('input[name=requirement-kind]:checked')).toBeNull();
  expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Add line'))!.disabled).toBe(true);
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(['loading', 'no-create', 'no-manage', 'signed-out', 'read-failure', 'duplicate-reference'])('fails closed for %s without draft writes', async state => {
  if (state === 'loading') session.loading = true;
  if (state === 'no-create') session.userCapabilities = { procurement: ['manage_replenishment'] };
  if (state === 'no-manage') session.userCapabilities = { procurement: ['create_request'] };
  if (state === 'signed-out') session.profile = null;
  if (state === 'read-failure') mocks.read.mockRejectedValue(new Error('denied'));
  await render(state === 'duplicate-reference' ? '?replenishment=a&replenishment=b' : undefined);
  expect(host.querySelector('form')).toBeNull(); expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it('revocation removes an already loaded bound form', async () => {
  await render(); expect(host.querySelector('form')).not.toBeNull();
  session = { ...session, userCapabilities: { procurement: ['manage_replenishment'] } };
  await render(); expect(host.querySelector('form')).toBeNull(); expect(mocks.add).not.toHaveBeenCalled();
});
it.each(['handed_off', 'accepted'])('offers safe recovery for an actual %s linked read without claiming no creation', async status => {
  const actual = await vi.importActual<typeof import('../replenishmentRequest')>('../replenishmentRequest');
  mocks.read.mockImplementation(actual.readAcceptedReplenishment);
  const single = vi.fn().mockResolvedValue({ data: { id: binding.id, status, product_id: binding.productId,
    recommended_quantity: binding.quantity, rationale: binding.rationale, procurement_request_id: 'req_recorded' }, error: null });
  const rpc = vi.fn();
  session = {
    ...session,
    supabaseClient: { schema: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }) },
  } as unknown as SessionValue;
  await render();
  expect(host.textContent).not.toContain('No request was created');
  expect(host.textContent).toContain('may have changed or already been handed off');
  const back = [...host.querySelectorAll('a')].find(link => link.textContent === 'Back to recommendation');
  expect(back?.getAttribute('href')).toBe('/warehouse/procurement');
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('a[href*="/requests/"]')).toBeNull();
  expect(single).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.discard).not.toHaveBeenCalled();
});
it('uses the current wizard validations then completes one unconfirmed draft, never approval submission', async () => {
  await render(); await click('Continue'); expect(mocks.error).toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  await completeFields();
  expect(host.textContent).not.toContain('Save & submit for approval');
  await click('Create draft & complete handoff');
  expect(mocks.add).toHaveBeenCalledTimes(1);
  const input = mocks.add.mock.calls[0]![0];
  expect(input).toMatchObject({ replenishment: binding, requirementKind: 'materials', budgetCode: 'explicit-budget', costCenter: 'cc',
    lines: [{ description: binding.productId, quantity: 2, uom: 'unit', unitPrice: 25 }], justification: { need: binding.rationale }, compliance: { routeConfirmed: false } });
  expect(input.draftId).toBeUndefined(); expect(input.attachments).toHaveLength(2);
  expect(element('output').textContent).toBe('/requests/req_created'); expect(mocks.save).not.toHaveBeenCalled();
});
it('stops the form after an ambiguous outcome, preserving evidence and preventing another submit', async () => {
  mocks.add.mockRejectedValue(new Error('Uncertain handoff outcome'));
  await render(); await completeFields(); await click('Create draft & complete handoff');
  await act(async () => element('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.add).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('verify its recorded outcome');
  expect(mocks.discard).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
