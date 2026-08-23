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

## MPIC Procurement Alignment 2026-08-23

This section traces application behavior at `0bf88e362acec9ee8f5c59dbda865a8d4767e4a2` and the maintained handbook. It is local code/documentation evidence only. The additive migration is unapplied; no live database, deployment, or UAT certification is asserted.

| Requirement | Authority classification | Implementation/documentation | Verification and remaining gate |
| --- | --- | --- | --- |
| Preserve exact source identity and binary authority for `MPIC Procurement Policy February2025.docx`, MPIC, February 2025 | Direct MPIC source identity | `MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md`; cataloged under Security & Governance with Workflow and Architecture visibility | Handbook integrity/build tests; binary checksum recorded. Source owner still controls any source revision |
| Materials use RFQ; services use RFP; competitive bidding remains the default mode | Direct MPIC requirement | Three-axis route model in Procurement code, specification, process library, manual, training, and control matrix | Procurement policy tests and handbook search assertions; live activation remains gated |
| PHP 1,000,000 controls local formal-bid governance and does not switch RFQ/RFP | Local Mwell mapping; absent from MPIC source | Active local code-profile mapping and all maintained procurement guidance | Boundary/route tests at code baseline; authorized profile/DOA and unapplied-migration status remain cutover gates |
| Solicitation document, procurement mode, governance tier, and effective DOA remain independent and explainable | Local Mwell mapping | Route projection, request UI, policy profile, 14-stage process maps, and role procedures | Module/contract tests from Tasks 1-10 plus generated handbook assertions; no live/UAT claim |
| Invite three to four accredited vendors; sealed bids require at least three usable responses or governed failed-bid recovery | Direct MPIC requirement with local recovery mapping | Versioned package, invitation/communication evidence, quorum blocker, current independently approved pre-issue invitation-target exception, failed-bid state, equal-notice extension/requote, insufficient-bids decision | Structural branch test and Task 5 sourcing tests; live transaction evidence remains Task 12 work |
| Initial bid window is at least seven working days; extension cap is seven calendar days | Direct MPIC timing requirement | Current code/migration changes the extension to a working-day control through `maxExtensionWorkingDays`; this is disclosed, not inherited | Unapproved local mismatch; activation blocked until Procurement owner authorizes a local unit or code is corrected to the source cap |
| Record commercial tabulation and technical evaluation; select no automatic winner | Direct MPIC best-value requirement plus local control | Attributable evaluation records and best-value recommendation | Task 6 tests and award decision flow; business acceptance remains separate |
| Differing recommendation directly names written Requestor justification, Department Head approval, and Group Controller decision | Direct MPIC requirement only | Current Mwell code maps the stages to `dept_head` then `finance`; operating docs use neutral first/second independent decisions | Local authorization is unresolved; activation blocked until Mwell Procurement, Finance, department/DOA owners approve the stages and effective authority, or code is changed |
| Sole source, repeat order, emergency, petty cash, and other exceptions require source eligibility, evidence, owner review, and DOA | Direct MPIC requirements with local server enforcement | Exception mode model and eligibility/evidence paths; source values separately attributed | Task 7 exception tests and handbook decision tree; source values are not approval limits |
| PO/agreement, acknowledgment, weekly monitoring, receiving/QC/RMA, payment evidence, and closure remain linked | Direct MPIC requirements with local Warehouse/Finance mapping | Tasks 8-10 commitment, lifecycle, quality, eligibility, payment, and closure controls; exact 14-stage overview | Local module/contract/browser fixture evidence from prior tasks; migration unapplied and Task 12 live gates outstanding |
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
