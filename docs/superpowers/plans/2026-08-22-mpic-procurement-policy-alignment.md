# MPIC Procurement Policy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Mwell Intra procurement-to-payment behavior with the supplied February 2025 MPIC procurement policy while preserving Mwell's effective DOA, separating solicitation document from procurement mode and governance tier, and making every exception, SLA, handoff, and evidence gate operable and auditable.

**Architecture:** Introduce a versioned procurement policy profile as the single source for numeric controls and activation state. Client and Supabase share a three-axis route model: solicitation (`rfq`, `rfp`, `none`), procurement mode, and governance tier; existing `sourcing_method` remains a compatibility projection during backfill. Database RPCs recompute and enforce controls, while React surfaces explainable decisions, deadlines, evidence, failed-bid recovery, PO monitoring, vendor probation, and Finance readiness.

**Tech Stack:** TypeScript 5.6, React 19, Vitest 3, Next.js shell, Supabase Auth/PostgreSQL/RLS/security-definer RPCs, SQL migrations, Node.js contract verifiers, Playwright 1.51.

**Spec:** `docs/superpowers/specs/2026-08-22-standalone-handbook-tabbed-experience-design.md` section “Governing procurement source and alignment”

## Global Constraints

- `MPIC Procurement Policy February2025.docx` is a parent governance source; it does not silently replace Mwell's active operating policy or DOA.
- Goods/material requirements use RFQ; service requirements use RFP; approved exception modes use solicitation `none` unless a policy owner requires a supporting solicitation.
- PHP 1,000,000 affects formal-bid governance under the current Mwell operating policy and does not convert goods from RFQ to RFP.
- MPIC numeric values are source-policy defaults until an authorized Mwell policy profile activates or overrides them.
- Admin or Legal users with the existing `manage_doa`/policy capability may create and activate effective-dated profiles; requesters cannot modify policy values.
- Current department DOA stays effective-dated, department-scoped, and authoritative for approval assignment.
- Competitive sourcing targets three to four accredited vendors; sealed-bid opening requires three usable responses or an approved insufficient-bids path.
- Security-definer functions use `set search_path = ''`, explicit authorization, row locking for transitions, restricted grants, and immutable audit events.
- Existing UAT requests and POs remain readable; backfill is deterministic and records its mapping basis.
- No UI-only control authorizes a live transition; server-side predicates recompute route and readiness.
- Every live E2E test creates uniquely prefixed UAT data and deletes or archives it in a `finally` cleanup path.
- Documentation and the generated standalone handbook update in the same release as behavior changes.

## File Structure

- `modules/procurement/src/types.ts`: route axes, effective policy profile, evidence, SLA, probation, and compatibility types.
- `modules/procurement/src/policyProfile.ts`: default source profile, parsing, effective profile selection, and labels.
- `modules/procurement/src/policyRoute.ts`: pure route derivation and exception eligibility.
- `modules/procurement/src/policy.ts`: approval, document, commitment, and payment readiness using the new route model.
- `modules/procurement/src/policyProfile.test.ts`, `policyRoute.test.ts`, `policy.test.ts`: domain contracts.
- `modules/procurement/src/localStore.ts`, `seed.ts`: camelCase mapping and deterministic compatibility fixtures.
- `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`: profile schema, route columns, SLA/evidence records, probation records, backfill, RLS, and governed RPCs.
- `scripts/verify-mpic-procurement-policy-alignment.mjs`: effective SQL/security contract verifier.
- `scripts/verify-mpic-procurement-policy-alignment.test.mjs`: verifier regression tests.
- `apps/shell/app/admin/doa/PolicyProfileSection.tsx`: authorized profile editor, source mapping, conflict decision, and activation status.
- `apps/shell/app/admin/doa/PolicyProfileSection.test.tsx`: Admin/Legal maker-checker and conflict presentation contract.
- `modules/procurement/src/components/ProcurementRoutePanel.tsx`: three-axis decision presentation.
- `modules/procurement/src/components/EvaluationMatrix.tsx`: invitation, response, failed-bid, and variance controls.
- `modules/procurement/src/components/SourcingWorkspace.tsx`: equal communication, deadlines, SLA, and award flow.
- `modules/procurement/src/components/CommitmentReadinessPanel.tsx`: PO pack and acknowledgment/monitoring status.
- `modules/procurement/src/components/PaymentReadinessPanel.tsx`: invoice/PO/acceptance/tax evidence explanation.
- `modules/procurement/src/pages/CreateRequestPage.tsx`, `RequestDetailPage.tsx`, `PODetailPage.tsx`: end-to-end operator surfaces.
- `modules/legal/src/components/VendorLifecyclePanel.tsx`: probation scorecard, review decision, and vendor eligibility projection.
- `modules/legal/src/components/VendorLifecyclePanel.test.tsx`: Legal lifecycle and Procurement eligibility contract.
- `apps/shell/tests/e2e/policy-procurement.spec.ts`: memory-mode functional and negative tests.
- `apps/shell/tests/e2e/policy-payment-readiness.spec.ts`: Finance evidence and variance tests.
- `apps/shell/tests/e2e/policy-mpic-alignment-live.spec.ts`: governed UAT database certification.
- `docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md`: maintained source extract and Mwell mapping.
- `docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md`: updated active controls.
- `docs/PROCESS_REFERENCE_LIBRARY.md`: 14-stage flow and decision trees.
- `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md`: domain, schema, RPC, and role behavior.
- `docs/TRAINING_AND_HANDOVER_CONTENT.md`, `docs/manual/MWELL_INTRA_USER_MANUAL.md`: role procedures and recovery paths.
- `docs/releases/2026-08-22-MPIC-PROCUREMENT-POLICY-ALIGNMENT.md`: release evidence and activation notes.

---

### Task 1: Three-Axis Procurement Domain Model

**Files:**
- Modify: `modules/procurement/src/types.ts`
- Create: `modules/procurement/src/policyProfile.ts`
- Create: `modules/procurement/src/policyProfile.test.ts`
- Modify: `modules/procurement/src/index.ts`

**Interfaces:**
- Produces: `SolicitationType`, `ProcurementMode`, `GovernanceTier`, `ProcurementRoute`, `ProcurementPolicyProfile`.
- Produces: `MPIC_SOURCE_PROFILE`, `MWELL_OPERATING_PROFILE`, `validatePolicyProfile()`, `selectEffectivePolicyProfile()`.
- Preserves: `SourcingMethod` as a deprecated compatibility projection until Task 4 completes backfill.

- [ ] **Step 1: Write failing profile tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  MPIC_SOURCE_PROFILE,
  MWELL_OPERATING_PROFILE,
  selectEffectivePolicyProfile,
  validatePolicyProfile,
} from './policyProfile';

