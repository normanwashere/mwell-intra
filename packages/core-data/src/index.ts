// @intra/core-data — client-side ports + adapters for the `core` schema.
// Consumers: modules (procurement, legal) + apps/shell (admin, notifications).
// UI never calls Supabase directly (spec §6.1).

export * from './types';
export * from './repository';
export * from './inMemoryCoreRepository';
export * from './supabaseCoreRepository';
export * from './createCoreRepository';
