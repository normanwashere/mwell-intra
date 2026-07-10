# Legal, Vendor, And Procurement Policy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mwell Intra enforce the supplied Vendor Accreditation Form v.2025, technology-service MNDA, and revised Procurement Policy from vendor invitation through Finance payment readiness.

**Architecture:** Versioned policy definitions drive structured snapshots rather than mutable UI labels. Supabase tables and guarded RPCs are authoritative in live mode; TypeScript policy modules provide matching deterministic previews and tests. Cross-module transitions reference canonical vendor, accreditation, request, award, PO, receipt/acceptance, and payment-readiness records.

**Tech Stack:** TypeScript, React 19, Next.js, Vitest, Playwright, Supabase Postgres/Auth/Storage/RLS/RPC, pnpm/Turborepo.

## Global Constraints

- The three supplied documents are controlling sources; do not invent monetary thresholds, bid quorums, legal terms, approval authorities, or mandatory evidence.
- RFQ is below PHP 1,000,000 when clear/comparable; RFP is PHP 1,000,000 and above or complex, technical, strategic, high-risk, or data-sensitive.
- The technology MNDA ends at the earlier of two years from execution or definitive agreement, requires return/destruction within five business days when triggered, and uses PDRCI arbitration in Makati.
- Live approvals resolve from a versioned DOA assignment, never demo-role heuristics.
- Every submitted policy object preserves source/version, actor, immutable payload hash, previous/resulting state, timestamp, and audit correlation ID.
- Private documents remain private and are accessed only through short-lived, capability-checked, audited links.
- Existing records are preserved and reviewed; migrations do not silently rewrite prior legal or approval evidence.
- Every meaningful change receives a targeted unit, migration-contract, browser, or generated-document verification.

---

### Task 1: Replace Unsupported Procurement Policy Assumptions

**Files:**
- Modify: `modules/procurement/src/types.ts`
- Modify: `modules/procurement/src/policy.ts`
- Modify: `modules/procurement/src/policy.test.ts`
- Modify: `modules/procurement/src/tiers.ts`
- Test: `modules/procurement/src/tiers.test.ts`

**Interfaces:**
- Produces: `deriveSourcingRecommendation(input): SourcingRecommendation`, `evaluateSourcingReadiness(input): SourcingReadiness`, and a fail-closed `DoaResolution`.
- Consumes: request amount/category/risk flags and an optional approved DOA assignment.

- [ ] **Step 1: Write failing boundary and unsupported-rule tests**

```ts
expect(deriveSourcingRecommendation({ amount: 999_999.99, comparable: true }).method).toBe('rfq');
expect(deriveSourcingRecommendation({ amount: 1_000_000, comparable: true }).method).toBe('rfp');
expect(deriveSourcingRecommendation({ amount: 10_000, dataSensitive: true }).method).toBe('rfp');
expect(evaluateSourcingReadiness({ method: 'rfq', responses: 1 }).quoteShortfall).toBeUndefined();
expect(resolveDoaAssignment([], 500_000).status).toBe('policy_decision_required');
```

- [ ] **Step 2: Run `pnpm --filter @intra/procurement test -- policy.test.ts tiers.test.ts` and confirm the new tests fail against hard-coded thresholds/quorums.**
- [ ] **Step 3: Remove `PETTY_CASH_MAX`, `SMALL_PURCHASE_MAX`, `FINANCE_TIER_MIN`, fixed `DOA_BANDS`, and fixed `minimumQuotes`; preserve petty cash only as an explicitly Finance-confirmed exception.**
- [ ] **Step 4: Add structured route reasons (`amount_threshold`, `complex`, `technical`, `strategic`, `high_risk`, `data_sensitive`, `emergency`, `repeat_continuity`, `direct_award`) and insufficient-bid evidence without a fabricated minimum count.**
- [ ] **Step 5: Run Procurement tests, typecheck, and lint; commit `fix(procurement): enforce sourced routing policy`.**

### Task 2: Encode Vendor Accreditation v.2025 As A Versioned Definition

**Files:**
- Create: `modules/legal/src/requirements/vendorAccreditationV2025.ts`
- Create: `modules/legal/src/requirements/vendorAccreditationV2025.test.ts`
- Modify: `modules/legal/src/requirements/catalog.ts`
- Modify: `modules/legal/src/requirements/policy.ts`
- Modify: `modules/legal/src/types.ts`

