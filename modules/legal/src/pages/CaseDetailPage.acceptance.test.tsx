// @vitest-environment jsdom
import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CaseDetailPage } from './CaseDetailPage';
import { AccreditationCasesPage } from './AccreditationCasesPage';
import { signInstrument, useAccreditationDocs } from '../localStore';
import type { AccreditationCase, AccreditationDoc, RequirementChecklistItem } from '../types';

const session = vi.hoisted(() => ({
  profile: { kind: 'employee' as 'employee' | 'vendor', vendorId: 'vendor1', email: 'legal@example.test' },
  review: true, success: vi.fn(), error: vi.fn(),
}));
vi.mock('@intra/auth', async (original) => ({
  ...await original<typeof import('@intra/auth')>(),
  useSession: () => ({ mode: 'memory', profile: session.profile, supabaseClient: null }),
  useCan: (_module: string, cap: string) => cap === 'review_accreditation' ? session.review : cap === 'submit_documents',
  Guard: ({ children, cap }: PropsWithChildren<{ cap: string }>) =>
    cap === 'review_accreditation' && !session.review ? null : children,
}));
vi.mock('@intra/ui', async (original) => ({
  ...await original<typeof import('@intra/ui')>(),
  useToast: () => ({ success: session.success, error: session.error }),
}));

let root: Root;
let container: HTMLDivElement;
let docsApi: ReturnType<typeof useAccreditationDocs>;
function StoreProbe() { docsApi = useAccreditationDocs(); return null; }
const key = (name: string) => `intra.legal.v1.${name}`;
const read = <T,>(name: string): T[] => JSON.parse(localStorage.getItem(key(name)) ?? '[]');
const write = (name: string, rows: unknown[]) => localStorage.setItem(key(name), JSON.stringify(rows));
const items = (): RequirementChecklistItem[] => [1, 2, 3, 4].map((n) => ({
  id: `req${n}`, caseId: 'case1', requirement: n === 4 ? 'Confidentiality agreement' : `Company document ${n}`,
  required: true, decision: 'pending', documentIds: [], instrument: n === 4,
  ...(n === 4 ? { instrumentCode: 'nda_one_way' as const } : {}),
}));
async function mount(home = false) {
  await act(async () => root.render(<MemoryRouter initialEntries={['/cases/case1']}>
    <StoreProbe /><Routes><Route path="/cases/:id" element={home ? <AccreditationCasesPage /> : <CaseDetailPage />} /></Routes>
  </MemoryRouter>));
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function upload(n: number) {
  await act(async () => { await docsApi.upload({ caseId: 'case1', vendorId: 'vendor1', requirementId: `req${n}`,
    docType: 'company', filename: `company${n}.pdf`, mimeType: 'application/pdf', sizeBytes: 10 }); });
}
async function sign() {
  await act(async () => { signInstrument({ caseId: 'case1', code: 'nda_one_way', templateVersion: '2026.07.01',
    signerName: 'Vendor', signaturePng: 'data:image/png;base64,test', signatureMethod: 'typed', signerUa: 'local-test' }); });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  session.profile.kind = 'employee'; session.review = true;
  localStorage.clear();
  localStorage.setItem('intra.legal.v2.seeded', '1');
  localStorage.setItem('intra.legal.v2.checklist_migrated', '1');
  write('cases', [{ id: 'case1', vendorId: 'vendor1', vendorName: 'Vendor', status: 'submitted', openedAt: '2026-09-05T00:00:00Z' } satisfies AccreditationCase]);
  write('checklist', items());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('F08: requests a factual correction with all evidence approved and rejects an empty note', async () => {
  await mount();
  for (const n of [1, 2, 3]) await upload(n);
  await sign();
  await act(async () => root.unmount()); root = createRoot(container);
  write('checklist', items().map((item) => ({ ...item, decision: 'approved' })));
  write('docs', read<AccreditationDoc>('docs').map((doc) => ({ ...doc, status: 'approved' })));
  await mount();
  expect(container.textContent).not.toContain('Record manual reminder');
  await click('Request correction'); await click('Send correction request');
  expect(read<AccreditationCase>('cases')[0]?.status).toBe('submitted');
  expect(session.error).toHaveBeenCalledWith('Enter the correction required from the vendor.');
  const note = container.querySelector<HTMLTextAreaElement>('#correction-note')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Correct the registered company address.');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Send correction request');
  expect(read<AccreditationCase>('cases')[0]).toMatchObject({ status: 'correction_requested',
    correctionRequest: { note: 'Correct the registered company address.', sourceVersion: 1, revision: 2 } });
  expect(read('timeline')).toHaveLength(5);
});

it.each(['vendor', 'unprivileged'] as const)('F08: does not expose factual correction to %s', async (actor) => {
  session.profile.kind = actor === 'vendor' ? 'vendor' : 'employee'; session.review = false;
  await mount(); expect(container.textContent).not.toContain('Request correction');
});

it('F10: records one manual reminder and displays honest feedback and timeline copy', async () => {
  await mount(); await click('Record manual reminder');
  expect(session.success).toHaveBeenCalledWith('Manual reminder recorded. No email or notification was sent.');
  const events = read<{ action: string; detail: string }>('timeline');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ action: 'reminder_sent', detail: expect.stringContaining('No automatic message was sent.') });
  expect(read<AccreditationCase>('cases')[0]?.lastReminderAt).toBeTruthy();
  expect(container.textContent).toContain('Manual follow-up recorded; automatic delivery is not confirmed.');
  expect(container.textContent).not.toContain('Send reminder');
});

