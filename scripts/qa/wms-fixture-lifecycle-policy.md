# Warehouse Fixture Lifecycle Contract

**Offline orchestration only. Existing live fixture guards remain closed.** No
real database adapter, archive RPC, production change or automatic cleanup is
provided here. Passing these model tests does not certify UAT cleanup. Reopening
any runner requires reviewed adapter integration and actual native/readback proof.

The immutable plan names one `wms-fixture-<UUIDv4>` run/namespace, exact UAT project
`kkoitlvydytdhlpxhuah`, source commit, synthetic roots and declared operations.
There is no free-form mutation payload, prefix discovery or master-stock option.
Action names are resolved by a reviewed adapter; all fixture writes must pass
through `writer.mutate(operationId)`. Existing actors/master data are read-only
references, never owned fixtures. The adapter must reject foreign dependencies,
master stock and undeclared action effects in its actual server-authoritative path.

## Stable Adapter Boundary

- `inspect`: read-only exact environment/build and ownership classification,
  initially, before each writer, and over the final exact row inventory.
- `acquire`: exclusive database-backed run lease/fence across processes. Recovery
  must invalidate prior writer generations before it can examine/retire residue.
- `execute`: governed action with run-bound idempotency key. Return only receipt,
  outcome and exact owned row IDs with run/operation provenance and row SHA256.
- `drain`: permanently close writer admission and prove zero remote writers;
  settling JavaScript promises alone is insufficient. Failed drain means no
  archival or lease release; explicit fenced recovery is required.
- `reconcile`: read-only resolution of every durable intent, including lost
  responses. Return complete exact retained-row closure and current row hashes.
  Unknown outcomes, omitted response rows or foreign/master rows block archival.
- `archive`: admin-only immutable registry/batch insertion for the supplied exact
  records. Preserve base rows byte-for-byte: no DELETE/TRUNCATE, status/quantity
  changes, invented evidence or historical outcome rewrite. The actual adapter
  must revalidate provenance/hashes atomically under locks. Repeated cleanup key
  plus identical inventory must return the same archive IDs, never duplicate them.
- `release`: release the exclusive lease without reopening its closed writer fence.
- Separate `verifier.prove`: independently query full run dependency closure,
  active views/availability and registry. Return zero active/unknown/foreign
  counts, all retained row IDs/provenance/hashes and exact archive mappings. No
  client response or passed-in outcome is a substitute for those database reads.

Distinct adapter IDs are a wiring check, not proof of independent credentials or
queries. Adapter completeness, privilege separation, real fencing, atomic archive
behavior and coverage of every active view/command must be reviewed/tested natively.

## Durability And Recovery

The caller supplies a private local journal path in an existing durable directory.
Creation is exclusive; every append is fsynced before dispatch. Intent, response,
reconciliation, archive intent/receipt and independent proof are hash-chained.
Only IDs/hashes/receipts are stored: no credentials, business documents or raw API
responses. File permissions alone do not establish private Windows ACLs; choose
the output directory accordingly. Hash chaining detects corruption, not an attacker
rewriting the entire journal. Disk/power-loss guarantees remain filesystem-specific.

`try/finally` stops admission, drains admitted and remote writers, and attempts
cleanup even after failure/abort. Cleanup does not receive the aborted signal.
Business errors still reject after successful cleanup. A broken journal prevents
cleanup dispatch; a killed process leaves recovery evidence, not a success claim.

`recoverWmsFixtureLifecycle` requires the exact run ID and reads the durable plan.
It never replays business mutations. It re-fences/drains, reconciles, retries the
same archive key, and demands fresh independent proof even after an earlier
completion record. Partial/corrupt journals and changed archive inventories need
explicit review, not automatic truncation, widening or key replacement.

Inventory digest: SHA256 of UTF-8 `JSON.stringify` of records sorted by the code
point order of `table + ':' + id`, with fields in this exact order: `table`, `id`,
`runId`, `operationId`, `rowSha256`. Row SHA256 canonicalization itself belongs to
the reviewed DB adapter and must match the independent verifier.

Offline tests: `node --test scripts/qa/wms-fixture-lifecycle.test.mjs`.
