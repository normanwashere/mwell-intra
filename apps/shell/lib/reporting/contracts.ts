import { z } from 'zod';
import { DATASET_IDS } from './catalog';

export const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const cursorSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_.-]+$/);
export const datasetIdSchema = z.enum(DATASET_IDS);
export const snapshotRequestSchema = z.strictObject({ consumer_id: opaqueIdSchema });
export const checkpointRequestSchema = z.strictObject({ stream_id: opaqueIdSchema, checkpoint: cursorSchema });
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const integritySchema = z.strictObject({
  hash_algorithm: z.literal('sha256-jcs-v1'),
  record_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checksum: hashSchema,
});
