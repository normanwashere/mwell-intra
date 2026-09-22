// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VendorApplicationPage } from './VendorApplicationPage';
import { validateV2025Application } from '../requirements/vendorAccreditationV2025';
import type { VendorApplicationSnapshot } from '../types';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn(), load = vi.fn(), save = vi.fn(), discard = vi.fn();
  const repository = { load, save, discard };
  const session = { mode: 'supabase', profile: { kind: 'vendor', vendorId: 'synthetic-vendor', name: 'Vendor', email: 'vendor@example.invalid' },
    supabaseClient: { schema: () => ({ rpc }) } };
  const kase = { id: 'synthetic-case', vendorId: 'synthetic-vendor', vendorName: 'Synthetic application', entityType: 'sole_prop', status: 'draft' };
  return { rpc, load, save, discard, repository, session, kase, canManage: true, toast: { success: vi.fn(), error: vi.fn() } };
});
vi.mock('@intra/auth', () => ({ useSession: () => mocks.session, useCan: () => mocks.canManage }));
vi.mock('../localStore', () => ({
  useAccreditationCases: () => ({ getById: () => mocks.kase, loading: false, submitCase: vi.fn() }),
  useVendorAliases: () => ({ rows: [] }),
}));
vi.mock('../vendorApplicationDraft', () => ({ createVendorApplicationDraftRepository: () => mocks.repository }));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => mocks.toast }));

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const capturedAt = '2026-09-22T12:03:40.000Z';
// CI205 archived a complete draft with no declaration time before signature capture.
function unsignedApplication(): VendorApplicationSnapshot {
  return {
    policyVersion: 'vendor-accreditation-v2025', entityType: 'sole_prop', jurisdiction: 'PH',
    company: {
      tradeName: 'SYNTHETIC QA Vendor', contactNumber: '09000000000', businessAddress: 'SYNTHETIC QA ONLY',
      incorporationDate: '2025-01-01', incorporationPlace: 'SYNTHETIC QA', tin: '000-000-000-000',
      email: 'vendor@example.invalid', website: 'https://example.invalid', fax: '000000000',
      principalName: 'SYNTHETIC QA Owner', principalEmail: 'vendor@example.invalid', principalContactNumber: '09000000000',
      correspondenceName: 'SYNTHETIC QA Contact', correspondenceEmail: 'vendor@example.invalid',
      correspondenceContactNumber: '09000000000', productsOrServices: 'SYNTHETIC QA GOODS ONLY', businessType: 'sole_prop',
    },
    manpower: { countAndExpertise: 'Synthetic experience', qualifications: 'Synthetic qualifications', completedProjects: 'Synthetic projects' },
    technologyServiceProvider: false, technologyQualifications: [], fieldDispositions: {},
    declaration: { accepted: true, noLegalActions: true, disclosureDetails: '', verificationAuthorized: true,
      signerName: 'SYNTHETIC QA Signatory', signerTitle: 'SYNTHETIC QA ONLY', signedAt: '' },
  };
}

let root: Root, host: HTMLDivElement, draft: VendorApplicationSnapshot;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(capturedAt));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  mocks.canManage = true;
  mocks.kase.status = 'draft';
  draft = unsignedApplication();
  mocks.load.mockResolvedValue({ application: draft, version: 1, status: 'draft' });
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/vendor/cases/synthetic-case/application']}>
      <Routes><Route path="/vendor/cases/:id/application" element={<VendorApplicationPage />} /></Routes>
    </MemoryRouter>,
  ));
}
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find(element => element.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function captureSignature() {
  await act(async () => button('Type').click());
}
function expectNoWrites() {
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.discard).not.toHaveBeenCalled();
}

it('CI205: the real signature pad makes the completed unsigned draft submittable with its captured timestamp', async () => {
  expect(validateV2025Application(draft).errors).toEqual(['declaration.signedAt']);
  await mount();
  expect(button('Sign and submit').disabled).toBe(true);
  expect(host.textContent).toContain('1 fields incomplete');
  await captureSignature();
  expect(button('Sign and submit').disabled).toBe(false);
  expect(host.textContent).not.toContain('1 fields incomplete');
  expect(draft.declaration.signedAt).toBe('');
  expectNoWrites();
  await act(async () => button('Sign and submit').click());
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith('submit_vendor_application', { payload: {
    case_id: 'synthetic-case', expected_version: 1, idempotency_key: expect.any(String),
    application: { ...draft, declaration: { ...draft.declaration, signedAt: capturedAt } },
    declaration: { ...draft.declaration, signedAt: capturedAt },
    signature: { method: 'typed', dataUrl: png, signerName: draft.declaration.signerName, signedAt: capturedAt, userAgent: expect.any(String) },
  } });
  expect(draft.declaration.signedAt).toBe('');
  expect(host.textContent).not.toContain('Sign and submit');
});

it('returns to blocked when the captured signature is cleared without fabricating or saving a declaration time', async () => {
  await mount();
  await captureSignature();
  expect(button('Sign and submit').disabled).toBe(false);
  await act(async () => button('Draw').click());
  expect(button('Sign and submit').disabled).toBe(true);
  expect(host.textContent).toContain('1 fields incomplete');
  expect(draft.declaration.signedAt).toBe('');
  expectNoWrites();
});

it('does not treat a saved declaration timestamp as a fresh signature', async () => {
  draft.declaration.signedAt = '2026-01-01T00:00:00.000Z';
  await mount();
  expect(button('Sign and submit').disabled).toBe(true);
  expectNoWrites();
});

it('keeps other mandatory fields enforced after a valid signature is captured', async () => {
  draft.company.tin = '';
  await mount();
  await captureSignature();
  expect(button('Sign and submit').disabled).toBe(true);
  await act(async () => button('Sign and submit').click());
  expectNoWrites();
});

it.each(['submitted', 'capability-denied'])('does not expose submission for %s', async state => {
  if (state === 'submitted') {
    mocks.kase.status = 'submitted';
    draft.declaration.signedAt = capturedAt;
    mocks.load.mockResolvedValue({ application: draft, version: 1, status: 'submitted' });
  } else mocks.canManage = false;
  await mount();
  expect(host.textContent).not.toContain('Sign and submit');
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expectNoWrites();
});

it('does not announce a handoff when the governed submit RPC rejects', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Current submission authority required' } });
  await mount();
  await captureSignature();
  await act(async () => button('Sign and submit').click());
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(mocks.toast.error).toHaveBeenCalledWith('Current submission authority required');
  expect(button('Sign and submit').disabled).toBe(false);
});
