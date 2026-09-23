// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@intra/ui';
import { SourcingWorkspace } from './SourcingWorkspace';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@intra/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@intra/ui')>(), useToast: () => toast,
}));

let root: Root, host: HTMLDivElement;
const requestId = 'req_11111111-1111-4111-8111-111111111111';
const evaluation = { commercialTabulations: [], technicalEvaluations: [], awardRecommendation: null, varianceDecisions: [] };
const event = { id: 'event-1', status: 'draft', responses: [], communications: [], ...evaluation,
  varianceDecisionsVisible: true, varianceEligibility: { canReview: false } };
const empty = () => ({ data: { requestId, event: null }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type SourcingClient = NonNullable<ComponentProps<typeof SourcingWorkspace>['client']>;
async function mount(rpc: ReturnType<SourcingClient['schema']>['rpc'], canManage = true) {
  const schema = vi.fn(() => ({ rpc }));
  await act(async () => { root.render(createElement(SourcingWorkspace, {
    requestId, method: 'rfq', canManage, canApprove: false, client: { schema }, vendors: [],
  })); });
  return schema;
}
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('SourcingWorkspace', () => {
  it.each([
    [null, 'Prepare the sourcing plan and controlled package before inviting vendors and issuing it.'],
    ['draft', 'Complete the plan and accredited vendor invitations, then issue the controlled package when the governed checks permit.'],
    ['issued', 'Record vendor responses and equal communications while the response window is open. Close the window through the governed transition before evaluation.'],
    ['response_closed', 'The response window is closed. Open evaluation when the governed checks permit, then document commercial and technical evidence.'],
    ['evaluation', 'Review commercial and technical evidence and the explicit best-value recommendation. Any required independent review and the controlled award remain separate steps.'],
    ['failed_bid', 'Use the failed-bid recovery controls for requote, extension, or an independently reviewed evaluation exception.'],
    ['awarded', 'The sourcing award is recorded. Review the retained recommendation and award evidence.'],
    ['cancelled', 'This sourcing event is cancelled. Review its retained history; do not continue its response or evaluation steps.'],
  ])('shows only the current %s stage advice without dispatching a command', async (status, guidance) => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'sourcing_workspace'
      ? { requestId, event: status === null ? null : { ...event, status } } : null, error: null }));
    await mount(rpc);
    expect(host.querySelector('[aria-label="Sourcing stage guidance"]')?.textContent).toBe(guidance);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(status === null ? ['sourcing_workspace'] : ['sourcing_workspace', 'insufficient_bid_exception']);
    if (status === 'draft') {
      expect(host.textContent).toContain('Accredited invitees0');
      const issue = [...host.querySelectorAll('button')].find(button => button.textContent === 'Issue controlled package');
      expect(issue?.disabled).toBe(true);
      expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Close response window')).toBe(false);
    }
  });

  it('does not invent stage advice while the read is pending or denied', async () => {
    const read = deferred<{ data: null; error: { message: string } }>();
    const rpc = vi.fn(() => read.promise);
    await mount(rpc);
    expect(host.querySelector('[aria-label="Sourcing stage guidance"]')).toBeNull();
    await act(async () => read.resolve({ data: null, error: { message: 'Denied' } }));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Sourcing stage guidance"]')).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps governed sourcing unavailable without a database client', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, {
      children: createElement(SourcingWorkspace, {
        requestId: 'request-1',
        method: 'rfq',
        canManage: true,
        canApprove: false,
        client: null,
        vendors: [],
      }),
    }));

    expect(html).toContain('Connect to the live database to operate governed sourcing.');
    expect(html).toContain('MPIC Procurement Policy February2025.docx');
    expect(html).not.toContain('Approved insufficient-bids exception is attached');
  });

  it.each([true, false])('loads confirmed no-event state without exception or variance reads (manager=%s)', async canManage => {
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace' ? empty()
      : { data: null, error: { message: 'No governed variance decision is assigned to this account for this request.' } });
    const schema = await mount(rpc, canManage);
    expect(rpc.mock.calls).toEqual([['sourcing_workspace', { payload: { request_id: requestId } }]]);
    expect(schema).toHaveBeenCalledWith('procurement');
    expect(toast.error).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Not started');
    expect(host.textContent?.includes('Create plan')).toBe(canManage);
  });

  it('waits for the sourcing result before dispatching existing-event dependent reads', async () => {
    const first = deferred<{ data: unknown; error: null }>();
    const rpc = vi.fn((name: string) => name === 'sourcing_workspace' ? first.promise
      : Promise.resolve({ data: name === 'evaluation_workspace' ? evaluation : null, error: null }));
    await mount(rpc);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace']);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => first.resolve({ data: { requestId, event }, error: null }));
    expect(rpc.mock.calls).toEqual(['sourcing_workspace', 'insufficient_bid_exception']
      .map(name => [name, { payload: { request_id: requestId } }]));
    expect(host.textContent).toContain('Save plan');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([null, {}, { requestId }, { requestId, event: false }, { requestId: 'other-request', event: null }])(
    'does not present an incomplete or foreign sourcing read as no event: %j', async data => {
      const rpc = vi.fn(async () => ({ data, error: null }));
      await mount(rpc);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(host.textContent).toContain('Retry sourcing');
      expect(host.textContent).not.toContain('Not started');
      expect(host.textContent).not.toContain('Create plan');
      expect(rpc).toHaveBeenCalledTimes(1);
    });

  it('does not convert a denied sourcing read to no event and retries only the read', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'Sourcing access denied' } }).mockResolvedValue(empty());
    await mount(rpc);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Sourcing access denied');
    expect(host.textContent).not.toContain('Create plan');
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry sourcing');
    expect(retry).toBeDefined();
    expect(retry?.className).toContain('min-h-11');
    await act(async () => retry!.click());
    expect(rpc.mock.calls).toEqual([1, 2].map(() => ['sourcing_workspace', { payload: { request_id: requestId } }]));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Not started');
  });

  it.each(['insufficient_bid_exception'])('keeps an existing-event %s denial visible without inventing empty evidence', async denied => {
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace' ? { data: { requestId, event }, error: null }
      : name === denied ? { data: null, error: { message: 'Current governed access denied' } }
      : { data: name === 'evaluation_workspace' ? evaluation : null, error: null });
    await mount(rpc);
    expect(toast.error).toHaveBeenCalledWith('Current governed access denied');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Not started');
    expect(host.textContent).not.toContain('Create plan');
    expect(host.textContent).not.toContain('Save plan');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('reads a draft event without invoking the variance-only RPC and retries a failed dependent read without writes', async () => {
    let deny = true;
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace' ? { data: { requestId, event }, error: null }
      : name === 'insufficient_bid_exception' ? { data: null, error: deny ? { message: 'Read interrupted' } : null }
      : { data: null, error: { message: 'Variance reviewer only' } });
    await mount(rpc);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    deny = false;
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry sourcing')!.click());
    expect(host.textContent).toContain('Save plan');
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'insufficient_bid_exception', 'sourcing_workspace', 'insufficient_bid_exception']);
  });

  it('keeps plan creation payload and subsequent governed read unchanged', async () => {
    let created = false;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'sourcing_workspace') return { data: { requestId, event: created ? event : null }, error: null };
      if (name === 'save_sourcing_event') { created = true; return { data: { id: event.id }, error: null }; }
      return { data: null, error: name === 'insufficient_bid_exception' ? null : { message: 'Unexpected RPC' } };
    });
    await mount(rpc);
    for (const [label, value] of [['Submission deadline', '2030-01-15T12:00'], ['Package version', 'RFQ-READ-v1'], ['Package SHA-256', 'a'.repeat(64)]]) {
      const input = host.querySelector(`input[aria-label="${label}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const create = [...host.querySelectorAll('button')].find(button => button.textContent === 'Create plan')!;
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'save_sourcing_event', 'sourcing_workspace', 'insufficient_bid_exception']);
    expect(rpc).toHaveBeenCalledWith('save_sourcing_event', { payload: { request_id: requestId,
      submission_deadline: new Date('2030-01-15T12:00').toISOString(), intended_responses: 3, package_version: 'RFQ-READ-v1', package_hash: 'a'.repeat(64) } });
    expect(host.textContent).toContain('Save plan'); expect(toast.error).not.toHaveBeenCalled();
  });

  it.each(['2026-09-24T09:00:00Z', '2026-09-24T17:00:00+08:00', '2026-09-24T02:00:00-07:00'])(
    'preserves the deadline instant when reopening and saving an existing plan: %s', async submissionDeadline => {
      const savedEvent = { ...event, submissionDeadline, packageVersion: 'SPEC-v1', packageHash: 'a'.repeat(64) };
      const rpc = vi.fn(async (name: string) => ({ data: name === 'sourcing_workspace'
        ? { requestId, event: savedEvent } : null, error: null }));
      await mount(rpc);
      const date = new Date(submissionDeadline);
      const pad = (value: number) => String(value).padStart(2, '0');
      const localValue = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      expect(host.querySelector<HTMLInputElement>('input[aria-label="Submission deadline"]')?.value).toBe(localValue);
      const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save plan')!;
      expect(save.disabled).toBe(false);
      await act(async () => save.click());
      expect(rpc).toHaveBeenCalledWith('save_sourcing_event', { payload: { request_id: requestId,
        submission_deadline: date.toISOString(), intended_responses: 3, package_version: 'SPEC-v1', package_hash: 'a'.repeat(64) } });
      expect(toast.error).not.toHaveBeenCalled();
    });

  it.each([{}, [], { id: 'exception-1', status: 'approved', justification: {} }])('rejects malformed exception without showing stale actions: %j', async data => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'sourcing_workspace' ? { requestId, event } : data, error: null }));
    await mount(rpc);
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain('Save plan');
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'insufficient_bid_exception']);
  });

  it.each([
    {}, [], { ...event, id: '' }, { ...event, status: 'unknown' }, { ...event, responses: {} },
    { ...event, responses: [null] }, { ...event, responses: [{ id: 'r', vendorId: 'v', vendorName: {} }] },
    { ...event, communications: [{}] }, { ...event, commercialTabulations: undefined },
    { ...event, technicalEvaluations: {} }, { ...event, technicalEvaluations: [null] },
    { ...event, awardRecommendation: undefined }, { ...event, awardRecommendation: {} },
    { ...event, varianceDecisionsVisible: undefined }, { ...event, varianceDecisionsVisible: false },
    { ...event, varianceDecisions: undefined }, { ...event, varianceDecisions: [{}] },
    { ...event, varianceEligibility: { canReview: 'true' } },
    { ...event, varianceEligibility: { canReview: true } },
    { ...event, submissionDeadline: {} }, { ...event, policyControls: { inviteTargetMin: {} } },
  ])('rejects malformed event/evidence before dependent reads: %j', async malformed => {
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace'
      ? { data: { requestId, event: malformed }, error: null } : { data: null, error: null });
    await mount(rpc);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Create plan');
    expect(host.textContent).not.toContain('Save plan');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  const persistedEvent = () => ({ ...event, status: 'evaluation',
    responses: [{ id: 'response-1', vendorId: 'vendor-1', vendorName: 'Reviewed vendor', receivedAt: '2026-09-01T00:00:00Z', commercial: { amount: 100 } }],
    commercialTabulations: [{ id: 'tab-1', sourcingEventId: event.id, version: 1, entries: [], status: 'submitted',
      evidenceReference: 'private/tabulation.pdf', dueAt: '2026-09-02T00:00:00Z', responseClosedAt: '2026-09-01T00:00:00Z', escalationStatus: 'on_track' }],
    technicalEvaluations: [{ id: 'tech-1', sourcingEventId: event.id, vendorId: 'vendor-1', version: 1, criteria: [], status: 'submitted',
      evidenceReference: 'private/technical.pdf', totalScore: 92, dueAt: '2026-09-03T00:00:00Z', escalationStatus: 'on_track' }],
    awardRecommendation: { id: 'recommendation-1', sourcingEventId: event.id, version: 2, evaluatedVendorId: 'vendor-1', recommendedVendorId: 'vendor-1',
      commercialTabulationId: 'tab-1', technicalEvaluationId: 'tech-1', rationale: 'Persisted reviewed rationale', status: 'pending_variance', createdAt: '2026-09-03T00:00:00Z' },
    varianceDecisions: [{ id: 'decision-1', awardRecommendationId: 'recommendation-1', decisionType: 'department_head', decision: 'approved',
      rationale: 'Independent prior decision', decidedByName: 'Reviewed approver', decidedAt: '2026-09-03T00:00:00Z' }],
    varianceEligibility: { canReview: false, nextStage: 'finance' },
  });

  it('renders persisted sourcing-owned evidence without granting a manager variance authority', async () => {
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace' ? { data: { requestId, event: persistedEvent() }, error: null }
      : name === 'insufficient_bid_exception' ? { data: null, error: null } : { data: null, error: { message: 'Variance reviewer only' } });
    await mount(rpc);
    expect(host.textContent).toContain('private/tabulation.pdf');
    expect(host.textContent).toContain('private/technical.pdf');
    expect(host.textContent).toContain('Persisted reviewed rationale');
    expect(host.textContent).toContain('Reviewed approver');
    expect(host.textContent).not.toContain('Record Finance approval');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'insufficient_bid_exception']);
  });

  it('keeps withheld variance history distinct from a confirmed empty collection', async () => {
    const { varianceDecisions: _history, ...data } = persistedEvent();
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace'
      ? { data: { requestId, event: { ...data, varianceDecisionsVisible: false, varianceEligibility: { canReview: false } } }, error: null }
      : { data: null, error: null });
    await mount(rpc, false);
    expect(host.textContent).toContain('Variance decision history is not available to this account.');
    expect(host.textContent).toContain('Persisted reviewed rationale');
    expect(host.textContent).not.toContain('Reviewed approver');
    expect(host.textContent).not.toContain('Record Finance approval');
    expect(host.textContent).not.toContain('Save commercial tabulation');
    expect(host.textContent).toContain('Next variance stage: Stage unavailable.');
    expect(host.textContent).not.toContain('Next variance stage: Finance.');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('retains independent review controls only for a complete server eligibility result', async () => {
    const current = { ...persistedEvent(), varianceEligibility: { canReview: true, nextStage: 'finance',
      doaMatrixId: 'matrix-1', doaMatrixVersion: 'reviewed-1', doaAssignmentId: 'assignment-1' } };
    const rpc = vi.fn(async (name: string) => ({ data: name === 'sourcing_workspace' ? { requestId, event: current } : null, error: null }));
    await mount(rpc, false);
    expect(host.textContent).toContain('Record Finance approval');
    expect(host.textContent).not.toContain('Save commercial tabulation');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'insufficient_bid_exception']);
  });

  it.each([false, true])('keeps the approved-award action management-only (manager=%s)', async canManage => {
    const current = persistedEvent(); current.awardRecommendation.status = 'approved';
    const rpc = vi.fn(async (name: string) => ({ data: name === 'sourcing_workspace' ? { requestId, event: current } : null, error: null }));
    await mount(rpc, canManage);
    expect(host.textContent).toContain('Persisted reviewed rationale');
    expect(host.textContent?.includes('Record controlled award')).toBe(canManage);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sourcing_workspace', 'insufficient_bid_exception']);
  });

  it.each(['commercialTabulations', 'technicalEvaluations', 'awardRecommendation'])('rejects %s belonging to another event', async field => {
    const data = persistedEvent();
    if (field === 'awardRecommendation') data.awardRecommendation.sourcingEventId = 'foreign-event';
    else data[field as 'commercialTabulations' | 'technicalEvaluations'][0]!.sourcingEventId = 'foreign-event';
    const rpc = vi.fn(async () => ({ data: { requestId, event: data }, error: null }));
    await mount(rpc);
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
});
