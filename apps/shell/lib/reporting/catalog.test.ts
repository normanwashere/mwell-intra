import { describe, expect, it } from 'vitest';
import { DATASET_IDS, getDataset } from './catalog';
import { checkpointRequestSchema, snapshotRequestSchema } from './contracts';

describe('deny-by-default catalogue and contracts', () => {
  it('registers exactly 30 distinct IDs, with no unverified ready dataset', () => {
    expect(DATASET_IDS).toHaveLength(30);
    expect(new Set(DATASET_IDS).size).toBe(30);
    for (const id of DATASET_IDS) {
      expect(getDataset(id)).toEqual({ id, availability: 'unavailable', reason: 'mapping_not_verified' });
    }
  });
  it.each(['auth.users', '__proto__', 'constructor', 'warehouse.products;select *', '../warehouse.products'])('rejects arbitrary dataset %s', id => {
    expect(getDataset(id)).toBeUndefined();
  });
  it('does not let a bootstrap caller self-grant extra datasets', () => {
    expect(snapshotRequestSchema.parse({ consumer_id: 'data-team-primary' })).toEqual({ consumer_id: 'data-team-primary' });
    expect(snapshotRequestSchema.safeParse({ consumer_id: 'data-team-primary', dataset_ids: ['auth.users'] }).success).toBe(false);
    expect(snapshotRequestSchema.safeParse({ consumer_id: '../admin' }).success).toBe(false);
  });
  it('bounds checkpoint inputs and rejects unknown fields', () => {
    expect(checkpointRequestSchema.safeParse({ stream_id: 's-1', checkpoint: 'opaque.token' }).success).toBe(true);
    expect(checkpointRequestSchema.safeParse({ stream_id: 's-1', checkpoint: 'x'.repeat(4097) }).success).toBe(false);
    expect(checkpointRequestSchema.safeParse({ stream_id: 's-1', checkpoint: 'opaque', epoch: 'client-chosen' }).success).toBe(false);
  });
});
