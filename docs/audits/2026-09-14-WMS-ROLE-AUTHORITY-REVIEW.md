# WMS Role Authority Review - September 14

## Status

Candidate fixes passed the local release checks and independent review. Deployment and post-deployment checks are recorded separately below when completed. This report does not award WMS signoff, isolated-role journey completion, screenshot certification or human acceptance. SMTP remains excluded.

## What Failed

The first ordinary-session readback stopped on an installed capability absent from the source catalogue. Run `a46369ab-03bd-4bd4-8f0f-f2a374fa046c` checked UAT build `9e67f47fa20c553710f77fc7555819f098a203b7`. It collected one actor before failing with `unknown-installed-catalogue`. Its failed report is retained under `outputs/wms-signoff/role-session-a46369ab-03bd-4bd4-8f0f-f2a374fa046c/report.json`; it is not passing evidence.

A separate administrative metadata read found 232 installed role-capability entries across seven modules. Twelve entries introduced by the July 21 and August 13 migrations were missing from the source catalogue: eight warehouse entries and four Procurement entries. The corrected source matches all 232 saved entries, including 111 warehouse entries. Warehouse Administrator retains exactly its previous 26 permissions. No database grants, role assignments or training records were changed by this comparison.

## Corrections

- Declare the existing warehouse export preparation/review and replenishment recommendation capabilities, and Procurement replenishment management and PO cancellation capabilities. Classify these existing commands as governed mutations.
- Restore the existing return-case submission grants for Warehouse Operator, Warehouse Supervisor and Logistics Supervisor in the source catalogue.
- Correct the role guides: Operations-only demand coordination is not Warehouse Operator physical custody; Business Unit requests are not allocation authority; read-only Pricing is not permission to activate prices.
- Repair dependent task guidance and links when task wording changes. A full KB test run caught four tasks that had fallen back to generic guidance. Update the maintained control inventory without awarding new screenshot evidence.
- Review export and replenishment button permissions against their actual server command requirements. Viewing a report or recommendation must not imply authority to perform its commands.

The reviewed export correction covers Dashboard, Data & Reports and Inventory Reports, including a small export entry on the Operations Associate floor dashboard. It reuses the existing export dialog and service; it does not grant access to the Data or Reports routes. Replenishment Save uses warehouse recommendation authority, while Accept, Dismiss and Hand off use the separate Procurement management authority. Read-only rows and links are unchanged.

The source changes align the application with existing database authority. They do not add approval shortcuts or bypass required learning, independent review, stock holds or record scope.

## Verification Scope

The readback uses normal password-authenticated sessions for the 11 independently bound test identities. It checks own identity/assignments, a capability snapshot, 31 warehouse capability decisions per actor, the visible installed catalogue, and UAT build identity before and after the collection. An administrative catalogue comparison is separate evidence, not a substitute for ordinary-user authorization.

Collection against the existing live build uses a local candidate catalogue and must be distinguished from post-deployment application verification. Session readback alone does not prove department-scope enforcement, completed training, successful transactions or correct cross-user handovers. Missing or denied evidence remains explicit rather than being replaced with an administrative fallback.

## Remaining Work

Pre-deployment collection `8d60b3df-4dbf-434a-beef-a02985041198` completed against live build `9e67f47` using the corrected local catalogue. Between 16:53:21 and 16:54:17 UTC on September 13, it made 420 requests and collected all 341 warehouse capability decisions for all 11 accounts. Each observed role union matched the expected source permissions, with no extra or missing capability decisions or recorded authority contradictions. This is not verification of the undeployed UI changes.

The report intentionally remains limited: ten ordinary accounts received an empty visible role-catalogue result; only the platform administrator could read all 111 warehouse grant rows. The runner retained these ten evidence limits and exited nonzero instead of claiming unrestricted catalogue verification. We are not expanding catalogue access to make an audit pass. Actual department-scope enforcement and complete role journeys still require separate evidence.

Local verification passed: 1,053 warehouse tests across 109 files; 737 shell tests with one browser-specific skip; 65 RBAC tests; 52 authentication tests; 39 ordinary-session reader tests; and 55 handbook/catalogue/release-documentation tests. The production shell build and independent warehouse TypeScript check passed. The independent reviewer also reran 65 focused warehouse UI tests and verified the frozen source hashes. These are source, simulated component and build checks, not live transaction certification.

Complete the exact-candidate UAT deployment and a fresh post-deployment role readback. Seven isolated role identities still need guarded provisioning and normal onboarding before their separate journeys can be awarded. The complete transaction matrix, fixture reconciliation/cleanup and actual user/device pilot remain open.

An additional unresolved journey gap was found: the Replenishment panel is mounted only on `modules/warehouse/src/pages/ProcurementPage.tsx`, whose route requires `view_procurement`. Operations-only and Operations-plus-Warehouse-Operator have recommendation authority but not that viewing permission. The button correction does not make that route reachable. Add a separately reviewed, recommendation-only entry that exposes only the stock context these roles may read; preserve the existing recommendation RPC and downstream Procurement decisions. Do not solve this by granting broad Procurement viewing or claiming the recommendation journey is complete.

The temporary CLI-login adapter for seven isolated accounts is an offline-only candidate, excluded from this application release. Its 106 tests passed and an independent review checked the credential/approval expiry guards. Real credential renewal, pinned PostgreSQL session verification and account provisioning still need a fresh build-bound execution plan. No account creation or new credential issuance was performed for this candidate review.