**Interfaces:**
- Produces: `VENDOR_ACCREDITATION_V2025`, `buildV2025Checklist(entityType)`, `validateV2025Application(application)`.
- Produces structured `VendorApplicationSnapshot` and `TechnologyQualification` types.

- [ ] **Step 1: Write failing tests for sole proprietor, partnership, corporation, foreign-equivalent, N/A reason, and technology-pool applicability.**

```ts
const corporation = buildV2025Checklist('corporation');
expect(corporation.map((item) => item.code)).toEqual(expect.arrayContaining([
  'PH_SEC_REG_ARTICLES_BYLAWS', 'PH_BIR_2303', 'PH_AFS_3Y',
  'PH_SECRETARY_CERT', 'PH_GIS', 'PH_MAYORS_PERMIT', 'SIGN_NDA',
]));
expect(validateV2025Application({ ...validApplication, declarationAccepted: false }).ok).toBe(false);
```

- [ ] **Step 2: Run the focused Legal test and confirm missing definitions fail.**
- [ ] **Step 3: Implement exact v.2025 company/manpower fields, entity checklists, technology pools, declaration text/version, and reviewer-controlled foreign-equivalent/N/A dispositions.**
- [ ] **Step 4: Change extra catalog evidence to non-blocking unless it carries an explicit source/applicability/owner rule; retain risk guidance without silently deleting it.**
- [ ] **Step 5: Run Legal tests, typecheck, and lint; commit `feat(legal): encode vendor accreditation v2025`.**

### Task 3: Replace The Technology MNDA With A Governed Clean Master

**Files:**
- Modify: `modules/legal/src/requirements/instruments.ts`
- Create: `modules/legal/src/requirements/mndaTechnologyV2026.test.ts`
- Modify: `modules/legal/src/types.ts`
- Modify: `modules/legal/src/localStore.ts`
- Modify: `modules/legal/src/pages/SignInstrumentPage.tsx`

**Interfaces:**
- Produces: `generateTechnologyMnda(fields): GeneratedInstrument` containing `templateVersion`, canonical clauses, rendered text, and SHA-256 hash.
- Produces two-party `InstrumentSignature` records and `InstrumentLifecycleEvent` records.

- [ ] **Step 1: Write golden tests asserting party placeholders, two-year/definitive-agreement condition, five-business-day return/destruction, Data Privacy Act clause, PDRCI/three-arbitrator/Makati/English terms, and absence of `NCS PHILIPPINES`, five-year survival, and exclusive-court text.**
- [ ] **Step 2: Run the focused test and confirm the current template fails.**
- [ ] **Step 3: Implement the cleaned template without changing supplied substantive clauses; capture execution date, company/address/notices, transaction purpose, both signatories, template version, and document hash.**
- [ ] **Step 4: Require vendor signature and MPHTC countersignature on the same hash; create lifecycle events for definitive agreement, expiry/termination, return/destruction due date, completion evidence, and retention exception basis.**
- [ ] **Step 5: Verify generated content by test and rendered signing page on desktop/mobile; commit `fix(legal): govern technology MNDA lifecycle`.**

### Task 4: Add Authoritative Policy Schema And RLS

**Files:**
- Create: `supabase/migrations/20260710210000_policy_aligned_legal_procurement.sql`
- Create: `scripts/verify-policy-alignment-schema.mjs`
- Modify: `package.json`
- Test: `scripts/verify-policy-alignment-schema.mjs`

**Interfaces:**
- Produces versioned policy definitions/snapshots, vendor applications/qualifications/declarations, checklist dispositions, instrument documents/signatures/lifecycle, procurement route decisions, sourcing events/responses, exception packs, DOA matrices/assignments, protection requirements, acceptance packs, payment-readiness packs, and audit references.
- Consumes existing `core.vendors`, `legal.accreditation_cases`, `procurement.requests`, `procurement.purchase_orders`, and Warehouse receipt references.

