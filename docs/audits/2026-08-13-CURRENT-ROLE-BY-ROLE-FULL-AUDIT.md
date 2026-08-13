# Mwell Intra role-by-role full audit

Date: 2026-08-13

Commit reviewed: `37b688b` on `codex/a11y-shared-primitives`, including the current uncommitted workspace state.

## Decision

**Not launch-ready.** The application has broad route coverage, generally clear desktop/mobile layouts, meaningful RBAC structure, and strong source-level control tests. It is not yet a trustworthy end-to-end operating system because mandatory certification is inconsistently enforced, several role curricula cannot be completed, cross-module records do not always share canonical identities, and key final mutations are either demo-only, Supabase-only, or absent from the assigned role's reachable UI.

This audit used parallel role owners for all 11 launch personas, source/schema review, existing exact-UAT evidence, and controlled Playwright reruns at 1440x900 and 390x844. The current local target is **memory/demo mode**. No live Supabase data was mutated, so live read/write certification remains a launch gate.

## Critical findings

### P0-1: Mandatory certification can be bypassed on governed mutations

The Learning model declares mutation capabilities certification-gated, but Warehouse issue/transfer/return/count, Product decisions, Procurement/Finance decisions, Event mutations, and payment review/release still rely on raw roles or `core.has_cap`. Some payment mutations are authorized by read-class capabilities. Only selected paths, such as the remediated Warehouse receive command, consistently use `core.has_live_cap`.

Primary evidence:

- `supabase/migrations/20260812200000_learning_authority.sql:222`
- `supabase/migrations/20260707110000_warehouse_actor_identity.sql:119`
- `supabase/migrations/20260722121500_product_readiness_and_pricing_governance.sql:182`
- `supabase/migrations/20260810155350_procurement_legal_database_authority_remediation.sql:27`
- `supabase/migrations/20260810160000_finance_event_authority_remediation.sql:71`

Impact: an assigned but uncertified actor can call protected mutation RPCs directly even when the UI appears locked.

### P0-2: PO receiving can bypass onboarding and inspection custody

At 0% onboarding, standalone Receiving blocked completion, but the Purchase Orders receipt path accepted stock, completed the PO, and posted inventory movements without a receipt in Recent Receipts or a Quality task. The repository can mark serials `in_stock` and increase nonserialized stock immediately while the UI says the items are in inspection staging.

Primary evidence:

- `modules/warehouse/src/pages/PurchaseOrdersPage.tsx:284`
- `modules/warehouse/src/app/store.tsx:483`
- `packages/data-kit/src/inMemoryRepository.ts:855`
- `packages/data-kit/src/supabase/SupabaseRepository.ts:1297`
- `modules/warehouse/src/pages/ReceivingPage.tsx:1122`

### P0-3: Legacy returns bypass quarantine and disposition authority

The operator can choose immediate restock, lost, or vendor-return disposition without mandatory evidence. Stock and serial state mutate before an independent Quality decision, contradicting the stated quarantine-first workflow.

Primary evidence:

- `modules/warehouse/src/pages/ReturnsPage.tsx:45`
- `modules/warehouse/src/pages/ReturnsPage.tsx:305`
- `packages/data-kit/src/supabase/SupabaseRepository.ts:1040`
- `supabase/migrations/20260707110000_warehouse_actor_identity.sql:211`

### P0-4: Private Warehouse implementations are executable by normal authenticated users

Private `SECURITY DEFINER` implementations for transfer and other Warehouse controls retain authenticated execute grants. The functions perform capability checks, but the intended public-wrapper/private-implementation boundary is bypassable.

Primary evidence:

- `supabase/migrations/20260810155237_block_transfer_of_held_inventory.sql:209`
- `supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql:1301`

### P0-5: Replenishment writes are authorized by a read-class capability

`warehouse:view_procurement` is classified read-only but authorizes creating/updating/accepting/dismissing replenishment recommendations and creating Procurement requests. This bypasses least privilege and the Learning mutation catalogue.

Primary evidence:

- `packages/rbac/src/registry.ts:133`
- `supabase/migrations/20260804201000_fix_replenishment_procurement_handoff.sql:15`
- `supabase/migrations/20260804201000_fix_replenishment_procurement_handoff.sql:49`

### P0-6: Sensitive Legal documents lack governed signed access and access auditing

Live uploads retain private storage paths, but the Legal/vendor UI only renders an Open action for memory-mode data URLs. Direct Storage SELECT remains possible for broad authenticated scopes and no Legal-specific signed-access command records who retrieved the evidence.

Primary evidence:

- `supabase/migrations/20260707090000_document_storage_buckets.sql:42`
- `modules/legal/src/localStore.ts:285`
- `modules/legal/src/pages/CaseDetailPage.tsx:1405`

