# Warehouse and Procurement Reporting API Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to execute this plan task-by-task after review. Every unchecked item is outstanding; none is evidence of completion.

**Goal:** Let the data team's custom backend synchronize approved Warehouse and Procurement records across all departments and warehouse locations, initially in full and then by polling every 15 minutes.

**Architecture:** A private worker captures consistent reporting generations and immutable diffs. A read-only business-data REST API authenticates dedicated principals and serves resumable files; the recipient stages and reconciles each generation before activation.

**Tech Stack:** Existing Intra Next.js/TypeScript, PostgreSQL/Supabase, private object storage, Node worker, Vitest, existing SQL regression harness and Playwright/API tests. Runtime/dependency versions come from the current lockfile; no framework upgrade is part of this feature.

**Spec:** [Technical specification](../specs/2026-09-20-reporting-api-design.md).

**Status:** Revision 2 after security and developer-experience review, September 20, 2026. No API implementation, credential provisioning, migration or deployment has been performed. Read the security review and data-team quickstart linked from the spec before execution.

## Global Constraints

- Implementation target is `C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding`, not the older standalone Warehouse workspace containing these planning artifacts. Resolve an approved isolated checkout before coding; preserve unrelated changes.
- Phase 1: Warehouse and Procurement only, all departments/locations. All data means the explicit permitted reporting catalogue, not all database columns.
- Poll and capture every 15 minutes; target capture duration at most 5 minutes. This is not a 15-minute end-to-end freshness guarantee.
- No operational process, approval, onboarding, custody, SMTP or existing role journey changes.
- Explicit field allowlists, sealed-bid restrictions, private-draft exclusion, no personal contacts, credentials, bank details, signed URLs or document bodies.
- Stable generation boundaries, private immutable storage, at-least-once delivery, idempotent consumer application, no silent truncation or partial publication.
- Default page limit 500; max 1000; target page payload 5 MiB; oversized single records fail visibly. 60 requests/minute and 2 concurrent page requests per principal, shared across instances.
- Managed OAuth client credentials, asymmetric client authentication preferred, access tokens at most 10 minutes and key rotation overlap at most 24 hours. No custom token server or long-lived data API bearer. Current grant checks fail closed.
- Snapshot/bootstrap retention 48 hours with a 96-hour absolute snapshot age limit; change segments AND target manifests 30 days; staging 24 hours. Restore/scope/disclosure epochs invalidate old state. Authorization validity for recipient stale serving is at most 30 minutes.
- Fixed approved Phase 1 bundle, one registered primary replica by default. 2 active pins, 4 fresh pins/day per principal; shared byte/environment budgets must be finite and capacity-approved.

## Review Focus

1. Long-running source writes committed after a capture starts must arrive in the next snapshot, despite old timestamps. Test in Task 4.
2. Identical business order numbers, mutable JSON line order and missing legacy FKs must not merge records or fabricate joins. Test in Tasks 1 and 3.
3. Sealed quotations, private drafts and personal data nested inside JSON must not leak through a broad reporting grant or retained cursor. Test in Tasks 2 and 3.
4. A failed/empty source query must not become mass-delete changes; a restored database must not reuse old checkpoints. Test in Tasks 4 and 5.
5. A crash after local apply but before acknowledgement must not double-count stock or PO amounts on retry. Test in Tasks 6 and 7.

## Task Map and Ownership

All code paths below are relative to the implementation monorepo. New paths are proposed, not files claimed to exist. Allocate monotonic, collision-free migration timestamps at execution; do not edit previously deployed migrations.

| Task | Owner | Dependencies | Reviewable deliverable |
|---|---|---|---|
| 1 | Integration/backend | None | Typed contract, field dictionary and source mapping |
| 2 | Backend + security/infra | 1 | Principal/credential lifecycle and privilege boundary |
| 3 | Warehouse + Procurement specialists | 1, 2 | Explicit reporting projections and canonical relationship tests |
| 4 | Backend + infra | 2, 3 | Consistent generation capture with hosting proof |
| 5 | Backend | 4 | Diff, cursors, manifests and retention correctness |
| 6 | API/backend | 2, 5 | Documented authenticated endpoints |
| 7 | Data integration | 6 | Runnable reference consumer with transactional staging |
| 8 | QA + security + infra | 3-7 | Performance, security and regression evidence |
| 9 | Release + data-team owner | 8 | UAT onboarding, docs and controlled release |

