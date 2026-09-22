// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionValue } from '@intra/auth';
import { useApprovalHistory, useProcurementRequests, type ProcurementRequestsAPI } from './localStore';
import type { ApprovalDecision, ApprovalSignature } from './types';
import { formatDateTime } from './labels';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const displaySignature: ApprovalSignature = Object.freeze({
  dataUrl: png,
  signerName: 'Synthetic Sep22 Approver',
  method: 'typed',
  signedAt: '2026-09-22T11:00:00.000Z',
  userAgent: 'Synthetic signature test',
});
const rpcSignature = Object.freeze({
  signature_png: png,
  signer_name: displaySignature.signerName,
  signature_method: displaySignature.method,
  signed_at: displaySignature.signedAt,
  signer_ua: displaySignature.userAgent,
});
// Shape written verbatim by sep22-event-chain-approvals.mjs through decide_request_step.
const sep22StoredSignature = Object.freeze({
  signature_png: png,
  signer_name: displaySignature.signerName,
  signature_method: 'typed',
  signed_at: displaySignature.signedAt,
  user_agent: 'Codex synthetic UAT transaction runner',
});
const requestRow = { id: 'request-signature', title: 'Signature boundary test', status: 'under_review', created_at: '2026-09-22T10:00:00Z' };
let session: SessionValue;
let api: ProcurementRequestsAPI;
let history: ApprovalDecision[];
let root: Root;
let host: HTMLDivElement;
let steps: Record<string, unknown>[];
const rpc = vi.fn();
vi.mock('@intra/auth', () => ({ useSession: () => session, useCan: () => true }));

function Harness() {
  api = useProcurementRequests(requestRow.id);
  history = useApprovalHistory(requestRow.id);
  return null;
}