it('F10: a failed local record reports failure, and retry creates only one manual event', async () => {
  await mount();
  const cases = read<AccreditationCase>('cases');
  write('cases', []);
  await click('Record manual reminder');
  expect(session.error).toHaveBeenCalledWith('Could not record the reminder.');
  expect(session.success).not.toHaveBeenCalled();
  expect(read('timeline')).toHaveLength(0);
  write('cases', cases);
  await click('Record manual reminder');
  expect(read('timeline')).toHaveLength(1);
  expect(session.success).toHaveBeenCalledTimes(1);
});

it('V05: actual home and detail counts react to document uploads and an agreement signature', async () => {
  session.profile.kind = 'vendor'; session.review = false;
  write('cases', read<AccreditationCase>('cases').map((kase) => ({ ...kase, status: 'draft' })));
  await mount(true);
  expect(container.textContent).toContain('You still owe 3 documents');
  expect(container.textContent).toContain('1 agreement awaiting your signature');
  await mount(); expect(container.textContent).toContain('You still owe 4 requirements');
  await upload(1); expect(container.textContent).toContain('You still owe 3 requirements');
  await mount(true); expect(container.textContent).toContain('You still owe 2 documents');
  expect(container.textContent).toContain('1 agreement awaiting your signature');
  await sign(); expect(container.textContent).not.toContain('agreement awaiting your signature');
  await mount(); expect(container.textContent).toContain('You still owe 2 requirements');
  await upload(2); await upload(3);
  expect(container.textContent).not.toContain('You still owe');
  await mount(true); expect(container.textContent).not.toContain('You still owe');
});

it('V05: sticky next action counts requirements, including one remaining unsigned agreement', async () => {
  session.profile.kind = 'vendor'; session.review = false;
  write('cases', read<AccreditationCase>('cases').map((kase) => ({ ...kase, status: 'draft' })));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: false }]); }
    disconnect() {}
  });
  await mount();
  expect(container.textContent).toContain('You still owe 4 requirements');
  expect(container.textContent).toContain('4 requirements remaining');
  expect(container.textContent).not.toContain('4 to upload');
  for (const n of [1, 2, 3]) await upload(n);
  expect(container.textContent).toContain('1 requirement remaining');
  expect(container.textContent).not.toContain('1 requirements remaining');
  await sign();
  expect(container.textContent).not.toContain('requirement remaining');
  expect(container.textContent).toContain('Ready to submit');
});

it('V02: keeps the case queue compact, all count filters usable, and lifecycle separate', async () => {
  await mount(true);
  const workspace = container.querySelector('[data-testid="legal-case-workspace"]')!;
  expect(workspace.className).toContain('space-y-3');
  expect(workspace.querySelector('h1')?.textContent).toBe('Vendor accreditation');
  expect(workspace.textContent).not.toContain('Vendor accreditation workspace');
  const filters = workspace.querySelector('[aria-label="Case queue filters"]')!;
  expect(filters.className).toContain('grid-cols-2');
  expect(filters.className).toContain('lg:grid-cols-4');
  expect(filters.querySelectorAll('button')).toHaveLength(4);
  for (const label of ['Waiting on vendor: 1', 'Waiting on Legal: 0', 'Ready for decision: 0', 'Renewals: 0']) {
    const button = filters.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(button.className).toContain('min-h-11');
    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
  }
  expect(container.textContent).not.toContain('Eligibility recovery controls');
  expect(container.querySelector('button[aria-label="Waiting on vendor: 1"]')).not.toBeNull();
  await click('Vendor lifecycle');
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBeTruthy();
  await click('Accreditation cases');
  expect(container.textContent).not.toContain('Eligibility recovery controls');
});
