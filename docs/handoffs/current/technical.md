# Technical Handoff

Use the [current release manifest](release-status.json) for d45fd6f deployment/health. CI42151736798 passed11/11:1861 memory passes/143 exclusions,26 controlled passes/4 exclusions,0 failures/retries. The [September technical pack](../2026-09-22/technical.md) is historical. Published source/docs, deployed app and applied database are distinct; this final offline checkpoint awaits publication.

## Candidate Boundaries

- Service-worker caches are public-only: allowlisted same-origin static assets and the public offline fallback. Authenticated API, document, page and data responses must remain network-only. Legacy private response caches must be purged on worker activation and session/access changes without deleting actor-scoped IndexedDB queued commands. This is not offline access to private records.
- Anonymous protected API calls must return JSON 401 with `Cache-Control: private, no-store`, not a login redirect. Ordinary protected page navigation still redirects to sign-in. Signed-in capability denials remain 403. This does not create or enable Reporting API routes.
- My Work paging follows the database cursor order, including mixed-case legacy IDs; repeated or invalid cursors still fail safely. A source failure is not an empty source and must not erase unrelated authorized data.
- Picking accepts another valid source bin when no explicit order-bin constraint exists, while preserving warehouse, exact serial, hold, reservation and server command checks. A recommendation is not authority or proof of sufficient current stock.
- CSV unknowns, Finance period labels and Product workflow-region accessible names follow the appended [pending release addendum](../../releases/2026-11-05-WMS-AUDIT-REMEDIATION.md).
- Export repair `20261105134446` retains current live capabilities for registration/download and orphan cleanup. The deployed report explanation was checked without exporting or changing permissions. Allocation-balance repair `20261105135318` exposes only allocation identity and quantities through an authenticated, live-capability-gated read. Deployed remaining0 of issued2 and disabled submission passed a guarded read-only check; normal Learning synchronization was blocked. Neither check certifies transaction execution or replaces serial, hold, return or independent-review guards.

## Release Evidence Still Required

See [November6 evidence](../../releases/2026-11-06-RELEASE-READINESS.md). Original bridge20261105233321 is unchanged. Canonical profile-email versus offline receipt UUID repair applied once as20261106032602, byte-identical to012547, SHA256 `fcede47f4671ab241d9e0a04face6d626aabb559fe8e72e830d6165342339306`. Live11/11, comparisons45/45, offline11/11 passed;39 INFO/0 WARN/0 ERROR unchanged. Original rows/xmin remain origin1/history2/bridge0/break0/receipt1/claim0. Actor correction032602 is applied and postverified; G02 is BLOCKED awaiting fresh synthetic-serial approval, conversion/recovery NOT RUN. G01 is blocked by Auth administration. All90 human rows PENDING;520 engineering cells NOT RUN.

Earlier eb CI remains9 success/2 fixture failures;940 remains8 success/3 cancelled. D45 closes that fixture failure: helper and real approvals route passed first attempt at six viewports. Original dd retry trigger remains unproven. D45 actual native actor helper52/52 twice and123 prior local passes are technical proof, not history backfill or fresh live acceptance.

Retain a clean frozen install, actual aligned coverage execution, same-SHA hosted checks, failed-check/wrong-SHA promotion-denial tests, actual UAT identity and scoped non-SMTP browser/transaction results. Source-level assertions do not replace effective authorization or live behavior. Keep local, hosted, deployment, human and physical-device results separate.

Preserve existing business workflows, approvals, learning, stock, tester records and active policies. Use isolated owned fixtures for authorized writes, record before/after readbacks and any retained residuals, and never reset shared UAT to manufacture success. Do not purge queued commands while testing response-cache privacy.

Infrastructure/recipient ownership remains to be confirmed. Transfer only reviewed source/history and non-secret configuration references. See the [separate Reporting API phase](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md) for unresolved provider/dictionary/runtime approvals; operational app deployment is not permission to provision that service.