async function renderSignature(signature: unknown, status = 'approved') {
  steps = [{ id: 'step-signature', request_id: requestRow.id, step_order: 1, tier: 'dept_head', status,
    note: 'Recorded decision', decided_at: '2026-09-22T11:01:00Z', decided_by_email: 'synthetic@example.invalid', signature }];
  await act(async () => root.render(<Harness />));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  rpc.mockReset().mockResolvedValue({ data: requestRow, error: null });
  session = {
    mode: 'supabase', loading: false,
    profile: { id: 'synthetic-approver', kind: 'employee', name: 'Different Current Approver', email: 'current@example.invalid' },
    userCapabilities: { procurement: ['approve_request'] },
    supabaseClient: { schema: () => ({ rpc, from: (table: string) => {
      const data = table === 'requests' ? [requestRow] : steps;
      const query = Object.assign(Promise.resolve({ data, count: data.length, error: null }), {
        eq: () => query, limit: () => query, order: () => query,
      });
      return { select: () => query };
    } }) },
  } as unknown as SessionValue;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function expectSignature(expected: ApprovalSignature | undefined) {
  expect(api.rows[0]?.approvalSteps?.[0]?.signature).toEqual(expected);
  expect(history).toHaveLength(1);
  expect(history[0]?.signature).toEqual(expected);
  expect(history[0]).toMatchObject({ decision: 'approved', note: 'Recorded decision',
    decidedAt: '2026-09-22T11:01:00Z', decidedByEmail: 'synthetic@example.invalid', stepId: 'step-signature' });
  expect(rpc).not.toHaveBeenCalled();
}

describe('persisted approval signature reads', () => {
  it('normalizes the true Sep22 stored RPC shape without replacing its signer, time or fingerprint', async () => {
    const before = JSON.stringify(sep22StoredSignature);
    await renderSignature(sep22StoredSignature);
    expectSignature({ ...displaySignature, userAgent: sep22StoredSignature.user_agent });
    expect(steps[0]?.signature).toBe(sep22StoredSignature);
    expect(JSON.stringify(sep22StoredSignature)).toBe(before);
  });

  it.each([['governed snake_case', rpcSignature], ['existing camelCase', displaySignature]])('maps %s without changing persisted evidence', async (_label, signature) => {
    const before = JSON.stringify(signature);
    await renderSignature(signature);
    expectSignature(displaySignature);
    expect(JSON.stringify(signature)).toBe(before);
  });

  it('retains drawn signatures and the original timestamp offset', async () => {
    await renderSignature({ ...rpcSignature, signature_method: 'drawn', signed_at: '2026-09-22T19:00:00+08:00' });
    expectSignature({ ...displaySignature, method: 'drawn', signedAt: '2026-09-22T19:00:00+08:00' });
  });

  it.each([undefined, null, 42, 'not-a-date', '2026'])('does not invent a time or audit fingerprint for invalid metadata %s', async signedAt => {
    await renderSignature({ ...rpcSignature, signed_at: signedAt, signer_ua: null });
    expectSignature({ ...displaySignature, signedAt: '', userAgent: '' });
    expect(formatDateTime(history[0]!.signature!.signedAt)).toBe(formatDateTime(''));
  });

  it('keeps an incomplete legacy timestamp unknown too', async () => {
    await renderSignature({ ...displaySignature, signedAt: undefined, userAgent: 42 });
    expectSignature({ ...displaySignature, signedAt: '', userAgent: '' });
  });

  it('does not substitute decision time or current profile data for absent signature metadata', async () => {
    await renderSignature({ signature_png: png, signer_name: displaySignature.signerName, signature_method: 'typed' });
    expectSignature({ ...displaySignature, signedAt: '', userAgent: '' });
    expect(history[0]?.signature?.signedAt).not.toBe(history[0]?.decidedAt);
    expect(history[0]?.signature?.signerName).not.toBe(session.profile?.name);
  });

  it.each([
    ['absent', undefined], ['null', null], ['boolean', false], ['array', []], ['string', 'signature'], ['empty object', {}],
    ['missing name', { ...rpcSignature, signer_name: undefined }],
    ['blank name', { ...rpcSignature, signer_name: '  ' }],
    ['non-string name', { ...displaySignature, signerName: 123 }],
    ['missing method', { ...rpcSignature, signature_method: null }],
    ['unknown method', { ...displaySignature, method: 'generated' }],
    ['missing image', { ...rpcSignature, signature_png: null }],
    ['non-string image', { ...displaySignature, dataUrl: {} }],
  ])('keeps the decision but omits an unusable signature: %s', async (_label, signature) => {
    await renderSignature(signature);
    expectSignature(undefined);
  });

  it.each([
    'https://example.invalid/signature.png', 'http://example.invalid/signature.png', '//example.invalid/signature.png',
    'javascript:alert(1)', 'blob:signature', 'data:image/svg+xml,<svg/>',
    'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PHN2Zy8+',
    'data:image/png;base64,PHN2Zy8+', 'data:image/png;base64,%%%invalid',
    'data:image/png;base64,', `${png}\n`,
  ])('never exposes an unsafe or invalid signature image: %s', async dataUrl => {
    await renderSignature({ ...displaySignature, dataUrl });
    expectSignature(undefined);
  });

  it('uses the governed shape as a unit when both shapes are present', async () => {
    await renderSignature({ ...displaySignature, signerName: 'Conflicting legacy name', ...rpcSignature });
    expectSignature(displaySignature);
  });

  it('does not assemble a signature from conflicting partial shapes', async () => {
    await renderSignature({ ...displaySignature, signature_png: null });
    expectSignature(undefined);
  });
});

describe('governed approval signature writes', () => {
  it('translates the UI signature only and leaves the caller and other RPC fields unchanged', async () => {
    await renderSignature(undefined, 'pending');
    const actor = Object.freeze({ email: 'synthetic@example.invalid', tier: 'dept_head' as const, note: 'Approved as recorded', signature: displaySignature });
    await act(async () => { await api.decide(requestRow.id, 'approved', actor); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('decide_request_step', { payload: {
      request_id: requestRow.id, step_id: 'step-signature', tier: actor.tier, decision: 'approved',
      decided_by_email: actor.email, note: actor.note, signature: rpcSignature,
    } });
    expect(actor.signature).toBe(displaySignature);
    expect(actor.signature).not.toHaveProperty('signature_png');
  });

  it('passes an existing governed payload through without losing audit metadata', async () => {
    await renderSignature(undefined, 'pending');
    const persisted = Object.freeze({ ...sep22StoredSignature, audit_reference: 'existing-reference' });
    await act(async () => { await api.decide(requestRow.id, 'approved', { signature: persisted as unknown as ApprovalSignature }); });
    expect(rpc.mock.calls[0]?.[1].payload.signature).toBe(persisted);
  });

  it('does not invent a signer or timestamp to repair an invalid outgoing signature', async () => {
    await renderSignature(undefined, 'pending');
    const signature = Object.freeze({ dataUrl: png, method: 'typed' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Approvals require an electronic signature' } });
    await act(async () => {
      await expect(api.decide(requestRow.id, 'approved', {
        email: session.profile?.email,
        signature: signature as ApprovalSignature,
      })).rejects.toThrow('Approvals require an electronic signature');
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1].payload.signature).toEqual({
      signature_png: png, signature_method: 'typed', signer_name: undefined, signed_at: undefined, signer_ua: undefined,
    });
    expect(signature).toEqual({ dataUrl: png, method: 'typed' });
  });

  it('does not manufacture a signature for an unsigned rejection', async () => {
    await renderSignature(undefined, 'pending');
    await act(async () => { await api.decide(requestRow.id, 'rejected', { note: 'Required budget evidence is missing.' }); });
    expect(rpc.mock.calls[0]?.[1].payload).toMatchObject({ decision: 'rejected', signature: undefined });
  });
});