Independent source mapping/projection work can be split between Warehouse and Procurement. One owner maintains the contract and capture protocol. Run a separate security/correctness review before release; multiple agents must not edit the same migration or credential code simultaneously.

## Task 1: Contract and Source Mapping

**Create:** `apps/shell/lib/reporting/contracts.ts`, `catalog.ts`, `catalog.test.ts`; `docs/integrations/reporting-api/{dictionary.json,source-map.md}`.

**Read:** Existing Warehouse/Insights export routes; `packages/data-kit/src/repository.ts`; Procurement types; current applied migrations and effective view definitions. Do not infer runtime mappings solely from old comments.

**Interface:** `DatasetDefinition { id, grain, keyFields, allowedFields, foreignKeys, disclosureRule, availability }`; `ReportingRecord { record_id, dataset, source_system, source_id, source_updated_at, record_hash, data_quality_flags }`; `getDataset(id: string): DatasetDefinition | undefined`.

- [ ] Record the actual checkout SHA, applied schema and dataset-by-dataset mapping. Identify canonical suppliers, receipts, shipment persistence and JSON children. Treat absent source fields as contract decisions, not fabricated defaults.
- [ ] Write a failing catalogue test asserting all 30 catalogue dataset IDs exist, every ready dataset has explicit fields/key/grain/disclosure, and unknown names are rejected.
- [ ] Pin duplicate-reference and child-identity expectations with fixtures: two different order IDs using the same printed reference remain two records; reordered embedded lines replace one parent collection without changing invented child keys.
- [ ] Implement the type/catalogue registry and complete the machine-readable field dictionary. Each field has type, source, nullability, semantic definition, sensitivity and reference target. Make supplier aliases and legitimate missing-link flags explicit.
- [ ] Run `pnpm --filter @intra/shell exec vitest run lib/reporting/catalog.test.ts`; observe the intended failing assertion before implementation, then pass. Run shell typecheck and review/commit only task-owned files.

Example test contract:

```ts
expect(getDataset('auth.users')).toBeUndefined();
expect(new Set(rows.map(row => row.record_id)).size).toBe(2);
expect(getDataset('warehouse.inventory_positions')?.keyFields)
  .toEqual(['product_id', 'location_id', 'bin_id']);
```

Exit: no implied support for a missing source dataset, no unexplained numeric measure or ambiguous relationship. The data-team owner can review field meanings independently of code.

## Task 2: Reporting Identity and Privileges

**Create:** `apps/shell/lib/reporting/auth.ts`, `auth.test.ts`, `rateLimit.ts`, `rateLimit.test.ts`; `scripts/reporting/manage-clients.mjs`; new forward migration for private principal, grant, epoch, audit and rate-limit records. Register machine clients in the approved managed identity provider; no local token minting service.

**Interface:** `authorizeReporting(request: Request): Promise<ReportingPrincipal>` where principal contains `id`, `environment`, `scopeEpoch`, `disclosureEpoch`, `bundleVersion`, `datasetIds`, `authorizationValidUntil`. Validate provider token using maintained libraries, then resolve client ID to current grants; client-supplied scope is never trusted. `takeRequestSlot(principalId: string): Promise<{ release(): Promise<void> }>` enforces shared concurrency with bounded leases.

