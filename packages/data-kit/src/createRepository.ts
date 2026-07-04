import type { SupabaseClient } from '@supabase/supabase-js';
import type { WarehouseRepository, WarehouseData } from './repository';
import { InMemoryRepository } from './inMemoryRepository';
import { createSupabaseWarehouseRepository } from './supabase/SupabaseRepository';

export type DataSource = 'supabase' | 'memory';

/**
 * Runtime configuration for the repository factory.
 *
 * ------------------------------------------------------------------------
 * ENV / CONFIG INJECTION (Next.js adaptation — spec §12 step 2)
 * ------------------------------------------------------------------------
 * The source `createRepository.ts` read `import.meta.env.VITE_DATA_SOURCE` and
 * `VITE_SUPABASE_*` directly, which only works under Vite. `@intra/data-kit`
 * must run under Next.js (and Node, tests, edge) too, so the host app owns
 * env access and Supabase client construction and passes the client in via
 * `supabaseClient`. Nothing in this package reads `process.env` or
 * `import.meta.env`.
 *
 * ------------------------------------------------------------------------
 * SUPABASE ADAPTER
 * ------------------------------------------------------------------------
 * The live Supabase adapter now lives in `./supabase` and is selected when the
 * caller passes a `SupabaseClient`. When no client is provided the factory
 * falls back to the seeded in-memory adapter (persisted to localStorage in
 * the browser, ephemeral in Node/tests/SSR).
 *
 * The RPCs the adapter targets live in the `warehouse` Postgres schema; open
 * with `core.has_cap('warehouse', '<cap>')` (spec §4.2 / ADR-004); and use the
 * unchanged `{ payload }` envelope (see
 * `supabase/migrations/20260706092400_warehouse_rpcs.sql`). Configure the
 * client with `db: { schema: 'warehouse' }` so both `.from(table)` reads and
 * `.rpc(fn, ...)` calls resolve to the warehouse schema.
 *
 * For backward compatibility a caller may still inject a custom
 * `createSupabaseRepository` factory; when both a client and a custom factory
 * are supplied the custom factory wins so hosts can override the adapter.
 */
export interface DataKitConfig {
  /** Force a data source, or `'auto'`/undefined to detect from Supabase config. */
  dataSource?: DataSource | 'auto';
  /**
   * Injected Supabase client (schema must be `warehouse`). When present the
   * live adapter is used unless `dataSource: 'memory'` forces otherwise.
   */
  supabaseClient?: SupabaseClient;
  /** Supabase connection config (kept for hosts that use the custom factory). */
  supabase?: {
    url?: string;
    anonKey?: string;
    /** Postgres schema override (default `warehouse`). */
    schema?: string;
  };
  /**
   * localStorage-like store for the in-memory adapter's persistence. Defaults
   * to `globalThis.localStorage` when available (browser), otherwise
   * `undefined` (no persistence — SSR / Node / tests).
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Optional initial dataset for the in-memory adapter (defaults to the seed). */
  initialData?: WarehouseData;
  /**
   * Optional custom Supabase adapter factory. Takes precedence over the
   * bundled adapter when provided; kept as a seam for hosts that already own
   * client construction upstream of data-kit.
   */
  createSupabaseRepository?: (
    config: NonNullable<DataKitConfig['supabase']>,
  ) => WarehouseRepository;
}

/** Whether enough Supabase config was supplied to attempt the live backend. */
export function hasSupabaseConfig(config: DataKitConfig = {}): boolean {
  if (config.supabaseClient) return true;
  return Boolean(config.supabase?.url && config.supabase?.anonKey);
}

/**
 * Resolve the effective data source from injected config (replaces the
 * source's `import.meta.env.VITE_DATA_SOURCE` read).
 */
export function resolveDataSource(config: DataKitConfig = {}): DataSource {
  const explicit = config.dataSource;
  if (explicit === 'supabase') return 'supabase';
  if (explicit === 'memory') return 'memory';
  return hasSupabaseConfig(config) ? 'supabase' : 'memory';
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  // Adaptation: the source used `window.localStorage`; `globalThis` works under
  // Node/edge/Next SSR too (falls back to no persistence when unavailable).
  return typeof globalThis !== 'undefined' &&
    'localStorage' in globalThis &&
    globalThis.localStorage
    ? globalThis.localStorage
    : undefined;
}

/**
 * Builds the active repository. Uses the live Supabase adapter when a client
 * is supplied (or a custom factory + config is supplied and the source resolves
 * to `'supabase'`), otherwise the seeded in-memory adapter persisted to
 * localStorage. Falls back to in-memory if adapter construction throws.
 */
export function createRepository(config: DataKitConfig = {}): {
  repo: WarehouseRepository;
  source: DataSource;
} {
  const source = resolveDataSource(config);
  if (source === 'supabase') {
    try {
      if (config.createSupabaseRepository && config.supabase) {
        return {
          repo: config.createSupabaseRepository(config.supabase),
          source,
        };
      }
      if (config.supabaseClient) {
        return {
          repo: createSupabaseWarehouseRepository(config.supabaseClient),
          source,
        };
      }
    } catch {
      // fall through to memory if adapter construction misconfigured at runtime
    }
  }
  const storage = config.storage !== undefined ? config.storage : defaultStorage();
  return {
    repo: new InMemoryRepository(config.initialData, { storage }),
    source: 'memory',
  };
}
