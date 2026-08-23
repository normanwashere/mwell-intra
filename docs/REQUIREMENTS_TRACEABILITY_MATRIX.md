# Mwell Intra Launch Traceability Matrix

This matrix is the release source of truth for roadmap items that were not fully evidenced by the application audit. A row is launch-ready only when implementation, automated evidence, business UAT, and named ownership are all complete.

## Policy Alignment 2026-07-10

| Requirement | Source | Implementation | Verification |
| --- | --- | --- | --- |
| Entity-specific vendor accreditation and signed declaration | LGL004 Vendor Accreditation Form v.2025 | `vendorAccreditationV2025.ts`, governed snapshots, Vendor/Legal application pages | Legal unit tests; `policy-vendor-legal.spec.ts` |
| Two-party Technology Service Provider MNDA on one immutable hash | Technology Service Provider MNDA | Governed instrument documents, signatures, and lifecycle | Legal unit tests; Vendor/Legal E2E |
| Procurement owns route; exceptions and importation are structured | Revised Procurement Policy | Route decision, exception, sourcing/evaluation, and protection controls | Procurement policy tests; `policy-procurement.spec.ts` |
| Named matrix-backed approvers; fail closed without active DOA | Revised Procurement Policy and approved DOA prerequisite | DOA matrices/assignments and hardened `submit_request` | Schema/contract verifiers; transaction-wrapped migration compile |
| Approved award and eligible vendor before PO issue | Procurement and vendor policy | PO approval/issue guards and scoped temporary-clearance check | Receiving policy tests; payment readiness E2E |
| Warehouse/requester acceptance and complete evidence before Finance | Procurement payment controls | Acceptance/payment packs and guarded Finance transitions | `policy-payment-readiness.spec.ts`; Warehouse bridge tests |
| Open records reviewed without rewriting signed evidence | Cutover control | `migrate-policy-review-records.mjs` and remediation queue | Node fixture tests; dry-run report |

## Canonical Mwell Procurement Alignment 2026-08-23

This section traces application behavior at `0bf88e362acec9ee8f5c59dbda865a8d4767e4a2` and the maintained handbook. It is local code/documentation evidence only. The additive migration is unapplied; no live database, deployment, or UAT certification is asserted.

| Requirement | Authority classification | Implementation/documentation | Verification and remaining gate |
| --- | --- | --- | --- |
| Preserve exact canonical source identity for `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx`, including SHA-256 `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239` | Direct mWell source identity | Canonical source name/hash in policy profile, migration, specification, process library and handbook source | Module/profile and handbook integrity tests; any changed binary requires a new governed profile revision |
| Preserve the source's own status as an updated visual draft and prevent accidental activation | Direct mWell source status plus local fail-closed control | `source_document_status` is versioned; client and SQL reject active profiles unless source status is approved | Profile unit tests and disposable-database activation denial; Procurement approval and controlled UAT remain gates |
| RFQ below PHP 1,000,000 when clear/comparable; RFP at or above PHP 1,000,000 or for complex, technical, strategic, high-risk, data-sensitive or non-comparable work | Direct canonical mWell routing requirement | Shared TypeScript/SQL route derivation, request facts, route panel and maintained guidance | Boundary, risk, importation and server-route parity tests; migration remains unapplied |
| Importation adds landed-cost, customs, logistics, currency and acceptance controls without automatically forcing RFP | Direct canonical mWell requirement | Importation risk fact contributes special controls but is excluded from the RFP trigger by itself | Low-value simple/comparable import fixture remains RFQ; import-control evidence remains mandatory |
| Requirement kind controls scope, acceptance and reporting rather than RFQ/RFP selection | Direct implication of canonical routing plus local data model | Goods/service/mixed classification retained independently from solicitation document | Goods/service cross-product route tests and UI copy assertions |
| Solicitation document, procurement mode, governance tier and effective DOA remain independent and explainable | Local implementation mapping | Route projection, request UI, governed profile, canonical 13-step process and system-expanded states | Module/contract tests plus generated-handbook assertions; no live/UAT claim |
| Requester supplies business facts; Procurement confirms route, vendor readiness and risk | Direct canonical ownership rule | Request draft separates requester inputs from controlled Procurement review/confirmation | Role and command tests; business UAT remains pending |
| Direct Award requires basis, supplier, justification, price support, accreditation path, Procurement Head review and active DOA | Direct canonical mWell requirement | Exception pack, eligibility gates, independent review and DOA handoff | Exception unit/disposable-database matrix; live transaction evidence pending |
| Vendor eligibility is owned by VMO where available; interim Legal coordination is attributable and scope-bound | Direct canonical mWell requirement | Accreditation case, temporary clearance scope/expiry, ownership and PO gates | Vendor/Legal tests and Task 10 authority matrix; business ownership confirmation pending |
| Petty cash requires Finance eligibility, no split/repeat bypass and OR/SI/liquidation evidence | Direct canonical mWell requirement; numeric cap is inherited/configured where used | Petty-cash exception facts and Finance decision remain separate from requester's claim | Negative split/recurrence/evidence tests; inherited amount provenance must remain visible |
| Initial bid window and calendar-day extension controls retain MPIC provenance when inherited | Incorporated MPIC timing reference | Versioned profile uses `maxExtensionCalendarDays`; equal notices and requote deadline cap are server enforced | Sourcing tests and disposable database extension/requote matrix |
| Commercial and technical evaluation produce a reasoned best-value recommendation; no automatic lowest-price award | Canonical mWell and incorporated best-value controls | Attributable tabulation, technical review, recommendation and variance path | Task 6 tests and award decision flow; business acceptance remains separate |
| Neutral recommendation-variance decisions remain blocked from named mWell authority until policy/DOA owners authorize the mapping | Unresolved local authority mapping | First/second independent decisions retain evidence without projecting MPIC titles into mWell authority | Activation gate and conflict register; Procurement, Finance and department/DOA owner decision required |
| The canonical 13-step spine maps to system-expanded sourcing, acknowledgement, inspection, recovery and Finance states | Direct canonical process plus local implementation detail | Process library, specification, manual and traceability distinguish policy steps from application states | Handbook structure and search assertions; migration unapplied and Task 12 live gates outstanding |
| Requester, Department Head, Procurement Lead, Legal/Compliance, technical reviewer, Warehouse/Operations, Finance Controller, vendor representative, and Platform Admin have standalone procedures | Local operating instruction | Manual procedures include start, permitted/prohibited action, handoff, denial, recovery, and completion evidence for each role | Generated-handbook search/manual review; business training/UAT remains pending |
| MPIC HR Admin/HR Head/Group Controller/CFO/CEO and annex approvers are not silently mapped to Mwell | Unresolved ownership/authority conflict | Maintained extract conflict register; effective Mwell DOA is the only named authority | Source-owner, Procurement, Finance, Legal/VMO, and department-owner decision required before any mapping |