- [ ] Write failing tests for valid, expired, revoked, malformed and wrong-environment tokens; forged dataset selection; old scope epoch; key rotation; two web instances sharing one rate budget. Assert 401/403/429 with redacted logs.
- [ ] Add least-privileged metadata tables and DB roles. Prove capture role cannot update source tables or execute operational receive/release/approval RPCs, and API role cannot fetch arbitrary source tables. Inspect exposed PostgREST schemas.
- [ ] Configure managed OAuth client credentials and private_key_jwt registration, pinned issuer/audience/algorithms/JWKS, <=10-minute tokens and clock skew <=60 seconds. Test wrong algorithm/issuer/audience/token type, unknown key, replayed assertion, key rotation and current-grant store failure. Application does not trust JWT-supplied key URLs or cache an allow after revocation.
- [ ] Create an explicit IAM matrix for source extractor, publisher, API, retention and credential administrator. Test that API cannot change grants/keys, write/delete/list raw private objects, sign public URLs or read business attachments; extractor cannot overwrite published objects; retention cannot alter grants or delete unrelated prefixes. Audit all inherited/default privileges on real PostgreSQL/storage.
- [ ] Define disclosure interlocks before source restrictions become effective, fencing stale publishers and historical reads even with unchanged principal grants. Prove withdrawn quotations disappear from old snapshots, old change pages and metadata while replacement is unavailable. Unsupported source interlock blocks that dataset's release.
- [ ] Add explicit expiry/revocation/rotation and current-scope validation on every request. Ensure failed authentication is rate-limited before expensive work; store privacy-safe audit metadata.
- [ ] Bind verified issuer/client ID to a current registration denial check. On compromise permanently deny the old OAuth client ID; register a replacement rather than re-enabling it after key rotation. Test revoke -> rotate -> attempted re-enable -> replay old token, including old tokens still inside expiry. Normal rotation with unchanged grants must preserve sync state. No unbound local epoch is accepted as token revocation.
- [ ] Test sealed-bid/private-draft projection access using the actual DB role, not only a mocked HTTP denial. Prove `anon`, ordinary users and a revoked integration cannot read private capture files.
- [ ] Run new Vitest tests, add `scripts/verify-reporting-authority.pglite.test.mjs`, run `node --test scripts/verify-reporting-authority.pglite.test.mjs`, then reproduce grants on isolated real PostgreSQL because mocked/PGlite roles alone are insufficient.
- [ ] Review privileges independently and commit this task separately.

Example assertion:

```ts
await expect(authorizeReporting(expiredRequest)).rejects.toMatchObject({ status: 401 });
expect(auditLogText).not.toContain(rawToken);
```

## Task 3: Warehouse and Procurement Projections

**Create:** `scripts/reporting/project-records.mjs`, `project-records.test.mjs`; new migrations for curated `reporting` projections; `scripts/verify-reporting-projections.pglite.test.mjs`.

**Interface:** `projectRecord(datasetId: string, source: unknown): ReportingRecord`; source/view contract is the Task 1 registry. Each projection returns approved fields only. Dataset streams sort by the documented immutable key, with deterministic treatment of nullable composite keys.

- [ ] Write failing golden fixtures for each dataset, with null dates, decimal amounts, different currencies, held inventory, cancelled POs, multiple receipt representations and replacement returns.
- [ ] Add fixtures containing nested emails, bank fields, private URLs, free-text personal data and sealed quote amounts; assert no prohibited key/value survives, including metadata/counts/reference.links. Officially disclosed responses become reportable later; withdrawn data blocks the old audience epoch immediately, not only through a delayed delete.
- [ ] Implement minimal allowlisted projections. No `select *`, raw attachments, arbitrary JSON spreading or source-to-source joins by display label. Reuse inventory-position definitions without relabeling on-hand as available.
- [ ] Validate every relationship against persisted keys; map Warehouse/Procurement supplier aliases explicitly. Missing legacy links are reported as quality flags and measured, not guessed.
- [ ] Implement spec section 12's sha256-jcs-v1 with a maintained RFC 8785 implementation; record hash excludes itself and envelope metadata only. Add golden test vectors for decimal strings, Unicode, null versus absent fields, array order, record hash inclusion and sorted dataset digest. Prove capture times do not change every record hash; quality flags/source timestamp changes follow the specified record content. Test parent collections and duplicate printed numbers.
- [ ] Run `node --test scripts/reporting/project-records.test.mjs scripts/verify-reporting-projections.pglite.test.mjs`; verify real PostgreSQL view authorization and query plans with representative fixtures. Review/commit projections separately from capture infrastructure.

Example assertion:

```js
assert.equal(projectRecord('warehouse.inventory_positions', fixture).available, '7');
assert.equal(JSON.stringify(projectRecord('procurement.quotations', disclosed)).includes('bank_account'), false);
assert.deepEqual(sealedResponseRows, []);
```

