import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteReceivingDraft,
  loadReceivingDraft,
  ReceivingDraftConflictError,
  saveReceivingDraft,
  validateReceivingDraftBody,
  type ReceivingDraftBody,
  type ReceivingDraftClient,
} from './receivingDrafts';

const poId = 'po-1';
const timestamp = '2026-08-28T01:00:00.000Z';
const body: ReceivingDraftBody = {
  version: 1,
  locationId: 'receiving',
  binId: null,
  lines: [{
    lineId: 'line-1', productId: 'product-1', description: 'Scanner',
    serials: ['SN001', 'unfinished-'], quantity: 2, expectedQuantity: 4,
    outcome: 'accepted', identifiers: { sku: 'scanner-1' },
  }],
  evidence: { photos: ['warehouse/receiving/photo.jpg'], link: '', reason: 'Partial delivery' },
};

function clientWith(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const client = { schema: vi.fn().mockReturnValue({ rpc }) } satisfies ReceivingDraftClient;
  return { client, rpc };
}

function record(version = 1, snapshot: ReceivingDraftBody | null = body) {
  return { status: 'ok', po_id: poId, body: snapshot, version, updated_at: timestamp };
}

describe('live receiving draft helpers', () => {
  it('accepts the application Supabase client without a cast', () => {
    const compatible = (client: SupabaseClient): ReceivingDraftClient => client;
    expect(compatible).toBeTypeOf('function');
  });

  it('loads the authenticated draft exclusively through the warehouse RPC', async () => {
    const { client, rpc } = clientWith(record());
    const storage = vi.spyOn(Storage.prototype, 'getItem');
    const result = await loadReceivingDraft(client, poId);
    expect(result).toEqual({ poId, body, version: 1, updatedAt: timestamp });
    expect(client.schema).toHaveBeenCalledWith('warehouse');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('load_receiving_draft', { p_po_id: poId });
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it('distinguishes a never-saved draft from a discarded revision', async () => {
    const missing = clientWith({ status: 'ok', po_id: poId, body: null, version: 0, updated_at: null });
    expect(await loadReceivingDraft(missing.client, poId)).toEqual({ poId, body: null, version: 0, updatedAt: null });
    const discarded = clientWith(record(4, null));
    expect(await loadReceivingDraft(discarded.client, poId)).toMatchObject({ body: null, version: 4 });
  });

  it('saves the entire unfinished snapshot and the exact expected revision, without actor data', async () => {
    const { client, rpc } = clientWith(record(3));
    expect(await saveReceivingDraft(client, poId, body, 2)).toMatchObject({ version: 3, body });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('save_receiving_draft', {
      p_po_id: poId, p_body: body, p_expected_version: 2,
    });
  });

  it('deletes with optimistic revision and returns the cleared revision', async () => {
    const { client, rpc } = clientWith(record(4, null));
    expect(await deleteReceivingDraft(client, poId, 3)).toMatchObject({ version: 4, body: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_receiving_draft', {
      p_po_id: poId, p_expected_version: 3,
    });
  });

  it.each(['save', 'delete'] as const)('exposes %s conflicts without retrying or overwriting', async (operation) => {
    const { client, rpc } = clientWith({ status: 'conflict', current_version: 7 });
    const work = operation === 'save'
      ? saveReceivingDraft(client, poId, body, 2) : deleteReceivingDraft(client, poId, 2);
    await expect(work).rejects.toBeInstanceOf(ReceivingDraftConflictError);
    await expect(work).rejects.toMatchObject({ code: 'conflict', currentVersion: 7 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['42501', '28000', '22023'])('propagates server error %s, never an empty default', async (code) => {
    const { client } = clientWith(null, { message: 'Server rejected draft', code });
    await expect(loadReceivingDraft(client, poId)).rejects.toMatchObject({ code, message: 'Server rejected draft' });
    await expect(saveReceivingDraft(client, poId, body, 0)).rejects.toMatchObject({ code });
    await expect(deleteReceivingDraft(client, poId, 0)).rejects.toMatchObject({ code });
  });

  it('propagates network failure without memory fallback', async () => {
    const { client, rpc } = clientWith(null);
    rpc.mockRejectedValue(new Error('Network unavailable'));
    await expect(loadReceivingDraft(client, poId)).rejects.toThrow('Network unavailable');
  });

  it.each([
    null, [], {}, { ...record(), po_id: 'other-po' }, { ...record(), body: { version: 2 } },
    { ...record(), version: -1 }, { ...record(), version: '1' },
    { ...record(), updated_at: 'not-a-date' }, { ...record(), updated_at: null },
    { ...record(), version: 0 }, { status: 'conflict', current_version: '1' },
  ])('rejects malformed server records: %j', async (data) => {
    const { client } = clientWith(data);
    await expect(loadReceivingDraft(client, poId)).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it.each([-1, 0.5, NaN, Infinity, 2147483647, undefined])('rejects invalid expected revision %s before sending', async (version) => {
    const { client, rpc } = clientWith(null);
    await expect(saveReceivingDraft(client, poId, body, version as number)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(deleteReceivingDraft(client, poId, version as number)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'x'.repeat(257), '\u0000'])('rejects invalid PO identifier before sending', async (id) => {
    const { client, rpc } = clientWith(null);
    await expect(loadReceivingDraft(client, id)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('receiving snapshot bounds', () => {
  it('accepts arbitrary version-1 JSON snapshots, including unfinished values', () => {
    expect(() => validateReceivingDraftBody(body)).not.toThrow();
    expect(() => validateReceivingDraftBody({ version: 1, quantity: '', scans: [], ready: false })).not.toThrow();
  });

  it.each([
    null, [], { version: 2 }, { version: '1' }, { version: 1, bad: undefined },
    { version: 1, bad: Infinity }, { version: 1, bad: new Date() },
    { version: 1, bad: () => 1 }, { version: 1, bad: 'x'.repeat(8193) },
    { version: 1, bad: '\u0000' }, { version: 1, bad: Array(1001).fill(0) },
    { version: 1, ['x'.repeat(129)]: true },
    { version: 1, scans: Array(9).fill('x'.repeat(8192)) },
    { version: 1, nested: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`f${index}`, 0])) },
    { version: 1, nested: Array.from({ length: 11 }, () => Array(1000).fill(0)) },
  ])('rejects invalid JSON or excessive bounds', (snapshot) => {
    expect(() => validateReceivingDraftBody(snapshot)).toThrow();
  });

  it.each(['password', 'PASSWORD', 'pass_word', 'refreshToken', 'access_token', 'api-key', 'clientSecret', 'authorization'])('rejects credential field %s at any depth', (key) => {
    expect(() => validateReceivingDraftBody({ version: 1, lines: [{ [key]: 'do-not-store' }] })).toThrow('Credentials');
  });

  it('rejects circular and excessively nested snapshots', () => {
    const circular: Record<string, unknown> = { version: 1 };
    circular.self = circular;
    expect(() => validateReceivingDraftBody(circular)).toThrow('circular');
    let nested: unknown = 0;
    for (let index = 0; index < 17; index++) nested = { nested };
    expect(() => validateReceivingDraftBody({ version: 1, nested })).toThrow('complex');
  });
});
