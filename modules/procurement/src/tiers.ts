// Approval-tier resolution — shared by the module gate (ProcurementApp), the
// approval inbox, and the shell's badge logic if it ever wants tier-scoped
// counts. Extracted from ApprovalInboxPage (UX-REVIEW-FULL-APP.md PR-11) so
// the module gate can admit tier-eligible users who hold NO procurement role
// (e.g. legal:legal_reviewer acting on the Legal ladder step).
//
// Demo profiles carry procurement / warehouse / legal roles. We map each role
// combination onto the approval tier(s) the profile can act on. This keeps
// the RBAC package untouched (see task guardrails) while letting the inbox
// filter by tier.
//
// TODO(rbac): once DOA integration lands, replace this heuristic with a
// direct lookup of `core.role_capabilities` (or a new `procurement.approver_
// tier_assignments` table) so tiers are data-driven per user.

import type { ApproverTier } from './types';

export interface UserRolesShape {
  procurement?: readonly string[];
  legal?: readonly string[];
  core?: readonly string[];
  warehouse?: readonly string[];
}

export function resolveTiers(
  userRoles: UserRolesShape | null | undefined,
): ApproverTier[] {
  if (!userRoles) return [];
  const tiers = new Set<ApproverTier>();
  const proc = userRoles.procurement ?? [];
  const legal = userRoles.legal ?? [];
  const warehouse = userRoles.warehouse ?? [];

  // procurement:approver acts as the Department Head / BU SPOC tier — the
  // first sign-off on the ladder (policy §3).
  if (proc.includes('approver')) {
    tiers.add('dept_head');
  }
  // procurement:procurement_officer → Procurement Head sourcing/AR review.
  if (proc.includes('procurement_officer')) {
    tiers.add('procurement_head');
  }
  // procurement:admin doubles as CFO / BU head / DOA final approver in the
  // demo. Also covers procurement_head so a solo admin can walk the ladder.
  if (proc.includes('admin')) {
    tiers.add('procurement_head');
    tiers.add('final_approver');
  }
  // Finance seat — dedicated procurement:finance is preferred; warehouse:
  // finance is the legacy fallback for demos that predate procurement roles.
  if (proc.includes('finance') || warehouse.includes('finance')) {
    tiers.add('finance');
  }
  // Legal reviewers pick up the contract-review tier.
  if (legal.includes('legal_reviewer')) {
    tiers.add('legal');
  }
  return Array.from(tiers);
}

/**
 * Module-gate predicate (PR-11 fix): a user may enter procurement when they
 * hold ANY procurement role (view_dashboard flows from every role) OR they
 * resolve to at least one approval tier. Tier-only entrants (e.g. Andre the
 * legal reviewer) are routed to `/approvals` and never see Requests / POs.
 */
export function canEnterProcurement(
  userRoles: UserRolesShape | null | undefined,
): boolean {
  if (!userRoles) return false;
  if ((userRoles.procurement?.length ?? 0) > 0) return true;
  return resolveTiers(userRoles).length > 0;
}