describe('procurement policy profile', () => {
  it('retains exact February 2025 source-policy values', () => {
    expect(MPIC_SOURCE_PROFILE.controls).toMatchObject({
      inviteTargetMin: 3,
      inviteTargetMax: 4,
      sealedBidMinimumResponses: 3,
      bidWindowWorkingDays: 7,
      maxExtensionWorkingDays: 7,
      vendorAcknowledgementHours: 24,
      clarificationHours: 48,
      tabulationHours: 48,
      technicalEvaluationWorkingDays: 5,
      poAcknowledgementHours: 48,
      repeatOrderMaxAmount: 250_000,
      repeatOrderMaxAgeDays: 365,
      pettyCashMaxAmount: 2_000,
      poInvoiceThreshold: 50_000,
      vendorProbationMonths: 6,
    });
  });

  it('selects the latest active profile effective on the transaction date', () => {
    const selected = selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, id: 'old', effectiveFrom: '2025-01-01', status: 'superseded' },
      { ...MWELL_OPERATING_PROFILE, id: 'active', effectiveFrom: '2026-08-01', status: 'active' },
    ], '2026-08-22');
    expect(selected.id).toBe('active');
  });

  it('rejects an invite maximum below its minimum', () => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      controls: { ...MWELL_OPERATING_PROFILE.controls, inviteTargetMin: 4, inviteTargetMax: 3 },
    })).toThrow(/invite target/i);
  });
});
```

- [ ] **Step 2: Run and verify the missing module failure**

Run: `pnpm --filter @intra/procurement test -- policyProfile.test.ts`

Expected: FAIL because `policyProfile.ts` does not exist.

- [ ] **Step 3: Add exact domain types**

```ts
export type SolicitationType = 'rfq' | 'rfp' | 'none';
export type RequirementKind = 'materials' | 'services';
export type ProcurementMode =
  | 'competitive_bidding'
  | 'sole_source'
  | 'repeat_order'
  | 'emergency_purchase'
  | 'petty_cash'
  | 'approved_exception';
export type GovernanceTier = 'standard' | 'formal_bid' | 'high_risk';

export interface ProcurementRoute {
  solicitationType: SolicitationType;
  procurementMode: ProcurementMode;
  governanceTier: GovernanceTier;
  policyProfileId: string;
  reasons: string[];
  confirmedAt?: string;
  confirmedByEmail?: string;
}

export interface ProcurementPolicyControls {
  formalBidAmount: number | null;
  inviteTargetMin: number;
  inviteTargetMax: number;
  sealedBidMinimumResponses: number;
  bidWindowWorkingDays: number;
  maxExtensionWorkingDays: number;
  vendorAcknowledgementHours: number;
  clarificationHours: number;
  tabulationHours: number;
  technicalEvaluationWorkingDays: number;
  poAcknowledgementHours: number;
  repeatOrderMaxAmount: number;
  repeatOrderMaxAgeDays: number;
  pettyCashMaxAmount: number;
  poInvoiceThreshold: number;
  vendorProbationMonths: number;
}

