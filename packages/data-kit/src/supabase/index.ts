// @intra/data-kit/supabase — live Supabase adapter for the warehouse module.
// Ported verbatim from mwell-intra-warehouse/src/data/supabase/*, with the
// domain-type import paths adapted to data-kit's self-contained domain layer.
// The adapter is INJECTED into `createRepository()` via `createSupabaseRepository`
// so data-kit itself doesn't hard-depend on @supabase/supabase-js at runtime.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WarehouseRepository } from '../repository';
import { SupabaseRepository } from './SupabaseRepository';

export { SupabaseRepository };
export * from './mappers';
export {
  uploadEvidence,
  uploadEvidenceBatch,
  resolveEvidenceUrl,
} from './evidence';

/**
 * Factory shaped to fit `DataKitConfig.createSupabaseRepository`. Callers pass
 * an already-constructed SupabaseClient (browser or server) so this package
 * never touches env.
 */
export function createSupabaseWarehouseRepository(
  client: SupabaseClient,
): WarehouseRepository {
  return new SupabaseRepository(
    client.schema('warehouse') as unknown as SupabaseClient,
  );
}
