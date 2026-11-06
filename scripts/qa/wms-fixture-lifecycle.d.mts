export const WMS_FIXTURE_PROJECT_REF: 'kkoitlvydytdhlpxhuah';

export interface FixtureRoot { readonly table: string; readonly id: string; }
export interface FixtureOperation {
  readonly id: string;
  readonly action: string;
  readonly rootKeys: readonly string[];
}
export interface FixturePlan {
  readonly version: 1;
  readonly runId: string;
  readonly namespace: string;
  readonly projectRef: typeof WMS_FIXTURE_PROJECT_REF;
  readonly sourceCommit: string;
  readonly stockOrigin: 'synthetic';
  readonly roots: readonly FixtureRoot[];
  readonly operations: readonly FixtureOperation[];
}
export interface OwnedFixtureRecord extends FixtureRoot {
  readonly runId: string;
  readonly operationId: string;
  readonly rowSha256: string;
}
export interface FixtureIdentity {
  runId: string;
  projectRef: string;
  namespace: string;
  sourceCommit: string;
}
export interface FencedIdentity extends FixtureIdentity { fence: string; }
export interface FixtureContext { plan: FixturePlan; fence: string; }
export interface MutationIntent { operationId: string; idempotencyKey: string; }
export type MutationOutcome = { operationId: string } & (
  { outcome: 'applied'; receiptId: string } | { outcome: 'not-applied'; receiptId: null }
);
export interface ScopeClassification {
  ownerRunId: string;
  classification: 'reserved-synthetic' | 'owned-synthetic';
  masterStock: false;
}
export interface OwnershipInspection extends FixtureIdentity {
  appEnv: 'uat';
  complete: true;
  roots: Array<FixtureRoot & ScopeClassification>;
  records: Array<OwnedFixtureRecord & ScopeClassification>;
}
export interface ArchiveReceipt extends FencedIdentity {
  idempotencyKey: string;
  inventorySha256: string;
  archiveIds: string[];
}
export interface ResidualProof extends FencedIdentity {
  nonce: string;
  verifierId: string;
  complete: true;
  activeCount: 0;
  unknownCount: 0;
  foreignCount: 0;
  archiveIds: string[];
  retainedRecords: OwnedFixtureRecord[];
  archivedRecords: Array<OwnedFixtureRecord & { archiveId: string }>;
}
/** Trusted integration boundary, not an implementation of DB archival. */
export interface WmsFixtureAdapter {
  readonly id: string;
  inspect(context: { plan: FixturePlan; fence?: string; operation?: FixtureOperation; records?: OwnedFixtureRecord[] }): Promise<OwnershipInspection>;
  /** Exclusive cross-process lease; recovery invalidates and drains prior writer generations. */
  acquire(context: { plan: FixturePlan; recovery: boolean }): Promise<FencedIdentity>;
  execute(context: FixtureContext & { operation: FixtureOperation; idempotencyKey: string; signal?: AbortSignal }): Promise<FencedIdentity & MutationOutcome & { records: OwnedFixtureRecord[] }>;
  /** Irrevocably close this fence to new writers and wait for all remote writes. */
  drain(context: FixtureContext): Promise<FencedIdentity & { writers: 0; fenced: true }>;
  /** Read-only authoritative outcomes and full exact owned-row closure, including unknown responses. */
  reconcile(context: FixtureContext & { intents: MutationIntent[] }): Promise<FencedIdentity & { complete: true; outcomes: MutationOutcome[]; records: OwnedFixtureRecord[] }>;
  /** Admin registry/batch insertion only; preserve base rows, quantities, outcomes and histories. */
  archive(context: FixtureContext & { idempotencyKey: string; inventorySha256: string; outcomes: MutationOutcome[]; records: OwnedFixtureRecord[] }): Promise<ArchiveReceipt>;
  /** Release the exclusive lease, never reopen the drained writer fence. */
  release(context: FixtureContext): Promise<void>;
}
/** Separate reviewed read-only path; cannot reuse archive receipt as proof. */
export interface WmsFixtureVerifier {
  readonly id: string;
  prove(context: FixtureContext & { nonce: string; outcomes: MutationOutcome[] }): Promise<ResidualProof>;
}
export interface FixtureRunOptions {
  manifestPath: string;
  plan: FixturePlan;
  adapter: WmsFixtureAdapter;
  verifier: WmsFixtureVerifier;
  signal?: AbortSignal;
}
export interface FixtureRecoveryOptions {
  manifestPath: string;
  expectedRunId: string;
  adapter: WmsFixtureAdapter;
  verifier: WmsFixtureVerifier;
}
export interface FixtureWriter { mutate(operationId: string): Promise<MutationOutcome>; }
export interface FixtureResult<T> { cleanupVerified: true; archiveIds: string[]; value: T; }
export function runWmsFixtureLifecycle<T>(options: FixtureRunOptions, body: (writer: FixtureWriter) => T | Promise<T>): Promise<FixtureResult<T>>;
export function recoverWmsFixtureLifecycle(options: FixtureRecoveryOptions): Promise<FixtureResult<undefined>>;
export function readWmsFixtureManifest(path: string): {
  plan: FixturePlan;
  events: Array<{ sequence: number; previousHash: string | null; type: string; data: unknown; hash: string }>;
};