## Task 4: Consistent Generation Worker

**Create:** `scripts/reporting/capture.mjs`, `capture.test.mjs`, `storage.mjs`, `database.mjs`; new generation/lease/manifest metadata migration; `docs/integrations/reporting-api/worker-runbook.md`.

**Interface:** `captureGeneration({ environment, contractVersion, audienceId }): Promise<CapturedGeneration>` produces private `captured` staging metadata, never externally ready. `CapturedGeneration` contains attempt ID, fence, expected predecessor, epochs, contract/dictionary versions, counts/hashes and private versioned object references. Task 5 publishes after diff completion. Public `GenerationManifest` is a separate allowlisted type without storage keys or forbidden dataset metadata.

- [ ] Write failing integration tests using two real database connections. Start one write with an old timestamp, establish read-only repeatable-read capture, commit the write mid-capture, and verify it is absent everywhere in G and present everywhere in G+1. Repeat for a PO and linked receipt/balance update.
- [ ] Implement one dedicated connection and one repeatable-read read-only transaction for the full dataset extraction; use keyset batches on that connection. Do not use transaction-pooling requests as if they preserve a session snapshot.
- [ ] Stream deterministic NDJSON to private staging objects with bounded buffers, calculating counts and hashes. An oversized record or failed source query fails the generation; neither becomes an empty successful dataset.
- [ ] Validate staged datasets and store a private captured attempt only. Snapshot upload does not advance ready state before change segments/target manifest validate in Task 5. Crash recovery identifies only attempt-owned staging paths.
- [ ] Implement renewable capture lease plus fencing token per environment/contract/audience, 15-minute schedule, bounded timeouts and cancellation. Pause A until its lease expires, publish B, resume A; A must fail publication with no ready-pointer rollback. Keep authorized last-good data only within hard retention.
- [ ] Prove the worker runs on a supported durable execution host with the required connection and timeout budget, including restart recovery and private storage access. If existing hosting cannot satisfy this, obtain the needed infra setup before release; never launch unawaited capture from a web request.
- [ ] Run `node --test scripts/reporting/capture.test.mjs`; record real-DB consistency tests and baseline vs capture-active transaction p95. Review/commit.

Expected test result: no generation contains a new receipt with an old stock position, and an old-timestamp late commit is not skipped permanently.

## Task 5: Change Segments, Cursors and Retention

**Create:** `scripts/reporting/diff.mjs`, `diff.test.mjs`; `apps/shell/lib/reporting/cursors.ts`, `cursors.test.ts`, `manifests.ts`; `scripts/reporting/retention.mjs`, `retention.test.mjs`.

**Interfaces:** `diffRecords(before, after)` produces deterministic `{ event_id, dataset, operation, record_id, record? }` events; `encodeCursor(state): string`, `decodeCursor(token, principal): CursorState`. State binds principal/environment/scope/contract/selection/generation/offset/expiry. `getManifest(id, principal)` checks ownership and current grants.

- [ ] Pin a diff fixture: before A/B, after changed A/new C produces exactly upsert A, delete B, upsert C. Unchanged hashes emit nothing. A generation with no changes still produces a final checkpoint.
- [ ] Implement per-record-map diffs from captured attempts and immutable segments; require expected ready predecessor, current fencing token and disclosure epoch in one atomic publication after snapshot/diff/manifest validation. A crash after snapshot upload but before diff cannot expose a ready generation or skip a change transition. Empty successful datasets are distinct from failed source queries; large-delete/nonempty-to-empty safety checks require validation before publication.
- [ ] Write and pass tamper, expired, cross-principal, cross-environment and scope-reduction cursor tests. Final-page checkpoint appears only when the full generation has been served; empty data is not an implicit completion flag.
- [ ] Bind bootstrap G to a registered stream/fixed bundle; baseline means G already applied, changes begin strictly after G. Test dataset_complete versus generation_complete, caught_up polling with unchanged checkpoint, real zero-change generation, duplicate/backwards acknowledgements and superseded streams.
- [ ] Implement 48-hour pin deadline with generation readiness +96-hour ceiling; retain target/predecessor reconciliation manifests and segments 30 days even after snapshot payload expires. Test old snapshot pinned near 48 hours, 47-hour bootstrap catch-up, 60-second in-flight page lease and explicit 410. Last-ready outages do not override expiry. Cleanup only owned paths, staging <=24 hours, bounded versions/backups and purge-on-restore.
- [ ] Run Node diff/retention tests and shell cursor tests. Independently review privacy withdrawal: old scope tokens must not retrieve old files; recipient rebootstrap/purge is required. Commit.

