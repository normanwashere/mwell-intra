import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './supabase/SupabaseRepository';
import { rowToInventoryPosition } from './supabase/mappers';

const row = { id: 'product|A|', created_at: '1970-01-01T00:00:00Z', product_id: 'product', location_id: 'A', bin_id: null,
  on_hand: '10', committed: '2', held: '0', unavailable: '0', available: '0',
  unscoped_committed: '4', product_available: '12', availability_verified: false, putaway_available: '8' };

describe('inventory quantity summary transport', () => {
  it('maps repeated product quantities and the false position flag explicitly', () => {
    expect(rowToInventoryPosition(row)).toMatchObject({ unscopedCommitted: 4, productAvailable: 12, availabilityVerified: false, putawayAvailable: 8, available: 0 });
  });
  it('preserves explicit zero but never maps absent or null product totals to verified zero', () => {
    expect(rowToInventoryPosition({ ...row, product_available: 0, unscoped_committed: 0, availability_verified: true }))
      .toMatchObject({ productAvailable: 0, unscopedCommitted: 0, availabilityVerified: true });
    expect(rowToInventoryPosition({ ...row, product_available: null, unscoped_committed: undefined, availability_verified: undefined }))
      .toMatchObject({ productAvailable: null, unscopedCommitted: undefined, availabilityVerified: undefined });
    expect(rowToInventoryPosition({ ...row, product_available: undefined }).productAvailable).toBeUndefined();
  });
  it('selects only the explicit summary projection with existing cursor pagination', async () => {
    const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [row], error: null }) };
    const from = vi.fn().mockReturnValue(query);
    const repo = new SupabaseRepository({ from } as unknown as SupabaseClient);
    expect((await repo.listInventoryPositions({ limit: 100 })).rows[0]?.productAvailable).toBe(12);
    expect(from).toHaveBeenCalledWith('inventory_position_v1');
    expect(query.select).toHaveBeenCalledWith('id,product_id,location_id,bin_id,on_hand,committed,held,unavailable,available,created_at,unscoped_committed,product_available,availability_verified,putaway_available');
    expect(query.limit).toHaveBeenCalledWith(101);
  });
});