export interface ProcurementPolicyProfile {
  id: string;
  code: string;
  version: string;
  name: string;
  sourceFilename: string;
  sourceOrganization: string;
  relationship: 'parent_source' | 'mwell_operating';
  inheritedFromProfileId?: string;
  controlSources: Partial<Record<keyof ProcurementPolicyControls, string>>;
  status: 'draft' | 'active' | 'superseded' | 'suspended';
  effectiveFrom: string;
  effectiveTo?: string;
  controls: ProcurementPolicyControls;
}
```

Add `requirementKind?: RequirementKind` and `route?: ProcurementRoute` to `ProcurementRequest`. Keep `sourcingMethod?: SourcingMethod` with a deprecation comment stating that it is read-only compatibility data after backfill.

- [ ] **Step 4: Implement profile validation and selection**

Create `MPIC_SOURCE_PROFILE` with the exact values in the test, `formalBidAmount: null`, relationship `parent_source`, and status `draft`; the February 2025 source does not establish Mwell's PHP 1,000,000 formal-bid boundary. Create `MWELL_OPERATING_PROFILE` with `formalBidAmount: 1_000_000`, relationship `mwell_operating`, `inheritedFromProfileId: MPIC_SOURCE_PROFILE.id`, and all inherited MPIC values explicitly labeled by source. Validation requires non-negative non-null values, `inviteTargetMin <= inviteTargetMax`, `sealedBidMinimumResponses <= inviteTargetMax`, valid effective dates, and an exact source filename. Selection considers only active Mwell operating profiles effective on the transaction date and throws when none or overlapping profiles exist.

- [ ] **Step 5: Run module tests and typecheck**

Run: `pnpm --filter @intra/procurement test -- policyProfile.test.ts && pnpm --filter @intra/procurement typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/procurement/src/types.ts modules/procurement/src/policyProfile.ts modules/procurement/src/policyProfile.test.ts modules/procurement/src/index.ts
git commit -m "feat(procurement): model effective policy profiles"
```

---

### Task 2: Explainable Route Derivation and Compatibility Mapping

**Files:**
- Create: `modules/procurement/src/policyRoute.ts`
- Create: `modules/procurement/src/policyRoute.test.ts`
- Modify: `modules/procurement/src/policy.ts`
- Modify: `modules/procurement/src/policy.test.ts`
- Modify: `modules/procurement/src/index.ts`

**Interfaces:**
- Produces: `deriveProcurementRoute(input: ProcurementRouteInput, profile: ProcurementPolicyProfile): ProcurementRouteRecommendation`.
- Produces: `legacySourcingMethod(route: ProcurementRoute): SourcingMethod`.
- Produces: `routeFromLegacy(method, category, amount, profile): ProcurementRoute` for deterministic old-record reads.

- [ ] **Step 1: Write the route matrix tests**

```ts
import { describe, expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import { deriveProcurementRoute } from './policyRoute';

describe('three-axis procurement routing', () => {
  it.each([
    ['low-value material', { requirementKind: 'materials', category: 'goods', amount: 50_000 }, 'rfq', 'competitive_bidding', 'standard'],
    ['high-value material', { requirementKind: 'materials', category: 'goods', amount: 1_500_000 }, 'rfq', 'competitive_bidding', 'formal_bid'],
    ['low-value service', { requirementKind: 'services', category: 'services', amount: 50_000 }, 'rfp', 'competitive_bidding', 'standard'],
    ['high-risk service', { requirementKind: 'services', category: 'services', amount: 50_000, highRisk: true }, 'rfp', 'competitive_bidding', 'high_risk'],
  ] as const)('%s', (_name, input, solicitationType, procurementMode, governanceTier) => {
    expect(deriveProcurementRoute(input, MWELL_OPERATING_PROFILE).route).toMatchObject({
      solicitationType, procurementMode, governanceTier,
    });
  });

  it('routes an approved sole-source request without changing its goods classification', () => {
    expect(deriveProcurementRoute({
      requirementKind: 'materials', category: 'goods', amount: 80_000, requestedMode: 'sole_source',
    }, MWELL_OPERATING_PROFILE).route).toMatchObject({
      solicitationType: 'none', procurementMode: 'sole_source', governanceTier: 'standard',
    });
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- policyRoute.test.ts`

Expected: FAIL because `deriveProcurementRoute` does not exist.

- [ ] **Step 3: Implement route derivation**

```ts
export interface ProcurementRouteInput {
  requirementKind: RequirementKind;
  category?: RequestCategory;
  amount?: number;
  requestedMode?: ProcurementMode;
  complex?: boolean;
  technical?: boolean;
  strategic?: boolean;
  highRisk?: boolean;
  dataSensitive?: boolean;
  importation?: boolean;
}

export interface ProcurementRouteRecommendation {
  route: ProcurementRoute;
  requiresProcurementConfirmation: boolean;
}

export function deriveProcurementRoute(
  input: ProcurementRouteInput,
  profile: ProcurementPolicyProfile,
): ProcurementRouteRecommendation {
  const mode = input.requestedMode ?? 'competitive_bidding';
  const special = Boolean(input.complex || input.technical || input.strategic || input.highRisk || input.dataSensitive);
  const formalBidAmount = profile.controls.formalBidAmount;
  if (formalBidAmount === null) throw new Error('An active Mwell formal-bid threshold is required.');
  const governanceTier = special
    ? 'high_risk'
    : (input.amount ?? 0) >= formalBidAmount ? 'formal_bid' : 'standard';
  const solicitationType = mode === 'competitive_bidding'
    ? input.requirementKind === 'services' ? 'rfp' : 'rfq'
    : 'none';
  return {
    route: {
      solicitationType, procurementMode: mode, governanceTier,
      policyProfileId: profile.id,
      reasons: [input.requirementKind === 'services' ? 'service_requirement' : 'material_requirement', `mode:${mode}`, `tier:${governanceTier}`],
    },
    requiresProcurementConfirmation: true,
  };
}
```

Require `requirementKind` for every new request. For legacy mapping only, infer it from unambiguous categories and place ambiguous `marketing`, `medical`, `capex`, and `other` records in remediation review; live request routing never guesses from category.

- [ ] **Step 4: Replace amount-based tests and retain compatibility functions**

Remove assertions that PHP 1,000,000 converts goods to RFP. Keep `deriveSourcingRecommendation()` and `suggestSourcingMethod()` as wrappers over `deriveProcurementRoute()` until all callers migrate; mark them deprecated and test their deterministic projection.

- [ ] **Step 5: Run policy suite**

Run: `pnpm --filter @intra/procurement test -- policyRoute.test.ts policy.test.ts && pnpm --filter @intra/procurement typecheck`

Expected: PASS with no amount-based RFQ/RFP assertion remaining.

- [ ] **Step 6: Commit**

```bash
git add modules/procurement/src/policyRoute.ts modules/procurement/src/policyRoute.test.ts modules/procurement/src/policy.ts modules/procurement/src/policy.test.ts modules/procurement/src/index.ts
git commit -m "fix(procurement): separate solicitation from governance"
```

---

### Task 3: Effective-Dated Policy Schema, Route Columns, and RLS

**Files:**
- Create: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`
- Create: `scripts/verify-mpic-procurement-policy-alignment.mjs`
- Create: `scripts/verify-mpic-procurement-policy-alignment.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Tables: `procurement.policy_profiles`, `procurement.policy_profile_events`, `procurement.policy_conflicts`, `procurement.solicitation_communications`, `procurement.policy_sla_events`, `legal.vendor_probation_reviews`.
- Request columns: `requirement_kind`, `solicitation_type`, `procurement_mode`, `governance_tier`, `policy_profile_id`, `route_reasons`.
- RPCs: `procurement.save_policy_profile(payload jsonb)`, `procurement.activate_policy_profile(payload jsonb)`, `procurement.get_effective_policy_profile(as_of timestamptz)`.

- [ ] **Step 1: Write the failing SQL contract verifier**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMigrationText } from './verify-mpic-procurement-policy-alignment.mjs';

test('requires profile, route, RLS, and hardened RPC controls', () => {
  const result = verifyMigrationText('');
  assert.ok(result.failures.includes('missing procurement.policy_profiles'));
  assert.ok(result.failures.includes('missing solicitation_type'));
  assert.ok(result.failures.includes('missing empty search_path'));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/verify-mpic-procurement-policy-alignment.test.mjs`

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Create the migration schema**

Use constrained text values rather than PostgreSQL enums so future policy values can migrate without enum surgery. The profile table stores all exact controls as columns, `control_sources jsonb`, `source_filename`, `source_organization`, relationship, effective dates, status, document hash, created/activated actor, and timestamps. `procurement.policy_conflicts` records parent rule, local rule, impact, status, chosen mapping, rationale, resolver, and resolution time. Add an exclusion or activation predicate preventing overlapping active date ranges.

Add request columns as nullable, backfill in Task 4, then set required columns `not null` only after backfill. Foreign key `policy_profile_id` to the profile table. Add indexes for active profile date lookup, request route queues, SLA due queues, and probation review due dates.

- [ ] **Step 4: Add RLS and hardened profile RPCs**

Authenticated users may read active profiles. Only callers satisfying `core.has_cap('legal','manage_doa')`, `core.has_cap('admin','admin')`, or the exact existing platform-admin predicate may save/activate. `procurement.resolve_policy_conflict(payload)` requires a resolver other than the draft creator, a selected mapping, and a rationale. Activation blocks unresolved conflicts, validates all numeric relationships, locks competing active profiles, supersedes the prior profile in the same transaction, and inserts immutable `policy_profile_events`.

Every function includes:

```sql
language plpgsql
security definer
set search_path = ''
```

Revoke from `public, anon, authenticated`, then grant execute to `authenticated, service_role` only for public governed entry points.

- [ ] **Step 5: Implement the verifier**

Check table creation, forced RLS, request columns, foreign keys, effective date constraints, profile controls, capability checks, `for update`, empty search path, revokes/grants, and the absence of amount-driven `then 'rfp'` logic in the new route function.

- [ ] **Step 6: Run static schema gates**

Run: `node --test scripts/verify-mpic-procurement-policy-alignment.test.mjs && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql scripts/verify-mpic-procurement-policy-alignment.mjs scripts/verify-mpic-procurement-policy-alignment.test.mjs package.json
git commit -m "feat(db): add effective procurement policy profiles"
```

---

### Task 4: Governed Server Route Derivation and Existing-Record Backfill

**Files:**
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`
- Modify: `scripts/verify-mpic-procurement-policy-alignment.mjs`
- Modify: `modules/procurement/src/localStore.ts`
- Modify: `modules/procurement/src/seed.ts`
- Modify: `modules/procurement/src/seed.test.ts`

**Interfaces:**
- SQL: `private.policy_derive_procurement_route(request_id uuid, requested_mode text default null) returns jsonb`.
- SQL: replacement `procurement.confirm_route_decision(payload jsonb)`.
- Mapper: `mapProcurementRequest(row): ProcurementRequest` exposes `route` and legacy `sourcingMethod`.

- [ ] **Step 1: Add mapping and seed failures**

```ts
it('seeds high-value goods as RFQ under formal bidding', () => {
  const request = seedRequests().find(({ id }) => id === 'procurement-formal-goods');
  expect(request?.route).toMatchObject({
    solicitationType: 'rfq',
    procurementMode: 'competitive_bidding',
    governanceTier: 'formal_bid',
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- seed.test.ts`

Expected: FAIL because seed requests do not expose the new route.

- [ ] **Step 3: Implement SQL route derivation**

Lock the request and effective policy profile. Derive solicitation from `requirement_kind`; derive mode from the governed requested mode; derive tier from formal amount and risk facts. Return blockers when requirement kind, amount, profile, or exception evidence is missing. Persist the three axes and `route_reasons` together.

Replace `confirm_route_decision` so it ignores client-computed authority fields, validates any requested override against mode eligibility, inserts a versioned route decision containing all three axes, and updates the request atomically.

- [ ] **Step 4: Backfill old records deterministically**

Map legacy `direct_award` to `none/sole_source`, `repeat_order` to `none/repeat_order`, `emergency` to `none/emergency_purchase`, `petty_cash` to `none/petty_cash`, and competitive records to goods RFQ or services RFP from category/requirement kind. For ambiguous categories, infer from existing line/category evidence and set reason `legacy_mapping_requires_review`; add those records to `core.policy_remediation_queue` instead of silently certifying them.

- [ ] **Step 5: Update client mappers and fixtures**

Map snake_case axes into `route`. Generate compatibility `sourcingMethod` only when an old component still consumes it. Update seeds to cover all three tiers and all exception modes.

- [ ] **Step 6: Run module and SQL contract tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql scripts/verify-mpic-procurement-policy-alignment.mjs modules/procurement/src/localStore.ts modules/procurement/src/seed.ts modules/procurement/src/seed.test.ts
git commit -m "feat(procurement): enforce governed route derivation"
```

---

### Task 5: Three-Axis Request and Route User Experience

**Files:**
- Create: `modules/procurement/src/components/ProcurementRoutePanel.tsx`
- Create: `modules/procurement/src/components/ProcurementRoutePanel.test.tsx`
- Modify: `modules/procurement/src/pages/CreateRequestPage.tsx`
- Modify: `modules/procurement/src/pages/RequestDetailPage.tsx`
- Delete: `modules/procurement/src/components/SourcingDecisionPanel.tsx`
- Modify: `modules/procurement/src/requestDrafts.ts`
- Modify: `modules/procurement/src/requestDrafts.test.ts`
- Create: `apps/shell/app/admin/doa/PolicyProfileSection.tsx`
- Create: `apps/shell/app/admin/doa/PolicyProfileSection.test.tsx`
- Modify: `apps/shell/app/admin/doa/page.tsx`

**Interfaces:**
- Component props: `{ value: ProcurementRoute; recommendation: ProcurementRouteRecommendation; profile: ProcurementPolicyProfile; canConfirm: boolean; onModeChange(mode: ProcurementMode): void }`.
- Request draft persists `requirementKind`, route axes, route reasons, and policy profile ID.
- Policy profile section consumes `save_policy_profile`, `resolve_policy_conflict`, and `activate_policy_profile`; only authorized Admin/Legal users see edit actions.

- [ ] **Step 1: Write the component contract test**

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';
import { ProcurementRoutePanel } from './ProcurementRoutePanel';

it('explains high-value goods without calling them an RFP', () => {
  const value = {
    solicitationType: 'rfq' as const,
    procurementMode: 'competitive_bidding' as const,
    governanceTier: 'formal_bid' as const,
    policyProfileId: MWELL_OPERATING_PROFILE.id,
    reasons: ['material_requirement', 'tier:formal_bid'],
  };
  const html = renderToStaticMarkup(createElement(ProcurementRoutePanel, {
    value,
    recommendation: { route: value, requiresProcurementConfirmation: true },
    profile: MWELL_OPERATING_PROFILE,
    canConfirm: true,
    onModeChange: vi.fn(),
  }));
  expect(html).toContain('Request for Quotation');
  expect(html).toContain('Competitive bidding');
  expect(html).toContain('Formal bid controls');
  expect(html).not.toContain('Request for Proposal');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- ProcurementRoutePanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Build the route panel**

Display three distinct labeled rows: Solicitation document, Procurement mode, Governance tier. Show the active policy profile and reasons in a disclosure. Let Procurement choose a mode; solicitation and tier remain computed. Exception modes show evidence requirements and cannot appear as approved from a checkbox.

- [ ] **Step 4: Update request intake**

Add required Goods/materials versus Services classification, acceptance criteria, delivery/payment/shipping/validity/deadline fields required for RFQ, and scope/evaluation fields required for RFP. Keep risk facts separate. Replace every `effectiveSourcing === 'rfq'|'rfp'` branch with route-axis predicates.

- [ ] **Step 5: Update detail route confirmation**

Call the new `confirm_route_decision` payload with request version and requested mode only. Render server-returned solicitation/tier/profile/reasons. If the server returns a different result due to a profile change, show the recomputed route and require explicit confirmation.

- [ ] **Step 6: Add authorized policy-profile administration**

Add the Procurement policy section to `/admin/doa`. Present parent source, active Mwell mapping, each control's source, effective date, unresolved conflict, draft author, checker, and activation history. Use structured inputs for numeric controls, a conflict-resolution modal with required rationale, and maker-checker activation. Keep DOA assignment editing and policy-profile editing as separate panels.

- [ ] **Step 7: Run UI and type tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && pnpm --filter @intra/shell test -- PolicyProfileSection.test.tsx && pnpm --filter @intra/shell typecheck`

Expected: PASS; `rg -n "SourcingDecisionPanel" modules/procurement/src` returns no matches.

- [ ] **Step 8: Commit**

```bash
git add modules/procurement/src/components/ProcurementRoutePanel.tsx modules/procurement/src/components/ProcurementRoutePanel.test.tsx modules/procurement/src/pages/CreateRequestPage.tsx modules/procurement/src/pages/RequestDetailPage.tsx modules/procurement/src/requestDrafts.ts modules/procurement/src/requestDrafts.test.ts modules/procurement/src/components/SourcingDecisionPanel.tsx apps/shell/app/admin/doa/PolicyProfileSection.tsx apps/shell/app/admin/doa/PolicyProfileSection.test.tsx apps/shell/app/admin/doa/page.tsx
git commit -m "feat(procurement): explain solicitation mode and governance"
```

---

### Task 6: Competitive Sourcing, Equal Communications, and Failed-Bid Recovery

**Files:**
- Modify: `modules/procurement/src/components/EvaluationMatrix.tsx`
- Create: `modules/procurement/src/components/EvaluationMatrix.test.tsx`
- Modify: `modules/procurement/src/components/SourcingWorkspace.tsx`
- Create: `modules/procurement/src/components/SourcingWorkspace.test.tsx`
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`
- Modify: `modules/procurement/src/types.ts`

**Interfaces:**
- `evaluateSourcingReadiness({ route, invited, usableResponses, failedBidReason, exceptionApproved, profile })`.
- RPCs: `procurement.save_sourcing_event`, `procurement.record_solicitation_communication`, `procurement.transition_sourcing_event`.
- Event states: `draft`, `issued`, `response_closed`, `failed_bid`, `evaluation`, `awarded`, `cancelled`.

- [ ] **Step 1: Replace the incorrect quote-count test**

```ts
import { expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';
import { evaluateSourcingReadiness } from '../policy';

it('blocks sealed-bid opening below three usable responses', () => {
  expect(evaluateSourcingReadiness({
    route: {
      solicitationType: 'rfq',
      procurementMode: 'competitive_bidding',
      governanceTier: 'formal_bid',
      policyProfileId: MWELL_OPERATING_PROFILE.id,
      reasons: ['material_requirement'],
    },
    invited: 4,
    usableResponses: 2,
    profile: MWELL_OPERATING_PROFILE,
    exceptionApproved: false,
  })).toEqual({
    ready: false,
    state: 'failed_bid',
    blocker: 'Three usable responses are required before sealed-bid opening.',
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- policy.test.ts EvaluationMatrix.test.tsx SourcingWorkspace.test.tsx`

Expected: FAIL because readiness follows `intendedResponses` and the UI says no fixed count exists.

- [ ] **Step 3: Enforce invitation and response controls**

Default target to 3, permit 3 or 4, warn outside target, and block issue with fewer than 3 accredited invitees unless a pre-issue governed exception exists. Require a submission deadline at least seven working days after issue; calculate with the active profile. Block opening with fewer than 3 usable responses. Failed bid reasons are `insufficient_responses`, `non_compliant_submissions`, `all_technically_non_compliant`, or `implausible_pricing`.

- [ ] **Step 4: Add failed-bid recovery actions**

Provide Extend deadline, Source additional vendors and requote, Submit evaluation-with-fewer-than-three exception, and Cancel event. Deadline extension is at most the active profile's `maxExtensionWorkingDays` and creates equal notification records for every invitee.

- [ ] **Step 5: Add equal communication and SLA evidence**

Record package version/hash, recipient, sent/delivered/acknowledged timestamps, clarification question/answer, and notification group ID. Every clarification answer generates an identical visible communication for all invitees. Surface 24-hour acknowledgment and 48-hour clarification overdue states without changing the source record.

- [ ] **Step 6: Replace editable exception approval**

Remove the `insufficientBidsExceptionApproved` checkbox. The UI links to the existing submit/review workflow; readiness reads an approved exception pack returned by the server. Preserve submitter/approver separation.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS; `rg -n "Policy does not impose a fixed quote count" modules/procurement/src` returns no matches.

- [ ] **Step 8: Commit**

```bash
git add modules/procurement/src/components/EvaluationMatrix.tsx modules/procurement/src/components/EvaluationMatrix.test.tsx modules/procurement/src/components/SourcingWorkspace.tsx modules/procurement/src/components/SourcingWorkspace.test.tsx modules/procurement/src/policy.ts modules/procurement/src/policy.test.ts modules/procurement/src/types.ts supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql
git commit -m "feat(procurement): govern competitive sourcing and failed bids"
```

---

### Task 7: Tabulation, Technical Evaluation, Best Value, and Variance Approval

**Files:**
- Create: `modules/procurement/src/components/BestValueEvaluation.tsx`
- Create: `modules/procurement/src/components/BestValueEvaluation.test.tsx`
- Modify: `modules/procurement/src/components/SourcingWorkspace.tsx`
- Modify: `modules/procurement/src/pages/RequestDetailPage.tsx`
- Modify: `modules/procurement/src/types.ts`
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`

**Interfaces:**
- Evaluation criteria: `technicalCompliance`, `quality`, `leadTime`, `totalLifecycleCost`, `warranty`, `support`, `price`, `paymentTerms`, `training`.
- Produces: `validateAwardRecommendation(input): string[]` from `modules/procurement/src/policy.ts`.
- RPCs: `procurement.save_commercial_tabulation`, `procurement.submit_technical_evaluation`, `procurement.submit_award_recommendation`, `procurement.review_recommendation_variance`.

- [ ] **Step 1: Write best-value and variance tests**

```tsx
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateAwardRecommendation } from '../policy';

it('does not identify the lowest price as an automatic winner', () => {
  const source = readFileSync(new URL('./BestValueEvaluation.tsx', import.meta.url), 'utf8');
  expect(source).toContain('Total lifecycle cost');
  expect(source).toContain('Warranty and support');
  expect(source).not.toMatch(/automatic winner/i);
});

it('requires independent approval when the recommendation differs from evaluation', () => {
  expect(validateAwardRecommendation({
    evaluatedVendorId: 'vendor-a', recommendedVendorId: 'vendor-b', varianceJustification: '',
  })).toContain('Written variance justification is required.');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- BestValueEvaluation.test.tsx`

Expected: FAIL because the component and validator do not exist.

- [ ] **Step 3: Implement comparison and SLA models**

Create versioned commercial tabulation due within 48 hours of response closure and assigned technical evaluation due within five working days. Store score, evidence reference, comments, reviewer, due date, submission date, and escalation status. Business-day calculations use Asia/Manila dates and exclude configured holidays when available.

- [ ] **Step 4: Implement best-value recommendation**

Render the full criterion matrix and an explicit recommendation rationale. The score may rank records but never saves an award by itself. Award submit requires selected vendor, rationale, tabulation, technical evaluation, and applicable risk evidence.

- [ ] **Step 5: Implement variance approval**

When selected recommendation differs from evaluated recommendation, require written justification, Department Head approval through active DOA, and Controller/Finance decision through the existing approval capability. Persist every decision and prevent the requester from approving their own variance.

- [ ] **Step 6: Run tests and SQL verifier**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/procurement/src/components/BestValueEvaluation.tsx modules/procurement/src/components/BestValueEvaluation.test.tsx modules/procurement/src/components/SourcingWorkspace.tsx modules/procurement/src/pages/RequestDetailPage.tsx modules/procurement/src/types.ts supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql
git commit -m "feat(procurement): add best value and variance controls"
```

---

### Task 8: Parameterized Exception Eligibility

**Files:**
- Create: `modules/procurement/src/procurementExceptions.ts`
- Create: `modules/procurement/src/procurementExceptions.test.ts`
- Modify: `modules/procurement/src/policy.ts`
- Modify: `modules/procurement/src/pages/CreateRequestPage.tsx`
- Modify: `modules/procurement/src/pages/RequestDetailPage.tsx`
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`

**Interfaces:**
- `ProcurementExceptionInput` is a discriminated union keyed by `mode`.
- `evaluateProcurementException(input: ProcurementExceptionInput, profile: ProcurementPolicyProfile): { eligible: boolean; blockers: string[]; requiredEvidence: string[] }`.
- Modes: sole source, repeat order, emergency purchase, petty cash, approved exception.

- [ ] **Step 1: Write the exception eligibility matrix**

```ts
import { expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import {
  evaluateProcurementException,
  type ProcurementExceptionInput,
} from './procurementExceptions';

const repeat = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'repeat_order' }>>) => ({
  mode: 'repeat_order' as const,
  amount: 100_000,
  samePrice: true,
  sameTerms: true,
  sameVendor: true,
  sameConsiderations: true,
  priorCompetitiveAward: true,
  priorAwardAgeDays: 100,
  materialScopeChange: false,
  ...changes,
});
const petty = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'petty_cash' }>>) => ({
  mode: 'petty_cash' as const,
  amount: 1_000,
  splitPurchase: false,
  recurring: false,
  financeEligible: true,
  receiptPresent: true,
  liquidationRecorded: true,
  ...changes,
});
const emergency = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'emergency_purchase' }>>) => ({
  mode: 'emergency_purchase' as const,
  amount: 20_000,
  lifeSafetyEnvironmentOrSeriousDisruption: true,
  authorityRecorded: true,
  retrospectivePoDueAt: '2026-08-23T00:00:00Z',
  ...changes,
});
const sole = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'sole_source' }>>) => ({
  mode: 'sole_source' as const,
  amount: 20_000,
  basis: 'only_acceptable_source' as const,
  evidenceReferences: ['evidence-1'],
  priceReasonableness: 'Compared with the prior purchase and market benchmark.',
  ...changes,
});

it.each([
  ['repeat changed price', repeat({ samePrice: false }), 'Same price is required.'],
  ['repeat stale source', repeat({ priorAwardAgeDays: 366 }), 'Prior competitive source must be no older than 365 days.'],
  ['repeat over limit', repeat({ amount: 250_001 }), 'Amount exceeds the active repeat-order limit.'],
  ['petty cash split', petty({ splitPurchase: true }), 'Split purchases are not eligible for petty cash.'],
  ['petty cash over limit', petty({ amount: 2_001 }), 'Amount exceeds the active petty-cash limit.'],
  ['emergency convenience', emergency({ lifeSafetyEnvironmentOrSeriousDisruption: false }), 'A qualifying emergency basis is required.'],
  ['sole source no basis', sole({ basis: undefined }), 'An evidence-backed sole-source basis is required.'],
])('%s', (_name, input, blocker) => {
  expect(evaluateProcurementException(input, MWELL_OPERATING_PROFILE).blockers).toContain(blocker);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- procurementExceptions.test.ts`

Expected: FAIL because the exception evaluator does not exist.

- [ ] **Step 3: Implement sole-source conditions**

Accept only `only_acceptable_source`, `compatibility`, `specialization`, `unique_capability`, `manufacturer`, or `authorized_distributor`; require evidence, price reasonableness, Procurement review, and active DOA approval.

- [ ] **Step 4: Implement repeat-order conditions**

Validate same price, terms, vendor, and considerations; prior competitive award; source age within profile limit; amount within profile limit; and no material scope change. Link the prior request, event, award, and PO.

- [ ] **Step 5: Implement emergency and petty-cash conditions**

Emergency requires life/safety/environment/serious disruption basis, authority, commitment timestamp, minimized verbal commitment, and retrospective PO due date. Petty cash requires amount within profile, non-split, non-recurring, Finance eligibility, receipt/invoice, and liquidation.

- [ ] **Step 6: Enforce all conditions in SQL and UI**

Client displays the same blockers for guidance. Server recomputes from persisted evidence and current profile before route confirmation, award, and PO issue. A client boolean cannot satisfy approval.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/procurement/src/procurementExceptions.ts modules/procurement/src/procurementExceptions.test.ts modules/procurement/src/policy.ts modules/procurement/src/pages/CreateRequestPage.tsx modules/procurement/src/pages/RequestDetailPage.tsx supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql
git commit -m "feat(procurement): enforce policy exception eligibility"
```

---

### Task 9: PO Pack, Acknowledgment, Monitoring, and Quality Handoffs

**Files:**
- Create: `modules/procurement/src/components/CommitmentReadinessPanel.tsx`
- Create: `modules/procurement/src/components/CommitmentReadinessPanel.test.tsx`
- Modify: `modules/procurement/src/pages/PODetailPage.tsx`
- Modify: `modules/procurement/src/policy.ts`
- Modify: `modules/procurement/src/policy.test.ts`
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`

**Interfaces:**
- PO package evidence: approved requisition, solicitation, quotations/proposals, tabulation, technical evaluation, variance approval when applicable, accreditation, award recommendation, protection evidence.
- RPCs: `procurement.acknowledge_purchase_order`, `procurement.review_open_purchase_orders`, `procurement.record_vendor_delivery_notice`.

- [ ] **Step 1: Write commitment readiness failures**

```ts
import { expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';
import { evaluateCommitmentReadiness } from '../policy';

it('blocks PO issue when the governed package is incomplete', () => {
  const result = evaluateCommitmentReadiness({
    route: {
      solicitationType: 'rfq',
      procurementMode: 'competitive_bidding',
      governanceTier: 'formal_bid',
      policyProfileId: MWELL_OPERATING_PROFILE.id,
      reasons: ['material_requirement'],
    },
    vendorEligible: true,
    evidenceKinds: ['approved_requisition', 'rfq', 'quotation'],
    policyProfile: MWELL_OPERATING_PROFILE,
  });
  expect(result.blockers).toEqual(expect.arrayContaining([
    'Commercial tabulation is required.',
    'Award recommendation is required.',
  ]));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- policy.test.ts CommitmentReadinessPanel.test.tsx`

Expected: FAIL because required evidence is incomplete.

- [ ] **Step 3: Expand PO commitment readiness**

Compute evidence by route and exception mode. Require current approved/provisional-as-authorized accreditation, complete approval ladder, required protection, and no unresolved sourcing or variance blocker. Display each requirement, source record, owner, and recovery action.

- [ ] **Step 4: Add vendor acknowledgment and weekly monitoring**

Record delivery/sent/acknowledged timestamps and show the active 48-hour threshold. Generate weekly queue items for unacknowledged, partial, late, missing receiving report, and unresolved quality/warranty cases. Queue items include owner, due date, age, last notice, and next action.

- [ ] **Step 5: Link Warehouse/service acceptance and quality cases**

PO detail consumes the existing receipt projection and acceptance packs. Rejected/quarantined lines create vendor notice and replacement/RMA/payment-hold linkage. Service POs use service/milestone acceptance. Closure requires all accepted, cancelled with governed reason, or resolved through replacement/credit.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/procurement/src/components/CommitmentReadinessPanel.tsx modules/procurement/src/components/CommitmentReadinessPanel.test.tsx modules/procurement/src/pages/PODetailPage.tsx modules/procurement/src/policy.ts modules/procurement/src/policy.test.ts supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql
git commit -m "feat(procurement): govern PO commitment and monitoring"
```

---

### Task 10: Vendor Probation, Eligibility, and Payment Evidence

**Files:**
- Create: `modules/procurement/src/vendorEligibility.ts`
- Create: `modules/procurement/src/vendorEligibility.test.ts`
- Modify: `modules/procurement/src/components/PaymentReadinessPanel.tsx`
- Modify: `modules/procurement/src/components/PaymentReadinessPanel.test.ts`
- Modify: `modules/procurement/src/pages/PODetailPage.tsx`
- Modify: `modules/procurement/src/types.ts`
- Modify: `supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql`
- Modify: `modules/legal/src/components/VendorLifecyclePanel.tsx`
- Create: `modules/legal/src/components/VendorLifecyclePanel.test.tsx`

**Interfaces:**
- Vendor eligibility statuses: `approved`, `probation`, `provisional`, `expired`, `suspended`, `rejected`, `temporary_clearance`.
- Probation metrics: PO win rate, delivery commitment, return/rejection count, document timeliness.
- Payment threshold comes from the request's bound policy profile, not a client constant.
- Produces: `evaluateVendorEligibility(input): VendorEligibilityResult` and `evaluatePaymentEvidence(input): PaymentEvidenceResult`.

- [ ] **Step 1: Write vendor and Finance rule tests**

```ts
import { expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import { evaluatePaymentEvidence, evaluateVendorEligibility } from './vendorEligibility';

it('blocks an expired or suspended vendor from invitation and PO issue', () => {
  expect(evaluateVendorEligibility({ status: 'expired', asOf: '2026-08-22' }).eligible).toBe(false);
  expect(evaluateVendorEligibility({ status: 'suspended', asOf: '2026-08-22' }).eligible).toBe(false);
});

it('requires invoice, PO, acceptance, and tax evidence above the active threshold', () => {
  expect(evaluatePaymentEvidence({
    invoiceAmount: 50_000,
    policyProfile: MWELL_OPERATING_PROFILE,
    invoicePresent: true,
    poPresent: false,
    acceptancePresent: true,
    taxEvidencePresent: false,
  }).blockers).toEqual(expect.arrayContaining([
    'Purchase order evidence is required at or above PHP 50,000.',
    'Tax and withholding support is required.',
  ]));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @intra/procurement test -- vendorEligibility.test.ts PaymentReadinessPanel.test.ts`

Expected: FAIL because probation and active-profile threshold logic are absent.

- [ ] **Step 3: Add probation and eligibility projection**

Require completed commercial/financial review, technical review, inspection report where applicable, written pass/fail decision, certification/rejection notice, and supplier-master update before eligibility becomes approved or probationary. Create a six-month review at accreditation approval using the active profile. Measure PO win rate target 20% or above, delivery commitment 100%, zero returns/rejections, and timely document submission. Legal/VMO records pass, extend, revoke, or suspend with evidence and notice; Procurement receives a read-only eligibility projection.

- [ ] **Step 4: Add sample custody controls**

When a sample is requested, require purpose, custodian, evaluation, disposition, and a PO link when Mwell requested the test sample. Sample acceptance does not automatically accredit or award the vendor.

- [ ] **Step 5: Make payment evidence explicit**

Display itemized invoice/receipt, PO/agreement, receipt/acceptance, amount/quantity match, tax/withholding, and foreign-vendor evidence as separate rows. Use the request-bound profile threshold and label it as active Mwell or inherited source value. Invoice mismatch routes to discrepancy; no quotation or PO alone satisfies invoice evidence.

- [ ] **Step 6: Enforce server-side eligibility and payment readiness**

Update the private commitment and payment functions in the new migration so expired/suspended/rejected vendors fail, temporary clearance is scope/date checked, and payment evidence is recomputed from governed records. Preserve existing stale-evidence invalidation.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && node scripts/verify-mpic-procurement-policy-alignment.mjs && pnpm verify:procurement-contract`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/procurement/src/vendorEligibility.ts modules/procurement/src/vendorEligibility.test.ts modules/procurement/src/components/PaymentReadinessPanel.tsx modules/procurement/src/components/PaymentReadinessPanel.test.ts modules/procurement/src/pages/PODetailPage.tsx modules/procurement/src/types.ts modules/legal/src/components/VendorLifecyclePanel.tsx modules/legal/src/components/VendorLifecyclePanel.test.tsx supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql
git commit -m "feat(procurement): align vendor and payment evidence controls"
```

---

### Task 11: Maintained Policy Extract, Process Maps, and Role Instructions

**Files:**
- Create: `docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md`
- Modify: `docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md`
- Modify: `docs/PROCESS_REFERENCE_LIBRARY.md`
- Modify: `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md`
- Modify: `docs/TRAINING_AND_HANDOVER_CONTENT.md`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`
- Modify: `scripts/docs/handbook-catalog.mjs`

**Interfaces:**
- Policy extract headings: Source identity, Scope, Direct requirements, Mwell mapping, Active profile, Conflicts, Ownership, Revision procedure.
- Mermaid flow follows the exact 14-stage order in the approved spec.

- [ ] **Step 1: Add documentation integrity assertions**

Extend `scripts/docs/build-app-documentation.test.mjs`:

```js
test("includes the exact MPIC source and separates the three route axes", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /MPIC Procurement Policy February2025\.docx/);
  assert.match(html, /Solicitation document/);
  assert.match(html, /Procurement mode/);
  assert.match(html, /Governance tier/);
  assert.match(html, /three to four accredited vendors/i);
  assert.match(html, /at least three usable responses/i);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL until the maintained extract is part of the handbook source set.

- [ ] **Step 3: Write the controlled policy extract**

Transcribe requirements in plain language without long verbatim copying. State the exact source filename, organization, February 2025 period, binary authority, source-policy values, and Mwell activation status. Distinguish direct MPIC requirements, local Mwell mapping, and unresolved ownership conflicts. Do not map MPIC named approvers to Mwell authority without an activated profile/DOA decision.

- [ ] **Step 4: Correct all amount-based RFQ/RFP documentation**

Replace every statement that says RFQ below and RFP above PHP 1,000,000. Explain goods/material RFQ, service RFP, procurement mode, governance tier, and effective DOA consistently in the manual, specification, matrix, training material, and traceability matrix.

- [ ] **Step 5: Add complete Mermaid decision flows**

Add the 14-stage procurement-to-payment overview plus separate diagrams for solicitation/type classification, bid quorum and failed-bid recovery, exception eligibility, award variance, receiving/quality/RMA, and payment evidence. Diagrams must label owners, evidence, yes/no paths, blocked terminals, and recovery routes.

- [ ] **Step 6: Add role-specific procedures**

Document Requester, Department Head, Procurement Lead, Legal/Compliance, technical reviewer, Warehouse/Operations, Finance Controller, vendor representative, and Platform Admin responsibilities. For each role include start condition, permitted action, prohibited action, handoff, denial check, recovery, and completion evidence.

- [ ] **Step 7: Classify and regenerate**

Add the extract to the handbook catalog under Security & Governance with related visibility in Workflows and Architecture. Run: `pnpm docs:build && node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs && pnpm verify:app-documentation-html`.

Expected: PASS and the source appears once in the generated artifact.

- [ ] **Step 8: Commit**

```bash
git add docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md docs/PROCESS_REFERENCE_LIBRARY.md docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md docs/TRAINING_AND_HANDOVER_CONTENT.md docs/manual/MWELL_INTRA_USER_MANUAL.md docs/REQUIREMENTS_TRACEABILITY_MATRIX.md scripts/docs/handbook-catalog.mjs scripts/docs/build-app-documentation.test.mjs docs/manual/index.html
git commit -m "docs: align procurement guidance with MPIC policy"
```

---

### Task 12: Functional, Negative, Edge, Visual, and Live Certification

**Files:**
- Modify: `apps/shell/tests/e2e/policy-procurement.spec.ts`
- Modify: `apps/shell/tests/e2e/policy-payment-readiness.spec.ts`
- Create: `apps/shell/tests/e2e/policy-mpic-alignment-live.spec.ts`
- Create: `scripts/qa/mpic-procurement-live-certification.mjs`
- Create: `scripts/qa/mpic-procurement-live-certification.test.mjs`
- Create: `docs/releases/2026-08-22-MPIC-PROCUREMENT-POLICY-ALIGNMENT.md`
- Modify: `docs/runbooks/UAT-LIVE-CERTIFICATION.md`

**Interfaces:**
- Live environment: `PLAYWRIGHT_BASE_URL=https://mwell-intra-uat.vercel.app`.
- Governed credentials are read from vaulted CI variables; no password, service-role key, database URL, or access token enters source, screenshots, traces, or reports.
- Live record prefix: `UAT-MPIC-<UTC timestamp>-<scenario>`.

- [ ] **Step 1: Add the 18-scenario certification matrix**

Use `test.describe.serial` for stateful handoffs and independent browser contexts for Requester, Procurement, Legal, Warehouse/Operations, Finance, vendor, and Admin. Cover exactly:

1. Low-value material RFQ standard.
2. High-value material RFQ formal/DOA.
3. Low-value service RFP.
4. High-risk/data-sensitive service.
5. Three-to-four accredited invitations and three responses.
6. Fewer than three responses blocked as failed bid.
7. Approved insufficient-bids path.
8. Equal clarification and extension notice.
9. Tabulation and technical-review SLA success/overdue.
10. Best-value award and recommendation variance.
11. Valid/invalid sole source.
12. Valid/invalid repeat order.
13. Valid emergency and missing retrospective PO.
14. Valid petty cash and split/recurring/over-limit rejection.
15. Approved/probation/provisional/expired/suspended/temporary vendors.
16. PO pack, acknowledgment, partial/late/missing receipt.
17. Quality rejection, warranty replacement, and vendor notice.
18. Below/above threshold payment, mismatch, and foreign tax evidence.

- [ ] **Step 2: Write the live guard and cleanup contract first**

```js
test('requires an explicit UAT target and cleanup prefix', () => {
  expect(() => validateTarget({
    baseUrl: 'https://mwell-intra.vercel.app',
    allowLiveWrites: true,
  })).toThrow(/UAT target required/);
});

test('redacts secret-shaped values from certification output', () => {
  expect(redact('service_role=secret-value')).not.toContain('secret-value');
});
```

- [ ] **Step 3: Run and verify failure**

Run: `node --test scripts/qa/mpic-procurement-live-certification.test.mjs`

Expected: FAIL because the certification runner does not exist.

- [ ] **Step 4: Implement guarded live certification**

Require `ALLOW_UAT_WRITES=1`, exact UAT hostname, vaulted role credentials, and a service cleanup credential available only in CI. Create a manifest of every inserted ID. Use `try/finally`; cleanup reverses Finance, acceptance, PO, sourcing, request, and vendor test data through governed cleanup RPCs. A cleanup failure marks certification failed and prints only IDs and safe error text.

- [ ] **Step 5: Add desktop and mobile interaction coverage**

Run each operator journey at desktop 1440×900 and mobile 390×844. Add 320×720 for request intake, sourcing event, PO detail, and Finance evidence. Assert no page-level overflow, no overlap, minimum 44px touch targets for primary actions, visible focus, readable status/error copy, reachable recovery action, and no dead-end state.

- [ ] **Step 6: Run memory-mode regression before live writes**

Run: `pnpm --filter @intra/procurement test && pnpm --filter @intra/procurement typecheck && pnpm --filter @intra/shell exec playwright test tests/e2e/policy-procurement.spec.ts tests/e2e/policy-payment-readiness.spec.ts`

Expected: PASS.

- [ ] **Step 7: Apply migration to the UAT Supabase project**

Use the Supabase skill during execution. Verify the linked project ref before migration, run a schema diff, apply `20260822110000_mpic_procurement_policy_alignment.sql`, then run `pnpm verify:policy-alignment-schema`, `pnpm verify:procurement-contract`, and `node scripts/verify-mpic-procurement-policy-alignment.mjs` against the effective schema.

- [ ] **Step 8: Deploy the matching UAT application commit**

Deploy to the existing UAT Vercel project, verify the alias `https://mwell-intra-uat.vercel.app`, and confirm build identity matches the migration/release record. Do not promote to production in this task.

- [ ] **Step 9: Run live role handoffs three times**

Run the 18 scenarios once as happy/normal flow, once emphasizing negative/recovery flow, and once emphasizing edge/visual/session flow. Capture safe screenshots for Request, Route, Sourcing, Failed bid, Award, PO, Receipt/QC, and Finance at desktop and mobile. Keep secrets and personal data out of screenshots.

- [ ] **Step 10: Record release evidence**

Write the release note with commit, Vercel deployment, Supabase migration, active profile, scenario counts, browser widths, cleanup result, screenshots, residual risks, and explicit production promotion decision. Update the UAT certification runbook with profile activation and rollback steps.

- [ ] **Step 11: Regenerate handbook and run launch gates**

Run: `pnpm docs:build && pnpm verify:release-documentation && pnpm verify:launch-artifacts && git diff --check`.

Expected: PASS; generated handbook and release note identify the same application behavior and commit.

- [ ] **Step 12: Commit**

```bash
git add apps/shell/tests/e2e/policy-procurement.spec.ts apps/shell/tests/e2e/policy-payment-readiness.spec.ts apps/shell/tests/e2e/policy-mpic-alignment-live.spec.ts scripts/qa/mpic-procurement-live-certification.mjs scripts/qa/mpic-procurement-live-certification.test.mjs docs/releases/2026-08-22-MPIC-PROCUREMENT-POLICY-ALIGNMENT.md docs/runbooks/UAT-LIVE-CERTIFICATION.md docs/manual/index.html
git commit -m "test(procurement): certify MPIC-aligned UAT flows"
```

## Rollback and Activation Sequence

1. Apply additive schema and keep the current policy profile in draft.
2. Deploy the compatible application that reads both old and new route fields.
3. Run backfill and review every `legacy_mapping_requires_review` queue item.
4. Activate the Mwell operating profile through an authorized Admin or Legal account.
5. Run the 18-scenario live certification and cleanup.
6. If certification fails, suspend the new profile, restore the prior active profile, and keep additive columns/tables in place; do not destructively roll back evidence.
7. Promote only after release evidence, standalone handbook, migration identity, and Vercel build identity match.