Example fixture assertion:

```js
assert.deepEqual(diffRecords(before, after).map(e => [e.operation, e.record_id]),
  [['upsert', 'A'], ['delete', 'B'], ['upsert', 'C']]);
```

## Task 6: REST API and OpenAPI Contract

**Create:** `apps/shell/app/api/reporting/v1/connection/route.ts`, `catalog/route.ts`, `snapshots/route.ts`, `snapshots/[snapshotId]/route.ts`, `snapshots/[snapshotId]/datasets/[dataset]/route.ts`, `streams/[streamId]/generations/[generationId]/route.ts`, `changes/route.ts`, `checkpoints/route.ts`, `status/route.ts`; `apps/shell/lib/reporting/{responses.ts,pages.ts,api.test.ts}`; `docs/integrations/reporting-api/openapi.yaml`.

**Consumes:** Tasks 2/5 principal, cursor and manifest interfaces; private storage only. **Produces:** Exact methods/envelopes/status codes in spec section 8. No operational tables are queried from these handlers.

- [ ] Write failing route tests for default/max/invalid page limits, byte limit, malformed JSON, foreign snapshot IDs, duplicate idempotency keys with identical/different bodies, partial generation, expired checkpoint, stale-but-ready data, and 429 Retry-After.
- [ ] Implement thin authenticated route handlers with shared response/error helpers, scoped private object reads, request IDs, redacted logging and shared concurrency leases released on cancellation/error.
- [ ] Separate public/internal manifest serializers. Test identical idempotency keys from different principals/epochs/bundles, plus links/counts/hashes/object-key redaction. API must return only pinned authorized metadata and streams, never raw shared manifests.
- [ ] Implement 16 KiB JSON body/8 KiB URL/4 KiB cursor limits, explicit allowed methods/fields/depth, duplicate-key/query rejection, parameterized queries, same-origin paths and no arbitrary callbacks or URL fetches. Test SQL/path traversal, Unicode edge cases, content-type/verb tampering, poisoned next links, cache headers and sanitized failures.
- [ ] Apply shared pin/egress/staging/environment quotas and 2 concurrent reads, including invalid-token pre-auth floods and cost budget exhaustion. Repeated snapshot POST only pins an existing ready generation; it never launches capture. Test 2-pin cap and 4-new-pins/day plus idempotent retry without quota inflation. Published numeric byte budgets must fit measured bootstrap/recovery needs.
- [ ] Add snapshot pin creation and checkpoint acknowledgements as integration-metadata operations. Checkpoints acknowledge generations actually available to this principal; they never certify the contents of the recipient's database by themselves.
- [ ] Implement pagination without hardcoded total row limits. Include `generation_complete`, next cursor/checkpoint, schema/environment and capture timestamps; do not emit an inaccessible next page at end of data.
- [ ] Write OpenAPI schemas and examples matching actual handlers. Validate error codes, decimal strings, nullable dates, unknown fields, auth, idempotency and version behavior against generated contract tests.
- [ ] Run shell API tests and typecheck; exercise authenticated HTTP endpoints with synthetic data, not only internal functions. Assert cache headers prevent public response caching. Review/commit.

Example expectations:

```ts
expect(response.status).toBe(429);
expect(response.headers.get('Retry-After')).toMatch(/^\d+$/);
expect(finalPage.generation_complete).toBe(true);
expect(finalPage.next_checkpoint).toEqual(expect.any(String));
```

## Task 7: Reference Ingestion Client

