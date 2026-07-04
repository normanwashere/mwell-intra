// Public surface of the Supabase adapter.
//
// Consumers construct a Supabase client themselves (schema = 'warehouse') and
// pass it either directly to `createSupabaseWarehouseRepository(client)` or
// through `createRepository({ supabaseClient })`.

export {
  SupabaseRepository,
  createSupabaseWarehouseRepository,
} from './SupabaseRepository';

export * from './mappers';

export {
  uploadEvidence,
  uploadEvidenceBatch,
  resolveEvidenceUrl,
} from './evidence';
