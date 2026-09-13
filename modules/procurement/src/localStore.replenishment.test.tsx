// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { SessionValue } from '@intra/auth';
import { useProcurementRequests, type NewRequestInput, type ProcurementRequestsAPI } from './localStore';

const mocks = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn(), remove: vi.fn(), rpc: vi.fn(), single: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) }));
let session: SessionValue, api: ProcurementRequestsAPI, root: Root, host: HTMLDivElement;
vi.mock('@intra/auth', () => ({ useSession: () => session, useCan: () => true }));
vi.mock('./useReadQuery', () => ({ useReadQuery: () => [[], false, mocks.refresh, undefined] }));
vi.mock('./replenishmentRequest', async () => ({ ...await vi.importActual('./replenishmentRequest'), readAcceptedReplenishment: mocks.read }));
vi.mock('./attachments', async () => ({ ...await vi.importActual('./attachments'), uploadRequestAttachments: mocks.upload, removeUploadedRequestAttachments: mocks.remove }));
const binding = { id: '11111111-1111-4111-8111-111111111111', productId: 'accepted-product', quantity: 2, rationale: 'Accepted need' };
const input = (): NewRequestInput => ({ replenishment: binding, title: 'Explicit draft', department: 'operations', costCenter: 'cc', budgetCode: 'budget', neededBy: '2099-01-01',
  lines: [{ description: binding.productId, quantity: 2, uom: 'unit', unitPrice: 25 }], category: 'goods', requirementKind: 'materials',
  route: { procurementMode: 'competitive_bidding' } as NewRequestInput['route'], justification: { need: binding.rationale }, compliance: { routeConfirmed: false }, attachments: [] });
function Harness() { api = useProcurementRequests(); return null; }
async function render() { await act(async () => root.render(<Harness />)); }
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.clearAllMocks(); mocks.read.mockReset(); mocks.upload.mockReset(); mocks.rpc.mockReset(); mocks.single.mockReset();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session = { mode: 'supabase', loading: false, profile: { id: 'actor', kind: 'employee' }, userCapabilities: { procurement: ['create_request', 'manage_replenishment'] },
    supabaseClient: { schema: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }) }) },
  } as unknown as SessionValue;
  mocks.read.mockResolvedValue(binding);
  mocks.upload.mockImplementation(async (_client, id) => ['spec', 'budget'].map(kind => ({ id: `att_${kind}`, kind, filename: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storagePath: `request/${id}/${kind}.pdf`, sha256: 'a'.repeat(64) })));
  mocks.rpc.mockImplementation(async (_name, { payload }) => {
    const saved = { ...payload.request, requester_id: 'actor', status: 'draft', route_confirmed_at: null, justification: { need: binding.rationale, replenishmentRecommendationId: binding.id } };
    mocks.single.mockResolvedValue({ data: saved, error: null });
    return { data: { id: binding.id, status: 'handed_off', procurement_request_id: saved.id }, error: null };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('uploads scoped evidence then calls only the governed handoff and verifies its linked draft', async () => {
  const result = await api.add(input());
  expect(result.status).toBe('draft'); expect(result.requesterId).toBe('actor');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  const [name, args] = mocks.rpc.mock.calls[0]!;
  expect(name).toBe('manage_replenishment_recommendation');
  expect(args.payload).toMatchObject({ id: binding.id, action: 'handoff', request: { requirement_kind: 'materials', estimated_amount: 50, lines: [{ description: binding.productId, quantity: 2, uom: 'unit' }] } });
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
  expect(mocks.read.mock.invocationCallOrder[1]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]!);
  expect(mocks.remove).not.toHaveBeenCalled();
  await expect(api.add(input())).rejects.toThrow('Reopen'); expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it.each(['no-create', 'no-manage', 'loading', 'signed-out', 'memory', 'scratch-draft', 'substitution', 'changed-before-upload'])('denies %s before uploads or writes', async defect => {
  const request = input();
  if (defect === 'no-create') session.userCapabilities = { procurement: ['manage_replenishment'] };
  if (defect === 'no-manage') session.userCapabilities = { procurement: ['create_request'] };
  if (defect === 'loading') session.loading = true;
  if (defect === 'signed-out') session.profile = null;
  if (defect === 'memory') session.mode = 'memory';
  if (defect === 'scratch-draft') request.draftId = 'req_existing';
  if (defect === 'substitution') request.lines[0]!.quantity = 3;
  if (defect === 'changed-before-upload') mocks.read.mockRejectedValue(new Error('Changed'));
  await render(); await expect(api.add(request)).rejects.toThrow();
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['revoked', 'actor-changed', 'unmounted', 'accepted-changed', 'timeout', 'foreign-link', 'readback-failed'])('retains uploads and prevents automatic replay after %s', async defect => {
  if (defect === 'unmounted') mocks.upload.mockImplementation(async () => {
    await act(async () => root.render(null)); return [];
  });
  if (defect === 'revoked' || defect === 'actor-changed') mocks.upload.mockImplementation(async () => {
    session = defect === 'revoked' ? { ...session, userCapabilities: {} } : { ...session, profile: { ...session.profile!, id: 'foreign' } };
    await render(); return [];
  });
  if (defect === 'accepted-changed') mocks.read.mockResolvedValueOnce(binding).mockRejectedValueOnce(new Error('Changed'));
  if (defect === 'timeout') mocks.rpc.mockRejectedValue(new Error('timeout'));
  if (defect === 'foreign-link') mocks.rpc.mockResolvedValue({ data: { id: binding.id, status: 'handed_off', procurement_request_id: 'req_foreign' }, error: null });
  if (defect === 'readback-failed') mocks.rpc.mockImplementation(async (_name, { payload }) => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'readback failed' } });
    return { data: { id: binding.id, status: 'handed_off', procurement_request_id: payload.request.id }, error: null };
  });
  await expect(api.add(input())).rejects.toThrow(); expect(mocks.remove).not.toHaveBeenCalled();
  const count = mocks.rpc.mock.calls.length;
  if (['revoked', 'actor-changed', 'unmounted', 'accepted-changed'].includes(defect)) expect(count).toBe(0);
  await expect(api.add(input())).rejects.toThrow(); expect(mocks.rpc).toHaveBeenCalledTimes(count);
});
it('blocks a simultaneous second completion before its upload', async () => {
  let finish!: () => void;
  mocks.upload.mockImplementation(() => new Promise(resolve => { finish = () => resolve([]); }));
  const first = api.add(input()); await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
  await expect(api.add(input())).rejects.toThrow('Reopen'); finish(); await first;
  expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.upload).toHaveBeenCalledTimes(1);
});