### P0-7: Platform Admin and Finance live authority does not match assigned work

The exact 2026-08-13 UAT evidence denied Platform Admin on `/admin/users` and `/admin/doa`, and Finance Controller on `/warehouse/approvals`, despite those being assigned launch responsibilities. Conversely, the memory `demo-admin` incorrectly has Events Administrator and Insights Administrator powers.

Primary evidence:

- `docs/audits/2026-08-13-LIVE-UAT-FULL-LAUNCH-READINESS-AUDIT.md:20`
- `apps/shell/lib/demoProfiles.ts:209`
- `packages/rbac/src/modules/warehouse.ts:170`

### P0-8: Finance close data is not least-privilege scoped

Procurement-only and Warehouse pricing/Finance users can read all Finance close entries because both application scoping and RLS treat the close register as a single shared set.

Primary evidence:

- `modules/finance/src/data.ts:105`
- `supabase/migrations/20260804200000_operational_flow_completion.sql:549`

## High-priority cross-role findings

1. **Onboarding is not completable for most mutation roles.** Platform Admin, Operations Lead, Procurement, Finance, Legal, Product, and Event practices commonly show “Guided practice is being prepared.” Only the Warehouse receiving adapter is registered. Memory completion can reset after reload.

2. **Role definitions are inconsistent.** Operations Lead, Procurement Lead, Legal & Compliance Lead, Finance Controller, and General Requester demo accounts do not match their published persona bundles. The shell frequently displays “Department not specified.”

3. **Procurement-to-payment is not one joined transaction.** Finance links to `po-demo-1042`, which is absent from Procurement seed data. Budget/DOA approval can be offered while required policy evidence is visibly missing. PO cancellation calls a missing live RPC and has no reason, confirmation, or downstream cleanup.

4. **Vendor accreditation has no governed correction loop.** Server submission accepts materially incomplete applications because completeness is client-only. Submitted cases look editable while live draft/save RPCs reject them. `correction_requested`/resubmission and immutable revision comparison are missing.

5. **Event flow stops at cross-module boundaries.** Event creation works in memory, but warehouse fulfillment, lifecycle management, and reconciliation throw Supabase-required errors. Live Event mutation RPCs still use raw capabilities. Finance settlement is absent from the unified Finance queue.

6. **Product approval is not an enforced launch gate.** `product.can_launch()` is not consumed by downstream fulfillment/procurement activation, evidence is self-attested JSON, and Warehouse can type a free-form Product approval reference when publishing a kit.

7. **Operations Lead cannot complete its core live job.** UAT denied Receiving, Quality, Approvals, Counts, Locations, and Storage. Responsibility switching is presentation-only in live mode and resets on refresh in memory mode.

8. **My Work is a static, non-authoritative queue in memory mode.** It assigns inaccessible tasks, computes priority counts before capability filtering, and frequently links to records that do not exist or routes the persona cannot open.

9. **Insights is not decision-grade.** A month-old demo snapshot is labelled current, PR-to-PO cycle is not based on PO issue time, drill-downs lead to empty My Work, and a documented governed export capability has no UI/API workflow.

10. **Knowledge Base claims exceed reachable behavior.** Content/provenance validation passes, but several “Live” tasks are empty, denied, Supabase-only, or linked to stale routes. Vendor users see no useful workflow guidance for their accreditation journey.

11. **Reports/exports are fragmented.** Warehouse report deep links redirect to Insights and can deny Finance; client-side exports may cover only the first 100 rows; governed export history, review, correction, checksum, and download read-back are not reachable from Finance.

12. **Seed integrity is contradictory.** An issued/partially received PO uses a vendor still under accreditation review and a source request with mandatory RFP documents missing. Empty states prevent role owners from testing approval, hold, exception, settlement, and recovery paths.

## Role verdicts

| Role | Verdict | Primary blockers |
|---|---|---|
| Platform Administrator | Blocked | Live Admin denial; overprivileged demo; expiry/approval/DOA segregation incomplete |
| General Employee / Requester | Blocked | No Procurement requester role; Event handoff cannot complete; dead My Work tasks |
| Operations Associate | Blocked | Certification bypass; returns bypass; non-PO receiving; missing floor navigation |
| Operations Lead | Blocked | Private RPC grants; read-capability writes; live route denial; nonpersistent duty switch |
| Procurement Lead | Blocked | Persona mismatch; no sourcing in current target; missing cancel RPC; evidence/seed contradictions |
| Finance Controller | Blocked | Certification bypass; disconnected PO IDs; no completable close/settlement/payment path |
| Legal & Compliance Lead | Blocked | No governed document access; no completable training; correction/lifecycle gaps |
| Marketing & Events Lead | Blocked | Memory handoff/reconciliation dead ends; raw capability RPCs; Finance handoff not unified |
| Product Owner | Blocked | No demo happy path; certification bypass; go-live decision not consumed downstream |
| Leadership / Insights | Blocked | Stale/miscalculated KPIs; dead drill-down; export absent |
| Vendor Representative | Blocked | Private documents cannot be opened; server completeness weak; no correction workflow |

