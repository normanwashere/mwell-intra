// @vitest-environment jsdom
import { act, createElement, type PropsWithChildren } from 'react';
import type { SignaturePayload } from '@intra/ui';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VendorApplicationPage } from './VendorApplicationPage';

const mocks = vi.hoisted(() => {
  const application = { policyVersion: 'vendor-accreditation-v2025', entityType: 'corporation', jurisdiction: 'PH', company: { tradeName: 'Original company' }, manpower: {}, fieldDispositions: {}, technologyQualifications: [], declaration: {} };
  const kase = { id: 'case1', vendorName: 'Vendor', entityType: 'corporation', status: 'correction_requested', correctionRequest: { sourceVersion: 3, revision: 4, note: 'Correct the company', requestedAt: '2026-09-05' } };
  const load = vi.fn(); const save = vi.fn(); const rpc = vi.fn();
  const repository = { load, save, discard: vi.fn() };
  const client = { schema: () => ({ rpc }) };
  const session = { mode: 'supabase', profile: { kind: 'vendor', name: 'Vendor', email: 'vendor@example.test' }, supabaseClient: client };
  return { application, kase, load, save, rpc, repository, session };
});
vi.mock('@intra/auth', () => ({ useSession: () => mocks.session, useCan: () => true }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'case1' }), Link: ({ children }: PropsWithChildren) => <a>{children}</a>, Navigate: () => null }));
vi.mock('../localStore', () => ({ useAccreditationCases: () => ({ getById: () => mocks.kase, loading: false, submitCase: vi.fn() }), useVendorAliases: () => ({ rows: [] }) }));
vi.mock('../vendorAccess', () => ({ shouldBlockVendorAccess: () => false }));
vi.mock('../vendorApplicationDraft', () => ({ createVendorApplicationDraftRepository: () => mocks.repository }));
vi.mock('../requirements/vendorAccreditationV2025', () => ({ buildV2025Checklist: () => [], validateV2025Application: () => ({ ok: true, errors: [] }), VENDOR_ACCREDITATION_V2025: { sourceDocument: 'Policy' } }));
vi.mock('../components/TechnologyQualificationForm', () => ({ TechnologyQualificationForm: () => null }));
vi.mock('../components/AccreditationDeclaration', () => ({ AccreditationDeclaration: () => null }));
vi.mock('@intra/ui', () => ({
  Badge: ({ children }: PropsWithChildren) => <span>{children}</span>, Card: ({ children }: PropsWithChildren) => <div>{children}</div>, HeroChipButton: ({ children }: PropsWithChildren) => <span>{children}</span>, Icon: () => null,
  ModuleHero: () => null, SectionTitle: () => null,
  SignaturePad: ({ onChange }: { onChange: (signature: SignaturePayload | null) => void }) => <button onClick={() => onChange({ method: 'typed', dataUrl: 'data:image/png;base64,AA==', signerName: 'Vendor', signedAt: '2026-09-05', userAgent: 'vitest' })}>Capture signature</button>,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.kase.status = 'correction_requested';
  mocks.load.mockResolvedValue({ application: structuredClone(mocks.application), status: 'submitted', version: 3 });
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  mocks.save.mockResolvedValue({ application: mocks.application, version: 4, status: 'draft' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(createElement(VendorApplicationPage))); }
async function click(label: string) { const button = [...container.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
it('F02: opens the submitted correction source as editable and submits the expected version with a fresh signature', async () => {
  await mount();
  const input = container.querySelector('input')!;
  expect(input.value).toBe('Original company'); expect(input.disabled).toBe(false);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Corrected company'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Capture signature'); await click('Sign and submit');
  expect(mocks.rpc).toHaveBeenCalledWith('submit_vendor_application', { payload: expect.objectContaining({ expected_version: 3, application: expect.objectContaining({ company: expect.objectContaining({ tradeName: 'Corrected company' }) }), signature: expect.objectContaining({ signerName: 'Vendor' }) }) });
  expect(mocks.application.company.tradeName).toBe('Original company');
});
it('keeps ordinary submitted applications locked', async () => {
  mocks.kase.status = 'submitted'; await mount();
  expect(container.querySelector('input')!.disabled).toBe(true);
  expect(container.textContent).not.toContain('Sign and submit');
});
it('F09: restarts discarded content with its retained concurrency cursor', async () => {
  mocks.kase.status = 'draft'; mocks.load.mockResolvedValue({ version: 3, status: 'superseded' });
  await mount(); await click('Save now');
  expect(mocks.save).toHaveBeenCalledWith('case1', expect.any(Object), 3, expect.any(String));
});