async function invalidateContext(change: string) {
  if (change === 'unmounted') { await act(async () => root.render(null)); return; }
  if (change === 'actor-changed') session = { ...session, profile: { ...session.profile!, id: 'foreign' } };
  if (change === 'revoked') session = { ...session, userCapabilities: { procurement: ['manage_replenishment'] } };
  if (change === 'loading') session = { ...session, loading: true };
  await render();
}
it.each(['actor-changed', 'revoked', 'unmounted', 'loading'])('does not upload or send a command when %s during the initial accepted read', async change => {
  mocks.read.mockImplementationOnce(async () => { await invalidateContext(change); return binding; });
  await expect(api.add(input())).rejects.toThrow();
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it.each(['actor-changed', 'revoked', 'unmounted', 'loading'])('stops the actual upload loop between attachments after %s without deleting or handing off', async change => {
  const actual = await vi.importActual<typeof import('./attachments')>('./attachments');
  mocks.upload.mockImplementation(actual.uploadRequestAttachments);
  const upload = vi.fn().mockImplementation(async () => { await invalidateContext(change); return { error: null }; });
  const remove = vi.fn().mockResolvedValue({ error: null });
  Object.assign(session.supabaseClient!, { storage: { from: vi.fn(() => ({ upload, remove })) } });
  const request = input();
  request.attachments = (['spec', 'budget'] as const).map(kind => ({ kind, filename: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: 1,
    file: Object.assign(new File(['x'], `${kind}.pdf`, { type: 'application/pdf' }), { arrayBuffer: async () => new Uint8Array([120]).buffer }) }));
  await expect(api.add(request)).rejects.toThrow();
  expect(upload).toHaveBeenCalledTimes(1); expect(mocks.rpc).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