- [ ] **Step 1: Write a failing static verifier that checks required tables/columns/checks, forced RLS, explicit grants, private `SECURITY DEFINER` implementations, safe `search_path`, and revoked anonymous/public execution.**
- [ ] **Step 2: Run `node scripts/verify-policy-alignment-schema.mjs` and confirm it fails before the migration exists.**
- [ ] **Step 3: Add additive schema and immutable snapshot/hash constraints; mark incompatible open records `policy_review_required` through an auditable remediation queue instead of rewriting evidence.**
- [ ] **Step 4: Add least-privilege RLS and controlled RPC boundaries for vendor submission, Legal/VMO review, Procurement route confirmation, DOA approval, acceptance, and Finance readiness.**
- [ ] **Step 5: Run the verifier plus existing Supabase/procurement contract verifiers; commit `feat(db): add policy aligned workflow contract`.**

### Task 5: Build Vendor Application And Legal Review UI

**Files:**
- Create: `modules/legal/src/pages/VendorApplicationPage.tsx`
- Create: `modules/legal/src/components/TechnologyQualificationForm.tsx`
- Create: `modules/legal/src/components/AccreditationDeclaration.tsx`
- Modify: `modules/legal/src/pages/CaseDetailPage.tsx`
- Modify: `modules/legal/src/LegalApp.tsx`
- Modify: `apps/shell/app/vendor/[[...slug]]/page.tsx`
- Test: `apps/shell/tests/e2e/policy-vendor-legal.spec.ts`

**Interfaces:**
- Consumes Task 2 definitions and Task 4 RPCs.
- Produces structured draft/save/submit, immutable signed snapshot, per-item review/disposition, and accreditation/temporary-clearance decisions.

- [ ] **Step 1: Add browser tests for all three entity types, technology/non-technology branching, N/A reason, correction/replacement history, declaration/signature, wrong-vendor denial, and approval blocked by unresolved mandatory evidence.**
- [ ] **Step 2: Run the spec and confirm missing routes/controls fail.**
- [ ] **Step 3: Implement responsive form sections with persistent progress, private uploads, explicit correction states, declaration review, and no dead-end submission state.**
- [ ] **Step 4: Implement Legal/VMO queue ownership, temporary clearance conditions/follow-up, and accreditation decision with scoped effective/expiry data.**
- [ ] **Step 5: Run desktop 1440x900 and mobile 390x844/320x720 browser checks, accessibility scan, focused module tests, typecheck, and lint; commit `feat(legal): add policy aligned accreditation workflow`.**

### Task 6: Build Procurement Route, Exception, Evaluation, And DOA Workflow

**Files:**
- Modify: `modules/procurement/src/pages/CreateRequestPage.tsx`
- Modify: `modules/procurement/src/pages/RequestDetailPage.tsx`
- Create: `modules/procurement/src/components/SourcingDecisionPanel.tsx`
- Create: `modules/procurement/src/components/ExceptionPack.tsx`
- Create: `modules/procurement/src/components/EvaluationMatrix.tsx`
- Create: `modules/procurement/src/components/FinancialProtectionPanel.tsx`
- Modify: `modules/procurement/src/localStore.ts`
- Test: `apps/shell/tests/e2e/policy-procurement.spec.ts`

**Interfaces:**
- Consumes Tasks 1 and 4 policy/RPC interfaces and authoritative accreditation state.
- Produces confirmed route, bid communications/responses, insufficient-bid record, Direct Award/emergency/repeat/petty-cash/importation packs, evaluation, AR, protection requirements, and DOA steps.

- [ ] **Step 1: Add browser tests for PHP 999,999.99/PHP 1,000,000, data-sensitive low value, requester unable to self-confirm route, Direct Award evidence, emergency retrospective evidence, petty-cash Finance confirmation/no-split attestation, and importation without automatic RFP.**
- [ ] **Step 2: Run the spec and confirm it fails.**
- [ ] **Step 3: Implement complete intake, Procurement route confirmation, sourcing event/response tracking, shared clarifications, evaluation/AR, and structured exception packs.**
- [ ] **Step 4: Implement matrix-backed named approvers, active-step authorization, self-approval prevention, stale-version rejection, and material-change reapproval.**
- [ ] **Step 5: Implement financial-protection decisions and launch blockers for missing DOA/policy authority; verify unit/browser/mobile/desktop and commit `feat(procurement): enforce policy workflow`.**