## UX and accessibility findings

- Controlled RBAC/Finance rerun passed 16/16 on desktop and mobile, with no page-level overflow.
- The onboarding recovery suite passed 10/10 across both breakpoints.
- Role workspace rerun passed 2/12. Events failed because `getByLabel("Department")` matches the form control and two shell persona containers whose accessible names include “Department not specified.” This is a real accessible-name collision; the form remains visually present.
- Four shared surfaces report one clipped visible command with an empty text node at both breakpoints: Events Viewer, Insights, My Work, and Knowledge. The common shell/control must be identified and sized or excluded only after proving it is a nonvisual measurement artifact.
- Mobile Procurement wraps “Procurement” mid-word. Finance activity exposes raw IDs. Some routes spend several seconds in shell-only loading without bounded recovery.
- The current source contains visible mojibake such as `Â·`, `âŒ˜K`, and `â€”`, including `apps/shell/components/PersonaContext.tsx:30` and `apps/shell/components/AppShell.tsx:239`.

## Verification results

Passed:

- Shell typecheck.
- Shell lint with one warning, no errors.
- Operational flows: 4/4.
- Finance/Event authority: 3/3.
- Insights read-only: 1/1.
- Procurement contract and 17-table policy schema checks.
- Cross-department WMS: 3/3.
- Knowledge content/provenance: 79/79.
- Learning authority/lifecycle/source verification: 93/93 in the final constituent suites.
- Controlled Playwright RBAC/Finance: 16/16.
- Controlled Playwright onboarding: 10/10.

Failed or unproven:

- Role-workspace Playwright: 10 failures at both breakpoints, comprising one accessible-name collision and one shared clipped-control hit repeated across four views.
- One serialized cycle-count test timed out in isolation in the Operations Lead audit.
- The audit host used Node 20.18.1 while the repository requires Node 22 or newer.
- No fresh live Supabase write/read/handoff/cleanup transaction was executed for this audit.

## Required remediation sequence

### Gate 1: Authority and data safety

1. Require `core.has_live_cap` at every mutation RPC; give payment, replenishment, export, and other artifact-generating actions dedicated mutation capabilities.
2. Revoke authenticated execution from all private implementations; expose audited public wrappers only.
3. Make every receipt create receipt lines and pending Quality custody; stock remains unavailable until accepted.
4. Retire or normalize legacy returns to quarantine-first, independent disposition.
5. Add governed Legal signed access with short TTL and immutable access logs; harden vendor submission server-side.

### Gate 2: Role-complete onboarding and identity

6. Publish distinct, completable curricula for all 11 personas; persist completion and prove denial-before/allow-after at the database.
7. Align account fixtures, RBAC bundles, persona labels, departments, navigation, Knowledge, and My Work from one canonical role contract.
8. Correct Platform Admin, Operations Lead, Procurement Lead, Finance Controller, and Legal composite-role assignments without collapsing segregation of duties.

### Gate 3: One canonical cross-module transaction graph

9. Use canonical request/vendor/PO/receipt/inspection/payment/event/product IDs in every module and task.
10. Provide one seeded happy path and one correction path per major process: procurement-to-payment, receiving/QC, pick-pack-release, return/replacement, event custody/settlement, Product go-live, vendor correction/lifecycle, adjustment/close.
11. Add explicit owner, SLA, state, blocked reason, and source-record link to every handoff.
12. Enforce Product go-live and Legal/vendor eligibility as downstream transactional gates.

### Gate 4: UX, evidence, and release certification

13. Fix accessible-name collisions, clipped commands, mojibake, role/department labels, mobile word wrapping, and bounded loading/recovery.
14. Generate My Work and Knowledge from effective capabilities and actual record state. Mark demo-only and unavailable work accurately.
15. Run a serial live-UAT matrix at 1440x900 and 390x844 for all 11 personas: onboarding, happy path, negative path, stale/replay, second actor, refresh/deep-link, durable read-back, audit evidence, and cleanup.
16. Run all CI and E2E on Node 22+, then require live Supabase evidence before any launch-ready decision.

## Evidence index

Full role reports are in `outputs/role-audit-2026-08-13/01-platform-admin.md` through `11-vendor-representative.md`. Marketing & Events was covered by the central Events source/Playwright pass because its first delegated worker did not produce a final artifact within the audit window.
