// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApprovalInboxPage } from './ApprovalInboxPage';
import { tierLabel } from '../policy';
import { resolveTiers } from '../tiers';
import type { ProcurementRequest } from '../types';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    rpc, schema: vi.fn(() => ({ rpc })), decide: vi.fn(), refresh: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});
let rows: ProcurementRequest[];
let loading: boolean;
let readError: string | undefined;
let session: {
  mode: 'supabase' | 'memory';
  loading: boolean;
  capabilityStatus: 'ready' | 'pending' | 'error';
  profile: { id: string; name: string; email: string };
  userRoles: { procurement: string[] };
  userCapabilities: { procurement: string[] };
  supabaseClient: { schema: typeof mocks.schema };
};
vi.mock('@intra/auth', () => ({
  useSession: () => session,
  useCan: (_module: string, cap: string) => cap === 'approve_request',
  Guard: () => <p>Access denied</p>,
}));
vi.mock('../localStore', () => ({
  useProcurementRequests: () => ({ rows, loading, error: readError, decide: mocks.decide, refresh: mocks.refresh }),
}));
vi.mock('@intra/ui', async () => ({ ...await vi.importActual('@intra/ui'), useToast: () => mocks.toast }));

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const signedAt = '2026-09-22T15:00:00.000Z';
type Eligibility = { data: { canDecide: boolean; stepId?: unknown } | null; error: { message: string } | null };
const eligible: Eligibility = { data: { canDecide: true, stepId: 'doa-step' }, error: null };
const denied: Eligibility = { data: { canDecide: false }, error: null };
function deferredEligibility() {
  let resolve!: (value: Eligibility) => void;
  const promise = new Promise<Eligibility>(done => { resolve = done; });
  return { promise, resolve };
}
function request(): ProcurementRequest {
  return {
    id: 'synthetic-doa-request', title: 'Synthetic scoped DOA request', status: 'under_review',
    requesterId: 'synthetic-requester', requesterEmail: 'requester@example.invalid', requesterName: 'Synthetic Requester',
    department: 'Synthetic Operations', category: 'goods', estimatedAmount: 1200, revision: 1, createdAt: '2026-09-21T09:00:00Z',
    lines: [{ id: 'synthetic-line', description: 'Synthetic required item', quantity: 2, unitPrice: 600 }],
    justification: { need: 'Synthetic business need' },
    approvalSteps: [
      { id: 'dept-step', order: 1, tier: 'dept_head', status: 'approved', assignedUserId: 'prior-approver' },
      { id: 'procurement-step', order: 2, tier: 'procurement_head', status: 'approved', assignedUserId: 'prior-officer' },
      { id: 'doa-step', order: 3, tier: 'final_approver', status: 'pending', assignedUserId: 'synthetic-doa-approver', requestVersion: 1, matrixVersion: 1 },
    ],
  };
}

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(signedAt));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  session = {
    mode: 'supabase', loading: false, capabilityStatus: 'ready',
    profile: { id: 'synthetic-doa-approver', name: 'Synthetic DOA Approver', email: 'doa@example.invalid' },
    userRoles: { procurement: ['approver'] }, userCapabilities: { procurement: ['approve_request'] },
    supabaseClient: { schema: mocks.schema },
  };
  rows = [request()];
  loading = false;
  readError = undefined;
  mocks.rpc.mockReset().mockResolvedValue(eligible);
  mocks.decide.mockReset().mockImplementation(async (_id, decision) => ({
    ...rows[0], status: decision,
    approvalSteps: rows[0]!.approvalSteps!.map(step => step.status === 'pending' ? { ...step, status: decision } : step),
  }));
  mocks.refresh.mockReset().mockResolvedValue(undefined);
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
async function render() {
  await act(async () => root.render(<MemoryRouter><ApprovalInboxPage /></MemoryRouter>));
}
function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
}
function button(label: string) {
  const found = findButton(label);
  expect(found, label).toBeDefined();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function expectViewOnly(decisionCalls = 0) {
  expect(findButton('Approve')).toBeUndefined();
  expect(findButton('Reject')).toBeUndefined();
  expect(host.textContent).toContain('In flight (other tiers)');
  expect(host.textContent).toContain(rows[0]!.title);
  expect(mocks.decide).toHaveBeenCalledTimes(decisionCalls);
}

it('allows a server-eligible DOA-assigned final approval with only procurement.approver and sends the actual pending tier', async () => {
  expect(resolveTiers(session.userRoles)).toEqual(['dept_head']);
  await render();
  expect(mocks.schema).toHaveBeenCalledWith('procurement');
  expect(mocks.rpc).toHaveBeenCalledWith('request_decision_eligibility', { payload: { request_id: rows[0]!.id } });
  const pending = host.querySelector('#inbox-pending')!;
  expect(pending.textContent).toContain('Step 3 of 3');
  expect(pending.textContent).toContain(tierLabel('final_approver'));
  await click('Approve');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(rows[0]!.title);
  expect(dialog.textContent).toContain('Synthetic required item');
  expect(dialog.textContent).toContain('Synthetic business need');
  expect(dialog.textContent).toContain('Step 3 of 3');
  expect(dialog.textContent).toContain(tierLabel('final_approver'));
  expect(button('Sign & approve').disabled).toBe(false);
  expect(mocks.decide).not.toHaveBeenCalled();
  await click('Sign & approve');
  expect(mocks.toast.error.mock.calls).toEqual([]);
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith(rows[0]!.id, 'approved', {
    email: session.profile.email, note: '', tier: 'final_approver',
    signature: { method: 'typed', dataUrl: png, signerName: session.profile.name, signedAt, userAgent: expect.any(String) },
  });
  expect(mocks.toast.error).not.toHaveBeenCalled();
  expect(mocks.toast.success).toHaveBeenCalledWith('Request approved');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('sends a final-step rejection without requiring or fabricating an approval signature', async () => {
  await render();
  await click('Reject');
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain(tierLabel('final_approver'));
  await fill(document.querySelector<HTMLTextAreaElement>('#approval-note')!, 'Synthetic rejection reason');
  await click('Confirm reject');
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith(rows[0]!.id, 'rejected', {
    email: session.profile.email, note: 'Synthetic rejection reason', tier: 'final_approver', signature: undefined,
  });
  expect(mocks.toast.success).toHaveBeenCalledWith('Request rejected');
});

it.each(['false', 'rpc-error', 'rejected', 'missing-data', 'self', 'different-assignment'])('is view-only when server eligibility denies or cannot verify: %s', async reason => {
  if (reason === 'self') rows[0]!.requesterId = session.profile.id;
  if (reason === 'different-assignment') rows[0]!.approvalSteps![2]!.assignedUserId = 'different-approver';
  if (reason === 'rpc-error') mocks.rpc.mockResolvedValue({ data: { canDecide: true }, error: { message: 'Eligibility unavailable' } });
  else if (reason === 'rejected') mocks.rpc.mockRejectedValue(new Error('Eligibility unavailable'));
  else if (reason === 'missing-data') mocks.rpc.mockResolvedValue({ data: null, error: null });
  else mocks.rpc.mockResolvedValue(denied);
  await render();
  expectViewOnly();
});

it('keeps the final step view-only while server eligibility is loading', async () => {
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  await render();
  expectViewOnly();
  await act(async () => lookup.resolve(eligible));
  expect(button('Approve').disabled).toBe(false);
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('does not expose a decision while request loading is in progress', async () => {
  loading = true;
  await render();
  expect(findButton('Approve')).toBeUndefined();
  expect(findButton('Reject')).toBeUndefined();
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('closes an already-open sheet on reassignment and stays blocked while eligibility loads or denies', async () => {
  await render();
  await click('Approve');
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  rows = [{ ...rows[0]!, approvalSteps: rows[0]!.approvalSteps!.map(step =>
    step.id === 'doa-step' ? { ...step, assignedUserId: 'different-approver' } : step) }];
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(findButton('Approve')).toBeUndefined();
  expect(mocks.decide).not.toHaveBeenCalled();
  await act(async () => lookup.resolve(denied));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(findButton('Approve')).toBeUndefined();
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('keeps the explicit self-approval sheet guard even if eligibility erroneously returns true', async () => {
  rows[0]!.requesterEmail = session.profile.email;
  await render();
  await click('Approve');
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('You cannot approve or reject your own request.');
  expect(button('Sign & approve').disabled).toBe(true);
  await click('Sign & approve');
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('does not claim approval when the governed decision rejects previously valid eligibility', async () => {
  mocks.rpc.mockResolvedValueOnce(eligible).mockResolvedValue(denied);
  mocks.decide.mockRejectedValue(new Error('DOA assignment is no longer effective'));
  await render();
  await click('Approve');
  await click('Sign & approve');
  expect(mocks.decide).toHaveBeenCalledTimes(1);
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(mocks.toast.error).toHaveBeenCalledWith('DOA assignment is no longer effective');
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expectViewOnly(1);
});

it('does not widen memory-mode tiers to grant procurement.approver final approval', async () => {
  session.mode = 'memory';
  await render();
  expectViewOnly();
  expect(resolveTiers(session.userRoles)).toEqual(['dept_head']);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each([undefined, null, '', 3, 'different-step', 'dept-step'])('denies true eligibility with missing/invalid/nonpending stepId %s', async stepId => {
  mocks.rpc.mockResolvedValue({ data: { canDecide: true, stepId }, error: null });
  await render();
  expectViewOnly();
});

const contextChanges: Array<[string, (row: ProcurementRequest) => void]> = [
  ['department', row => { row.department = 'Synthetic Marketing'; }],
  ['category', row => { row.category = 'capex'; }],
  ['amount', row => { row.estimatedAmount = 2400; }],
  ['request revision', row => { row.revision = 2; }],
  ['step request version', row => { row.approvalSteps![2]!.requestVersion = 2; }],
  ['matrix version', row => { row.approvalSteps![2]!.matrixVersion = 2; }],
  ['pending step identity', row => { row.approvalSteps![2]!.id = 'replacement-doa-step'; }],
  ['pending step tier', row => { row.approvalSteps![2]!.tier = 'finance'; }],
  ['pending step order', row => { row.approvalSteps![2]!.order = 4; }],
  ['requester identity', row => { row.requesterId = 'replacement-requester'; }],
  ['requester email', row => { row.requesterEmail = 'replacement@example.invalid'; }],
  ['displayed request title', row => { row.title = 'Revised synthetic request'; }],
  ['displayed lines', row => { row.lines[0]!.quantity = 3; }],
];
it.each(contextChanges)('invalidates eligibility and closes the stale sheet when %s changes', async (_label, change) => {
  await render();
  await click('Approve');
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  rows = structuredClone(rows);
  change(rows[0]!);
  await render();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expectViewOnly();
  await act(async () => lookup.resolve(denied));
  expectViewOnly();
});

it.each(['id', 'email', 'name', 'roles', 'capabilities'])('invalidates an open decision when actor %s changes', async field => {
  await render();
  await click('Approve');
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  if (field === 'roles') session.userRoles = { procurement: [] };
  else if (field === 'capabilities') session.userCapabilities = { procurement: [] };
  else session.profile = { ...session.profile, [field]: `replacement-${field}` };
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expectViewOnly();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  await act(async () => lookup.resolve(denied));
});

it.each(['request-loading', 'request-error', 'session-loading', 'capability-pending', 'capability-error'])('invalidates an open decision during %s and rechecks unchanged rows after recovery', async state => {
  await render();
  await click('Approve');
  if (state === 'request-loading') loading = true;
  if (state === 'request-error') readError = 'Request refresh failed';
  if (state === 'session-loading') session.loading = true;
  if (state === 'capability-pending') session.capabilityStatus = 'pending';
  if (state === 'capability-error') session.capabilityStatus = 'error';
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(findButton('Approve')).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  loading = false;
  readError = undefined;
  session.loading = false;
  session.capabilityStatus = 'ready';
  await render();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expectViewOnly();
  await act(async () => lookup.resolve(eligible));
  expect(button('Approve').disabled).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('ignores an old successful lookup arriving after a context change and a newer denial', async () => {
  const oldLookup = deferredEligibility(), newLookup = deferredEligibility();
  mocks.rpc.mockReturnValueOnce(oldLookup.promise).mockReturnValueOnce(newLookup.promise);
  await render();
  rows = [{ ...rows[0]!, estimatedAmount: 2400 }];
  await render();
  await act(async () => newLookup.resolve(denied));
  await act(async () => oldLookup.resolve(eligible));
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expectViewOnly();
});

it('clears the captured signature and note instead of carrying them into changed request facts', async () => {
  await render();
  await click('Approve');
  await click('Type');
  await fill(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, 'Old captured signer');
  await fill(document.querySelector<HTMLTextAreaElement>('#approval-note')!, 'Old decision note');
  rows = [{ ...rows[0]!, estimatedAmount: 2400 }];
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const later = '2026-09-22T15:05:00.000Z';
  vi.setSystemTime(new Date(later));
  await click('Approve');
  expect(document.querySelector<HTMLTextAreaElement>('#approval-note')!.value).toBe('');
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe(session.profile.name);
  await click('Sign & approve');
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith(rows[0]!.id, 'approved', expect.objectContaining({
    note: '', signature: expect.objectContaining({ signerName: session.profile.name, signedAt: later }),
  }));
});

it('rechecks same-key rows after a rejected decision and requires opening a fresh sheet', async () => {
  let finishRefresh!: () => void;
  mocks.refresh.mockReturnValue(new Promise<void>(resolve => { finishRefresh = resolve; }));
  mocks.decide.mockRejectedValueOnce(new Error('Policy changed; refresh required'));
  await render();
  await click('Approve');
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  await click('Sign & approve');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expectViewOnly(1);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await act(async () => finishRefresh());
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expectViewOnly(1);
  await act(async () => lookup.resolve(eligible));
  expect(button('Approve').disabled).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.toast.success).not.toHaveBeenCalled();
  await click('Approve');
  await click('Sign & approve');
  expect(mocks.decide).toHaveBeenCalledTimes(2);
  expect(mocks.toast.success).toHaveBeenCalledWith('Request approved');
});

it('stays closed and denied when refresh throws, then rechecks the same rows after an explicit retry', async () => {
  mocks.decide.mockRejectedValueOnce(new Error('Policy changed; refresh required'));
  mocks.refresh.mockRejectedValueOnce(new Error('Request refresh failed'));
  await render();
  await click('Approve');
  await click('Sign & approve');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('Request refresh failed');
  expectViewOnly(1);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const lookup = deferredEligibility();
  mocks.rpc.mockReturnValue(lookup.promise);
  await click('Retry requests');
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expectViewOnly(1);
  await act(async () => lookup.resolve(eligible));
  expect(button('Approve').disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.decide).toHaveBeenCalledTimes(1);
});

it('does not discard signing intent or requery when an unchanged row is merely rerendered', async () => {
  await render();
  await click('Approve');
  await fill(document.querySelector<HTMLTextAreaElement>('#approval-note')!, 'Unchanged reviewed facts');
  rows = structuredClone(rows);
  await render();
  expect(button('Sign & approve').disabled).toBe(false);
  expect(document.querySelector<HTMLTextAreaElement>('#approval-note')!.value).toBe('Unchanged reviewed facts');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('retains the open sheet through inconsequential profile metadata refreshes', async () => {
  await render();
  await click('Approve');
  await fill(document.querySelector<HTMLTextAreaElement>('#approval-note')!, 'Reviewed facts');
  session.profile = Object.assign({}, session.profile, { title: 'Updated display title', lastActiveAt: '2026-09-22T15:01:00Z' });
  await render();
  expect(button('Sign & approve').disabled).toBe(false);
  expect(document.querySelector<HTMLTextAreaElement>('#approval-note')!.value).toBe('Reviewed facts');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.decide).not.toHaveBeenCalled();
});

it('keeps the existing memory sheet and tier authority unchanged when request facts refresh', async () => {
  session.mode = 'memory';
  rows[0]!.approvalSteps = [{ id: 'dept-step', order: 1, tier: 'dept_head', status: 'pending', assignedUserId: session.profile.id }];
  await render();
  await click('Approve');
  rows = [{ ...rows[0]!, estimatedAmount: 2400 }];
  await render();
  expect(button('Sign & approve').disabled).toBe(false);
  await click('Sign & approve');
  expect(mocks.decide).toHaveBeenCalledWith(rows[0]!.id, 'approved', expect.objectContaining({ tier: 'dept_head' }));
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('retains the existing memory-mode department-head decision path', async () => {
  session.mode = 'memory';
  rows[0]!.approvalSteps = [{ id: 'dept-step', order: 1, tier: 'dept_head', status: 'pending', assignedUserId: session.profile.id }];
  await render();
  await click('Approve');
  await click('Sign & approve');
  expect(mocks.decide).toHaveBeenCalledWith(rows[0]!.id, 'approved', expect.objectContaining({ tier: 'dept_head' }));
  expect(mocks.rpc).not.toHaveBeenCalled();
});