### Task 7: Connect PO, Warehouse Acceptance, And Finance Payment Readiness

**Files:**
- Modify: `modules/procurement/src/pages/PODetailPage.tsx`
- Modify: `modules/procurement/src/receiving.ts`
- Modify: `modules/warehouse/src/data/procurementBridge.ts`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.tsx`
- Test: `modules/warehouse/src/data/procurementBridge.test.ts`
- Test: `modules/warehouse/src/pages/PurchaseOrdersPage.test.tsx`
- Create: `modules/procurement/src/components/PaymentReadinessPanel.tsx`
- Test: `apps/shell/tests/e2e/policy-payment-readiness.spec.ts`

**Interfaces:**
- Consumes canonical PO, Warehouse receipt/quality records, requester acceptance, invoice/OR/SI, tax/withholding, and Finance decision.
- Produces append-only acceptance/payment-readiness/claim/closure state and Command Center tasks.

- [ ] **Step 1: Add failing E2E tests proving PO issuance requires eligible accreditation/clearance and approved award; Warehouse sees one canonical PO; payment blocks without acceptance, invoice/OR/SI, PO match, milestone, and tax support.**
- [ ] **Step 2: Implement canonical references and requester technical acceptance for goods and services.**
- [ ] **Step 3: Implement Procurement readiness review, Finance return/accept/release status, petty-cash liquidation, and material mismatch correction lineage.**
- [ ] **Step 4: Add warranty/open-issue/claim closure and Legal/Finance escalation events without deleting transaction history.**
- [ ] **Step 5: Run cross-role desktop/mobile E2E and persistence read-back; commit `feat(procurement): complete payment readiness handoff`.**

### Task 8: Migrate Open Records And Update Operational Documentation

**Files:**
- Create: `scripts/migrate-policy-review-records.mjs`
- Create: `docs/runbooks/POLICY-ALIGNMENT-CUTOVER.md`
- Modify: `docs/runbooks/PRODUCTION-CUTOVER.md`
- Modify: `docs/TRACEABILITY-MATRIX.md`

**Interfaces:**
- Consumes Task 4 remediation queue.
- Produces dry-run report, explicit review actions, rollback/freeze criteria, and source-to-test traceability.

- [ ] **Step 1: Add fixture tests proving drafts/open cases are queued while completed signed evidence remains immutable.**
- [ ] **Step 2: Implement dry-run-only default, run-ID tagging, counts by mismatch type, and explicit `--apply --test-project` guard.**
- [ ] **Step 3: Document Legal clean-master approval, active DOA/Finance matrix loading, reviewer ownership, cutover, rollback, and hypercare.**
- [ ] **Step 4: Run dry-run against fixtures and verify report totals; commit `docs: add policy alignment cutover controls`.**

### Task 9: Full Policy-Aligned Release Verification

**Files:**
- Create: `apps/shell/tests/e2e/policy-aligned-launch.spec.ts`
- Create: `scripts/qa/policy-aligned-live-e2e.mjs`
- Modify: `docs/TRACEABILITY-MATRIX.md`

**Interfaces:**
- Consumes every prior task.
- Produces local and designated-test-project evidence for each persona, transition, denial, persistence, visual viewport, and database read-back.

- [ ] **Step 1: Build persona/workflow matrices covering Vendor, Legal/VMO, Requester, Department Reviewer, Procurement, Finance, Legal Approver, Final DOA Approver, Warehouse Receiver/Quality/Supervisor, and Platform Admin without department authority.**
- [ ] **Step 2: Run unit, lint, typecheck, migration verifiers, production build, dependency audit, and all policy E2E suites.**
- [ ] **Step 3: Run three visual crawls at 1440x900, 1280x800, 768x1024, 390x844, 360x800, and 320x720 in light/dark where applicable; inspect overlap, reachability, truncation, contrast, keyboard/focus, loading/error/empty/denied/conflict states.**
- [ ] **Step 4: Run designated Supabase test-project mutations with run IDs; verify authorized writes, wrong-role/wrong-vendor denial, fresh-session read-back, audit evidence, idempotency, and governed reversal/cleanup.**
- [ ] **Step 5: Record defects and rerun failed matrices until zero P0/P1; commit `test: verify policy aligned launch flow`.**