The designated-project live gate is `scripts/qa/policy-aligned-live-e2e.mjs`. It refuses to run without an explicit project reference, HTTPS deployment, run ID, and external audit password; mutation mode requires a second opt-in.

| Roadmap ID | Launch requirement | Implementation or control | Automated evidence | Business evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-013 | Bulk master-data migration/import | Versioned CSV contracts in `docs/import-templates`; cutover dry-run and reconciliation procedure | Import header validator in release checklist; database count/checksum reconciliation | Signed dry-run reconciliation | Data migration lead | Process-ready; execution pending |
| F-029 | Legal accreditation summary export | `caseSummary.ts`; reviewer/approver action on Legal case detail | `caseSummary.test.ts` | Legal confirms fields and retention handling | Legal operations | Code-complete; UAT pending |
| F-086 | Data migration and cutover | `MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md`; immutable migration sequence; rollback criteria | `verify:supabase-cutover`; migration compile checks | Go/no-go record and reconciliation sign-off | Release manager | Process-ready; production run pending |
| F-087 | Standardized import templates | Versioned templates and contract README under `docs/import-templates` | Header/schema validation in preflight | Data owners approve mappings | Data migration lead | Complete; owner approval pending |
| F-100 | Role-based training and operations handoff | `USER_TRAINING_AND_OPERATIONS_MANUAL.md` | UAT attendance/evidence checklist | Attendance and competency record | Change manager | Process-ready; delivery pending |
| F-101 | UAT and issue management | `UAT_AND_ISSUE_MANAGEMENT.md`; severity, SLA, retest, waiver and sign-off rules | CI, live role crawler, issue evidence links | UAT sign-off and open-risk acceptance | Product owner | Process-ready; execution pending |
| WH-006 to WH-016 | Governed receiving, storage and inventory identity | Receiving, quality, storage, scan and product-detail routes; controlled receipt/relocate/transfer commands | Warehouse component suite; `warehouse-w1-workflows.spec.ts`; `warehouse-w1-visual.spec.ts` | Warehouse lead executes serialized and bulk receipt/putaway UAT | Warehouse lead | Code-complete; live UAT pending |
| WH-020 | Returns and disposition | Return scan validation, inspection staging, quality hold and vendor-return evidence | `ReturnsPage.test.tsx`; `QualityPage.test.tsx`; W1 workflow negative scan | Operations and Warehouse sign disposition record | Operations lead | Code-complete; live UAT pending |
| WH-036, WH-038 | Bin and location control | Scannable storage areas, exact-unit putaway and governed transfer | `StorageAreasPage.test.tsx`; `ProductDetailPage.test.tsx`; reload persistence workflow | Warehouse supervisor reconciles source/destination | Warehouse lead | Code-complete; live UAT pending |
| WH-041 to WH-045 | Cycle count and approval governance | Presence-based serialized counts, blind counts, variance requests, Supervisor/Finance approval | `CycleCountsPage.test.tsx`; `ApprovalsPage.test.tsx`; W1 workflow test | Supervisor and Finance separation-of-duties UAT | Finance controller | Code-complete; live UAT pending |
| WH-053 to WH-059 | Imports, reports, exceptions and operating routes | Governed import review, inventory-position export, exception queue and route policy | Page/API tests; W1 visual matrix; schema/contract verifiers | Data owner reviews import evidence and report totals | Data migration lead | Code-complete; live UAT pending |

## Evidence Rules

- `Code-complete` means merged code has focused tests, typecheck, lint, build, and rendered responsive evidence.
- `Process-ready` means the template and approval path exist; it does not imply the business activity happened.
- A screenshot alone does not prove persistence. Mutation evidence must include the created record ID and an independent database read-back.
- A waiver must identify the residual risk, compensating control, owner, expiry date, and executive approver.
- Production launch requires zero open P0/P1 defects and explicit disposition of every P2.
- Warehouse W1 visual evidence requires six viewports, both themes for each role dashboard, all admin routes, three complete runs, and a named human contact-sheet reviewer.
- Live Warehouse status remains `pending` until authorized write, wrong-role denial, fresh-session read-back, idempotency and concurrency evidence all pass in the designated Supabase test project.

## External Decisions

| Decision | Required owner | Due before |
| --- | --- | --- |
| Final ERP/courier/payment integration scope beyond CSV handoff | Executive sponsor and enterprise architecture | Post-MVP planning |
| Retention periods for vendor documents and generated exports | Legal, Privacy, Information Security | Production data load |
| Named on-call and escalation contacts | Operations and Engineering | Go/no-go meeting |
| Production Supabase secret key and invitation sender configuration | Platform owner | Vendor invite UAT |
