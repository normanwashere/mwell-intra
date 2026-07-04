import type { WarehouseRepository, WarehouseData } from './repository';
import { InMemoryRepository } from './inMemoryRepository';

export type DataSource = 'supabase' | 'memory';

/**
 * Runtime configuration for the repository factory.
 *
 * ------------------------------------------------------------------------
 * ENV / CONFIG INJECTION (Next.js adaptation — spec §12 step 2)
 * ------------------------------------------------------------------------
 * The source `createRepository.ts` read `import.meta.env.VITE_DATA_SOURCE` and
 * `VITE_SUPABASE_*` directly, which only works under Vite. `@intra/data-kit`
 * must run under Next.js (and Node, tests, edge) too, so it takes ALL env as an
 * injected `DataKitConfig` object instead of reaching for a build-tool global.
 *
 * The host app is responsible for reading its own env and passing it in, e.g.
 *   - Next.js:  `{ dataSource: process.env.NEXT_PUBLIC_DATA_SOURCE, supabase: {
 *                 url: process.env.NEXT_PUBLIC_SUPABASE_URL, ... } }`
 *   - Vite:     `{ dataSource: import.meta.env.VITE_DATA_SOURCE, ... }`
 *
 * ------------------------------------------------------------------------
 * SUPABASE ADAPTER STATUS: DEFERRED (Step 1d scope)
 * ------------------------------------------------------------------------
 * Per the task, the live Supabase adapter port is deferred; this factory focuses
 * on the port + in-memory adapter + outbox. To keep the port/adapter seam intact
 * WITHOUT making data-kit depend on `@supabase/supabase-js`, the Supabase
 * adapter is *injected*: pass `createSupabaseRepository` and the factory will use
 * it when the source resolves to `'supabase'`. The warehouse module (or a later
 * `@intra/data-kit/supabase` entrypoint) supplies that factory, so data-kit stays
 * backend-agnostic. When it is not provided, the factory falls back to memory.
 */
export interface DataKitConfig {
  /** Force a data source, or `'auto'`/undefined to detect from Supabase config. */
  dataSource?: DataSource | 'auto';
  /** Supabase connection config (injected from the host's env). */
  supabase?: {
    url?: string;
    anonKey?: string;
    /** Postgres schema override (default `warehouse`). */
    schema?: string;
  };
  /**
   * localStorage-like store for the in-memory adapter's persistence. Defaults to
   * `globalThis.localStorage` when available (browser), otherwise `undefined`
   * (no persistence — SSR / Node / tests).
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Optional initial dataset for the in-memory adapter (defaults to the seed). */
  initialData?: WarehouseData;
  /**
   * Injected Supabase adapter factory (see class doc above). Keeps data-kit free
   * of a hard `@supabase/supabase-js` dependency while preserving the seam.
   */
  createSupabaseRepository?: (
    config: NonNullable<DataKitConfig['supabase']>,
  ) => WarehouseRepository;
}

/** Whether enough Supabase config was supplied to attempt the live backend. */
export function hasSupabaseConfig(config: DataKitConfig = {}): boolean {
  return Boolean(config.supabase?.url && config.supabase?.anonKey);
}

/**
 * Resolve the effective data source from injected config (replaces the source's
 * `import.meta.env.VITE_DATA_SOURCE` read).
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
 * Builds the active repository. Uses Supabase when configured (or forced) AND an
 * adapter factory was injected, otherwise the seeded in-memory adapter persisted
 * to localStorage. Falls back to in-memory if the Supabase adapter cannot be
 * created.
 */
export function createRepository(config: DataKitConfig = {}): {
  repo: WarehouseRepository;
  source: DataSource;
} {
  const source = resolveDataSource(config);
  if (source === 'supabase' && config.createSupabaseRepository && config.supabase) {
    try {
      return { repo: config.createSupabaseRepository(config.supabase), source };
    } catch {
      // fall through to memory if misconfigured at runtime
    }
  }
  const storage = config.storage !== undefined ? config.storage : defaultStorage();
  return {
    repo: new InMemoryRepository(config.initialData, { storage }),
    source: 'memory',
  };
}
