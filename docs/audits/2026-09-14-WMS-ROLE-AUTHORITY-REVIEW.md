# WMS Role Authority Review - September 14

## Status

Application fixes passed the local release checks and independent review and were deployed to UAT as `10cb74545c0bbdf67bf2dd082ca4661d1b2d78d0`. Post-deployment checks are recorded below. The further KB control-reference wording correction is live as `9c712baeb4c9ecb4e7bb84049fa8e9f977e81306`; deployment `dpl_2Hhb2RShFQKPuEAywHWQ38cvQxTH` and exact UAT health were verified at `2026-09-13T17:37:26.906Z`. Final full-shell tests passed 746 with one skip, and the signed-in desktop/mobile guide was visually reviewed. The local receipt is `outputs/wms-signoff/sep14-role-authority/KB-DEPLOYMENT-RECEIPT.md`. This report does not award WMS signoff, isolated-role journey completion, screenshot certification or human acceptance. SMTP remains excluded.

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

Seven isolated role identities still need guarded provisioning and normal onboarding before their separate journeys can be awarded. The complete transaction matrix, fixture reconciliation/cleanup and actual user/device pilot remain open.

An additional unresolved journey gap was found: the Replenishment panel is mounted only on `modules/warehouse/src/pages/ProcurementPage.tsx`, whose route requires `view_procurement`. Operations-only and Operations-plus-Warehouse-Operator have recommendation authority but not that viewing permission. The button correction does not make that route reachable. Add a separately reviewed, recommendation-only entry that exposes only the stock context these roles may read; preserve the existing recommendation RPC and downstream Procurement decisions. Do not solve this by granting broad Procurement viewing or claiming the recommendation journey is complete.

The temporary CLI-login adapter for seven isolated accounts is an offline-only candidate, excluded from this application release. Its 106 tests passed and an independent review checked the credential/approval expiry guards. Real credential renewal, pinned PostgreSQL session verification and account provisioning still need a fresh build-bound execution plan. No account creation or new credential issuance was performed for this candidate review.

## Deployment And Live Review

Vercel deployment `dpl_2nphVomnSyCMgcg5rA5JBSLsYsST` reached READY for the fixed UAT project. At `2026-09-13T17:14:03.001Z`, the shared UAT alias returned exact commit `10cb74545c0bbdf67bf2dd082ca4661d1b2d78d0`, environment `uat`, backend project `kkoitlvydytdhlpxhuah`, status `ok` and reachable Supabase. No database migration was applied.

Fresh ordinary-session run `7c9c58c4-a1ba-4905-b103-df62e2a5d6f6` ran from `17:14:04.040Z` to `17:15:02.135Z`. Both health checks matched the deployed commit. It completed 420 requests and all 341 capability decisions across 11 accounts, with zero recorded discrepancies. The same ten empty visible-catalogue limits remain explicit; the runner exited nonzero and did not award signoff. The installed catalogue policy requires `manage_rbac`, so this does not justify widening ordinary accounts' catalogue visibility.

The Operations Associate audit identity opened the actual floor dashboard and the existing **Export raw data** dialog on desktop (1440x900) and mobile (390x844). The floor entry was absent in the old build and present after the update. The primary next-task link remained in place. The dashboard had no horizontal overflow at either width. The three export choices and Close remained readable and usable; mobile buttons measured 44 CSS pixels high. Both dialogs were closed without selecting an export, changing stock or submitting a business record. Viewport override was reset.

Four settled live dark-mode screenshots were visually reviewed: dashboard and export dialog at each size. A pre-release desktop baseline was also reviewed. Browser images are inline conversation evidence, not archived hash-bound screenshot certificates. This check does not prove a completed export download, every role/screen, physical touch or hardware acceptance.

The live role guide shows the corrected Operations-only boundary and new typed permissions. However, the related dashboard control reference still contained the old export-viewing permission text, and older guided-flow ownership still assigns some physical tasks to Operations. The export wording is a follow-up correction; a separate semantic review of flow owners is needed. Role-guide corrections alone must not be presented as a fully reconciled KB.

The export-reference follow-up separates page entry from export preparation on the three feature guides without changing grants, control IDs, routing or evidence status. The first implementation pulled the full control-reference module into the client component. A failing import-boundary regression test was added, then the shared copy was moved into a dependency-free small module. The measured production service-worker precache fell from 17,131.07 KiB to 17,005.67 KiB, compared with 17,004.69 KiB before the follow-up. This is build-size evidence, not a browser latency benchmark. After extraction, 452 Knowledge Base/component tests passed with one skip, and an independent reviewer reran 78 focused tests and checked the changed hashes. The production build and 55 handbook/catalogue/release-documentation tests passed. The earlier full-shell run passed 745 tests with one skip before the import-only extraction.
