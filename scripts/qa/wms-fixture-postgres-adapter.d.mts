import type { FixturePlan, WmsFixtureAdapter, WmsFixtureVerifier } from './wms-fixture-lifecycle.mjs';
export interface PostgresFixtureBindings { locationId: string; binId: string; }
export interface FixtureQueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
}
export interface PostgresFixtureSessions { adapter: WmsFixtureAdapter; verifier: WmsFixtureVerifier; }
export interface FixtureObservation {
  runId: string;
  phase: string;
  kind: 'unrelated-protected-change' | 'rolled-back-preservation-retry';
  tables?: string[];
  beforeSha256?: string;
  afterSha256?: string;
  attempt?: number;
}
export function createRepresentativeFixturePlan(input: { sourceCommit: string; runId?: string }): FixturePlan;
export function assertFixtureDatabaseTarget(connectionString: string, options?: { localDisposable?: boolean }): URL;
/** Trusted integration/test boundary. Live runners must use the verified connector. */
export function createPostgresFixtureSessions(input: {
  writer: FixtureQueryClient;
  reader: FixtureQueryClient;
  readHealth(): Promise<unknown>;
  bindings: PostgresFixtureBindings;
  onObservation?(observation: FixtureObservation): void;
}): PostgresFixtureSessions;
export function connectPostgresFixtureAdapter(input: {
  databaseUrl: string;
  bindings: PostgresFixtureBindings;
  onObservation?(observation: FixtureObservation): void;
}): Promise<PostgresFixtureSessions & { close(): Promise<void> }>;
