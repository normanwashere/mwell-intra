import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';

describe('capture RPC retry identity', () => {
  for (const action of ['confirm_pick', 'confirm_pack'] as const) {
    it(`${action} reuses the wire command after a committed response is lost`, async () => {
      const receipts = new Map<string, Record<string, unknown>>();
      const calls: Record<string, unknown>[] = [];
      let effects = 0;
      const db = { rpc: async (name: string, { payload }: { payload: Record<string, unknown> }) => {
        expect(name).toBe('advance_fulfillment_order');
        calls.push(structuredClone(payload));
        const key = String(payload.idempotency_key);
        if (!receipts.has(key)) {
          effects += 1;
          receipts.set(key, structuredClone(payload));
          return { data: null, error: { message: 'Response lost after commit' } };
        }
        expect(payload).toEqual(receipts.get(key));
        return { data: { id: 'order-1', source: 'ecommerce', external_reference: 'ORDER-1', lines: [], status: action === 'confirm_pick' ? 'packing' : 'ready' }, error: null };
      } } as unknown as SupabaseClient;
      const repo = new SupabaseRepository(db);
      const input = { orderId: 'order-1', action, actor: 'operator',
        pickedLines: [{ productId: 'device', quantity: 20, serialNumbers: Array.from({ length: 20 }, (_, i) => `SN-${i}`), binId: 'bin-1' }],
        packaging: [{ productId: 'box', quantity: 1 }], courier: 'Courier', waybillNumber: 'WB-1', deliveryLink: 'https://example.com/track/1' };
      await expect(repo.advanceFulfillmentOrder(input)).rejects.toThrow('Response lost');
      await expect(repo.advanceFulfillmentOrder(input)).resolves.toMatchObject({ id: 'order-1' });
      expect(calls).toHaveLength(2);
      expect(calls[1]).toEqual(calls[0]);
      expect(calls[0]?.idempotency_key).toBe(`advance_${action}-order-1`);
      expect(effects).toBe(1);
    });
  }
});
