# Warehouse Live Fixture Pause

Local source policy: **LIVE MUTATIONS PAUSED.** This is not automatic cleanup,
deployed enforcement, or proof that existing UAT residue is cleared. No supported
history-preserving archival and independently verified cleanup adapter exists for
the affected runners. Do not seed, resume a retained journey, or use master stock.

`wms-live-fixture-guard.mjs` throws before fixture/business work in the ecommerce,
returns, replenishment, department, recipient-evidence, September event/product,
and WMS scenario seed entrypoints. It also blocks the full-intra runner's entire
mutating transaction phase, including receiving/Quality/putaway and other governed
transactions. The policy-aligned wrapper inherits that block. The legacy August
27 saved-receiving-draft browser case stops before sign-in; its read-only sibling
cases are unchanged. The referenced standalone inbound signoff file is absent.

There is no environment, approval flag, manifest field, or CLI override. The
guard only returns for the explicit boolean `false`, used by the broad runner
for its existing nonmutating phases. Invalid or omitted intent fails closed.
Offline builders, local disposable tests, and read-only checks remain available.
Generated seed SQL is **review/local-test material only, not authorization to
apply it to UAT**, including renderers whose historical `apply` mode emits COMMIT.

Before reopening any runner, reviewed code must establish an exact project/build,
namespace and ID manifest; exclusively owned synthetic stock with collision and
foreign/master-stock rejection; supported cleanup for every planned write;
durable intent/response records; outer-finally cleanup after writers are drained;
immutable history retention/archive proof; and independent, complete readback
that fails on nonzero active/unaccounted residue or unknown outcomes. A plan or
an operator attestation is not an implemented adapter. Retained audit history
must be accounted for, not deleted or relabeled as zero total rows.

## Limits

- Raw/generated SQL applied manually, direct UI/API/MCP actions, copied/older
  checkouts and historical harnesses under `outputs` do not pass through this
  script guard. Existing artifacts are not modified or retrospectively guarded.
- Exported pure helpers and adapter-driven offline journey functions are not a
  universal network sandbox; a new caller can bypass an entrypoint. Any new live
  adapter/runner requires independent guard wiring and tests before use.
- Existing cleanup executors are unchanged and are not authorized by this pause.
  Do not invoke legacy cleanup that deletes audit, users, roles or Storage.
- Role/auth/training provisioning and Procurement-only scripts are outside this
  Warehouse fixture change. The opt-in UAT certification workflow has earlier
  identity/training steps: the downstream transaction guard does not stop them.
- No production policy, app business workflow, database schema or historical
  fixture is changed. Paused G02 journey 002 is not resumed; its existing
  completed conversion and history are unchanged.

Offline check: `node --test scripts/qa/wms-live-fixture-guard.test.mjs`.
Do not run a live journey to test the pause.