**Create:** `examples/reporting-client/{README.md,cli.mjs,client.mjs,client.test.mjs,auth.mjs,postgres-store.mjs,sqlite-store.mjs,stage-schema.sql}`, generated typed client, Postman collection and synthetic fixtures. Commands: doctor, sync --once, sync --interval 900. Keep secrets as secret-store references. Use maintained OAuth/JOSE/JCS libraries and built-in fetch, not custom cryptography. Deliver PostgreSQL adapter plus SQLite demo; no required custom adapter just to achieve first successful sync.

**Interface:** `runSync({ apiBase, tokenProvider, store })`; store supports transactional `stagePage`, `replaceParentChildren`, `activateGenerationAndCheckpoint({ workerFence, authorizationFence, expectedCheckpoint, scopeEpoch, disclosureEpoch, restoreEpoch, streamId, bundleVersion, authorizationValidUntil, generation })`, and persisted progress. Activation compares all supplied values with current durable state, requires not quarantined and validates authorization deadline inside the commit transaction. Quarantine advances authorizationFence atomically so paused validation cannot undo it. Typed config supports base/token URL, registered client ID, private-key secret reference, fixed consumer ID and target database secret reference.

- [ ] Write failing tests for bootstrap pagination, interleaved generations, duplicate pages, child removal, tombstones, duplicate printed reference/different ID, 429 retry, one bounded refresh/retry for expired/unclassified 401, confirmed-revocation quarantine, repeated-401 stop and 410 replacement bootstrap.
- [ ] Implement initial snapshot ingestion to staging, validate per-dataset counts/hashes, atomically activate all datasets and baseline checkpoint, then consume generation changes. Keep live dashboard tables unchanged on a partial failed sync.
- [ ] Persist page cursor and staging mutation together. At generation end, publish state and checkpoint together; acknowledge the server afterwards. A crash after local commit but before acknowledgement must safely replay, not add quantities again.
- [ ] Include 15-minute polling, proactive token renewal and one bounded token refresh/retry for unclassified or expired 401; stop on repeated failure and quarantine confirmed revocation. Network/429/503 retries are bounded with jitter. Drain all queued generations immediately, including zero-change generations, until caught_up; wait 900 seconds only then. Test a six-generation backlog while another is produced so recovery actually catches up within quota, not one generation per poll.
- [ ] Implement doctor validation and last-applied/capture-age indicators; stale serving requires unexpired authorization_valid_until. Confirmed revocation/disclosure withdrawal quarantines active/staged/cache data immediately even without replacement. Loss of confirmation for 30 minutes suspends access. Test withdrawal and deadline expiry between validation/activation with no newer generation: the authorization fence/deadline must reject the commit and retain quarantine.
- [ ] Test A pausing after staging while B advances; A's later fenced activation fails. Pin exact predecessor and target manifest per generation. Support large staging/versioned records with a small atomic active-pointer commit, not an unbounded full-database copy per poll.
- [ ] Test Authorization is never forwarded across redirects/origins, private data never appears in logs, and data is consumed through schema-validated parameterized inserts without unsafe object merges/dynamic SQL/HTML. Provide nested-line and common PO/receipt/inventory join recipes plus data dictionary and contract test vectors.
- [ ] Test and document restrictive schema/scope changes: rebuild approved datasets and remove withdrawn fields, not merely merge a smaller payload into old rows. Explain that deleted reporting rows are never instructions to delete operational source records.
- [ ] Run `node --test examples/reporting-client/client.test.mjs`; perform the same end-to-end flow against UAT when Task 8 permits. Have the data team adapt and review its actual database transaction implementation. Commit.

Invariant: applying page P twice produces the same local records and totals as applying P once.

## Task 8: Security, Load and Workflow Certification

**Create:** `scripts/qa/reporting-api-certification.mjs`, `reporting-api-seed.mjs`, `reporting-api-seed.test.mjs`; `docs/audits/REPORTING-API-CERTIFICATION.md`. Add focused script entries to the root package only as needed.

