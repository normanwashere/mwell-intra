# Technical Handoff

Use the [current release manifest](release-status.json) for observed UAT identity, candidate identity and acceptance evidence. The [September technical pack](../2026-09-22/technical.md) is historical; CI212 and its source-transfer evidence do not certify this candidate. UAT remains `0b7964e`; follow-up source and applied database versions are separate. No receiving-team acceptance is recorded here.

## Candidate Boundaries

- Service-worker caches are public-only: allowlisted same-origin static assets and the public offline fallback. Authenticated API, document, page and data responses must remain network-only. Legacy private response caches must be purged on worker activation and session/access changes without deleting actor-scoped IndexedDB queued commands. This is not offline access to private records.
- Anonymous protected API calls must return JSON 401 with `Cache-Control: private, no-store`, not a login redirect. Ordinary protected page navigation still redirects to sign-in. Signed-in capability denials remain 403. This does not create or enable Reporting API routes.
- My Work paging follows the database cursor order, including mixed-case legacy IDs; repeated or invalid cursors still fail safely. A source failure is not an empty source and must not erase unrelated authorized data.
- Picking accepts another valid source bin when no explicit order-bin constraint exists, while preserving warehouse, exact serial, hold, reservation and server command checks. A recommendation is not authority or proof of sufficient current stock.
- CSV unknowns, Finance period labels and Product workflow-region accessible names follow the appended [pending release addendum](../../releases/2026-11-05-WMS-AUDIT-REMEDIATION.md).
- Export repair `20261105134446` retains current live capabilities for registration/download and orphan cleanup. The report's new disabled-action explanation does not grant permission. Allocation-balance repair `20261105135318` exposes only allocation identity and quantities through an authenticated, live-capability-gated read; governed event custody uses the existing sale-aware calculation. Quantity display does not replace serial, hold, return or independent-review guards. Both follow-up client changes await deployment and retest.

## Release Evidence Still Required

See the [November 6 readiness update](../../releases/2026-11-06-RELEASE-READINESS.md) for the proposed Quality-to-putaway conversion bridge. It is not recorded as applied. Required CI now includes its SQL/repository regression suite as well as native full migration replay; neither substitutes for the isolated live conversion journey.

Retain a clean frozen install, actual aligned coverage execution, same-SHA hosted checks, failed-check/wrong-SHA promotion-denial tests, actual UAT identity and scoped non-SMTP browser/transaction results. Source-level assertions do not replace effective authorization or live behavior. Keep local, hosted, deployment, human and physical-device results separate.

Preserve existing business workflows, approvals, learning, stock, tester records and active policies. Use isolated owned fixtures for authorized writes, record before/after readbacks and any retained residuals, and never reset shared UAT to manufacture success. Do not purge queued commands while testing response-cache privacy.

Infrastructure/recipient ownership remains to be confirmed. Transfer only reviewed source/history and non-secret configuration references. See the [separate Reporting API phase](../../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md) for unresolved provider/dictionary/runtime approvals; operational app deployment is not permission to provision that service.
