// Runtime-agnostic factory: memory when no Supabase client, live otherwise.
// Env is injected — the host reads its own env (Next: process.env.*, Vite:
// import.meta.env.*) and passes the client in.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toRoleCapabilityRows } from '@intra/rbac';
import { InMemoryCoreRepository, type RoleCapabilityMatrix } from './inMemoryCoreRepository';
import type { InMemoryCoreOptions } from './inMemoryCoreRepository';
import { SupabaseCoreRepository } from './supabaseCoreRepository';
import type { CoreRepository } from './repository';

export interface CreateCoreRepositoryConfig {
  /** If provided, the live SupabaseCoreRepository is used. */
  client?: SupabaseClient | null;
  /** Only used when falling back to memory. */
  memory?: Omit<InMemoryCoreOptions, 'matrix'> & { matrix?: RoleCapabilityMatrix };
}

/** Build a matrix from @intra/rbac's toRoleCapabilityRows() output. */
export function buildRoleCapabilityMatrixFromRbac(): RoleCapabilityMatrix {
  const rows = toRoleCapabilityRows();
  const matrix: RoleCapabilityMatrix = {};
  for (const row of rows) {
    if (!matrix[row.module]) matrix[row.module] = {};
    if (!matrix[row.module]![row.role]) matrix[row.module]![row.role] = new Set<string>();
    (matrix[row.module]![row.role] as Set<string>).add(row.cap);
  }
  return matrix;
}

export function createCoreRepository(config: CreateCoreRepositoryConfig): {
  repo: CoreRepository;
  source: 'memory' | 'supabase';
} {
  if (config.client) {
    return { repo: new SupabaseCoreRepository(config.client), source: 'supabase' };
  }
  if (!config.memory?.actor) {
    throw new Error('createCoreRepository: memory mode requires memory.actor');
  }
  const matrix = config.memory.matrix ?? buildRoleCapabilityMatrixFromRbac();
  return {
    repo: new InMemoryCoreRepository({ ...config.memory, matrix }),
    source: 'memory',
  };
}