- [ ] Seed only an approved isolated UAT fixture set with run-owned IDs: all dataset types, null/legacy relationships, duplicate printed references, held stock, sealed/disclosed quotes, parent collections and 10x representative volume. No email sending, real approvals or existing tester-data cleanup.
- [ ] Capture baseline query plans and transaction p50/p95/p99, then repeat under capture and two-client page load. Record data counts/bytes, row skew, concurrency and runtime resource limits. Do not describe this as maximum-capacity certification.
- [ ] Enforce the capture <=5-minute and operational p95 regression <=10% release targets at the representative workload. Fix proven indexes/projections first; if still failing, stop the live release and redesign extraction using a reporting replica/CDC without changing the external contract.
- [ ] Execute all Task 1-7 negative, retry, consistency, scope, rotation and restore tests on real PostgreSQL/private storage. Reconcile hashes and counts across every ready dataset. Test field disclosure directly, not only screen visibility.
- [ ] Run existing Warehouse/Procurement tests, authority SQL checks, typecheck/lint/build and full CI at one candidate SHA. Preserve any unrelated failure as an explicit release issue; do not weaken assertions to pass.
- [ ] Re-run existing receiving, pick-pack-release, returns, approval, amendment and readiness journeys while capture is active. Confirm operational decisions and quantities are unchanged.
- [ ] Produce evidence with actual run IDs, SHA/migrations, timing distribution, counts, redacted failures and limits. Obtain independent security/correctness review before marking ready.
- [ ] Execute the security review's R01-R12 adversarial tests, signed-off threat/IAM matrix, dependency/SBOM/secret scans, gateway/storage configuration checks, revocation drill and recipient viewer-access negatives. No unresolved Critical/High exploitable reporting finding may ship; Medium risk needs named written acceptance, not an automatic agent pass.

## Task 9: UAT Handoff and Release

**Create/update:** Integration quickstart, dataset dictionary/OpenAPI, worker/rotation/restore runbook, standalone HTML integration guide, relevant KB/handbook technical sections, concise stakeholder update. Do not document proposed endpoints as already live.

- [ ] Confirm the designated data-team credential owner and infra owner, secret delivery channel, UAT host, worker hosting, retention capacity and contact for sync incidents. These are deployment inputs, not a request for secrets in chat.
- [ ] Confirm managed OAuth support, recipient backend language/database, fixed primary consumer ID, agreed viewer audiences and approved finite byte/metadata/staging budgets. Validate downstream encryption, exports, active/cache/staging purge, bounded backups and purge-on-restore. Data-team all-location access is not automatically granted to every dashboard viewer.
- [ ] Deploy forward migrations, worker and API to UAT with access initially disabled. Validate runtime SHA/schema, least privileges, storage privacy and the first ready generation before issuing credentials.
- [ ] Register a UAT-only OAuth client and exchange its public key through the agreed channel; private key stays with its owner. Data team runs doctor, bootstrap, four incremental cycles, interrupted recovery and reconciliation using the supplied adapter, then tests restricted viewer access, key rotation and withdrawal while disconnected. Target first synthetic connection in <=30 minutes after account/network prerequisites are ready; measure this, do not claim it in advance.
- [ ] Verify all catalogue rows are supported or have explicitly accepted exclusions, including quotation disclosure and shipment source resolution. Publish known limits honestly.
- [ ] Update the offline manual/KB and handoff HTML together with the release. Include freshness semantics: 15-minute polling does not guarantee every source change appears within 15 minutes.
- [ ] Keep production credentials and endpoint rollout separate from UAT. Require the normal release approval before production data access. Disable API/worker for rollback without reverting business transactions; leave old source workflows working.

## Plan Review and Completion Rule

Self-review maps spec sections 1-5 to Tasks 1/3, section 6 to Tasks 2/3/9, section 7 to Tasks 4/5/7, section 8 to Task 6, section 9 to Tasks 4/5/8/9, section 10 to Tasks 8/9, section 11 to Tasks 2/4/6/8/9 and section 12 to Tasks 1/3/5/7. Security findings R01-R12 map to explicit controls and negative tests in the companion review. This is traceability, not proof those future tests pass.

No endpoint, credential, performance result or live certification exists solely because this plan is written. Completion requires the evidence in Tasks 8/9 and the recipient's accepted data contract. Recommended execution is task-by-task implementation with separate reviews for privileges, extraction consistency and the final integrated branch.
