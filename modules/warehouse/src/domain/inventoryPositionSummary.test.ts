import { describe, expect, it } from 'vitest';
import type { InventoryPosition } from '@intra/data-kit';
import { productPositionSummaries, positionAvailable } from './inventoryPositionSummary';

const row = (fields: Partial<InventoryPosition> = {}): InventoryPosition => ({
  productId: 'product', locationId: 'A', onHand: 10, committed: 2, held: 0, unavailable: 0,
  available: 0, unscopedCommitted: 4, productAvailable: 12, availabilityVerified: false, putawayAvailable: 8, ...fields,
});

describe('quantity summary read semantics', () => {
  it('counts repeated global availability and unassigned demand once per product', () => {
    expect(productPositionSummaries([row(), row({ locationId: 'B' })], 'supabase').get('product'))
      .toEqual({ available: 12, unscopedCommitted: 4, valid: true });
    expect(positionAvailable(row(), 'supabase')).toBeNull();
  });

  it('preserves verified zero without replacing it with local free stock', () => {
    const zero = row({ productAvailable: 0, unscopedCommitted: 0, availabilityVerified: true });
    expect(productPositionSummaries([zero], 'supabase').get('product')?.available).toBe(0);
    expect(positionAvailable(zero, 'supabase')).toBe(0);
  });

  it('keeps an explicit unknown product separate from unrelated known quantities', () => {
    const unknown = row({ productAvailable: null, unscopedCommitted: 0, putawayAvailable: 0 });
    const known = row({ productId: 'known', available: 7, productAvailable: 7, unscopedCommitted: 0, availabilityVerified: true });
    const summaries = productPositionSummaries([unknown, known], 'supabase');
    expect(summaries.get('product')).toEqual({ available: null, unscopedCommitted: 0, valid: true });
    expect(summaries.get('known')).toEqual({ available: 7, unscopedCommitted: 0, valid: true });
    expect(positionAvailable(unknown, 'supabase')).toBeNull();
  });

  it.each([
    { availabilityVerified: true }, { available: 1 }, { putawayAvailable: 1 },
  ])('rejects a null product total with contradictory actionable quantities: %j', fields => {
    const unknown = row({ productAvailable: null, unscopedCommitted: 0, putawayAvailable: 0, ...fields });
    expect(productPositionSummaries([unknown], 'supabase').get('product')).toMatchObject({ available: null, valid: false });
  });

  it.each([
    [row(), row({ locationId: 'B', productAvailable: 13 })],
    [row(), row({ locationId: 'B', unscopedCommitted: 5 })],
    [row({ productAvailable: undefined })],
    [row({ productAvailable: Number.NaN })],
    [row({ productAvailable: -1 })],
  ])('does not publish a conflicting or missing product total', (...positions) => {
    expect(productPositionSummaries(positions, 'supabase').get('product')?.available).toBeNull();
  });

  it('allows legacy demo calculations only in memory mode, never for a live missing contract', () => {
    const legacy: InventoryPosition = { productId: 'old', locationId: 'A', onHand: 2, committed: 0, held: 0, unavailable: 0, available: 2 };
    expect(productPositionSummaries([legacy, { ...legacy, locationId: 'B' }], 'memory').get('old')?.available).toBe(4);
    expect(productPositionSummaries([legacy], 'supabase').get('old')?.available).toBeNull();
    expect(positionAvailable(legacy, 'supabase')).toBeNull();
    expect(positionAvailable(legacy, 'memory')).toBe(2);
  });
});
