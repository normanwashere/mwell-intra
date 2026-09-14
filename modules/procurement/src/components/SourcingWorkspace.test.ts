// @vitest-environment jsdom
import { act, createElement } from 'react';
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
const event = { id: 'event-1', status: 'draft', responses: [], communications: [] };
const evaluation = { commercialTabulations: [], technicalEvaluations: [], awardRecommendation: null, varianceDecisions: [] };
const empty = () => ({ data: { requestId, event: null }, error: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(rpc: ReturnType<typeof vi.fn>, canManage = true) {
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
    expect(rpc.mock.calls).toEqual(['sourcing_workspace', 'insufficient_bid_exception', 'evaluation_workspace']
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

  it.each(['insufficient_bid_exception', 'evaluation_workspace'])('keeps an existing-event %s denial visible without inventing empty evidence', async denied => {
    const rpc = vi.fn(async (name: string) => name === 'sourcing_workspace' ? { data: { requestId, event }, error: null }
      : name === denied ? { data: null, error: { message: 'Current governed access denied' } }
      : { data: name === 'evaluation_workspace' ? evaluation : null, error: null });
    await mount(rpc);
    expect(toast.error).toHaveBeenCalledWith('Current governed access denied');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Not started');
    expect(host.textContent).not.toContain('Create plan');
    expect(host.textContent).not.toContain('Save plan');
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
