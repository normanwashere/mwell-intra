// Vendor-ownership scoping (UX-REVIEW-VENDOR-LEGAL.md F1).
//
// Pure helpers — no React, no storage — so the redirect logic on
// CaseDetailPage / SignInstrumentPage is unit-testable and later portable to
// the live adapter (where RLS remains the real boundary; this is the
// client-side render guard on top of it).

import type { AccreditationCase } from './types';

/** The slice of SessionProfile the scoping checks need. */
export interface VendorScopeProfile {
  kind: 'employee' | 'vendor';
  vendorId?: string;
  email?: string;
}

/**
 * Demo-only login bridge (F1.3): the invite flow mints `ven-<inviteId>`
 * vendors with no shell login identity, so the legal store keeps a lightweight
 * alias record (contact email → vendorId) written when the invite is created.
 * A memory-mode session whose email matches the alias is treated as that
 * vendor. NEVER a live-mode auth path — Supabase RLS + real vendor profiles
 * replace this entirely once the live adapter lands.
 */
export interface VendorLoginAlias {
  email: string;
  vendorId: string;
  companyName: string;
  createdAt: string;
}

function normEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Does this session own the case?
 *
 * Internal (employee) sessions always match — their access is gated by RBAC,
 * not vendor ownership. Vendor sessions match when:
 *   1. `profile.vendorId === kase.vendorId` (the canonical check), OR
 *   2. the session email equals the case's invite contact email, OR
 *   3. a persisted login alias maps the session email onto the case's vendor.
 * (2) and (3) are the documented demo-only bridge for invited vendors that
 * have no shell profile (see VendorLoginAlias above).
 */
export function matchesVendor(
  profile: VendorScopeProfile | null | undefined,
  kase: Pick<AccreditationCase, 'vendorId' | 'contactEmail'>,
  aliases: readonly VendorLoginAlias[] = [],
): boolean {
  if (!profile) return false;
  if (profile.kind !== 'vendor') return true;
  if (profile.vendorId && profile.vendorId === kase.vendorId) return true;
  const email = normEmail(profile.email);
  if (!email) return false;
  if (normEmail(kase.contactEmail) === email) return true;
  return aliases.some(
    (a) => normEmail(a.email) === email && a.vendorId === kase.vendorId,
  );
}

/**
 * Should the case-detail / sign route bounce this session home?
 * (F1.1 — vendors must never render another vendor's case shell.)
 */
export function shouldBlockVendorAccess(
  profile: VendorScopeProfile | null | undefined,
  kase: Pick<AccreditationCase, 'vendorId' | 'contactEmail'>,
  aliases: readonly VendorLoginAlias[] = [],
): boolean {
  if (!profile || profile.kind !== 'vendor') return false;
  return !matchesVendor(profile, kase, aliases);
}

/**
 * The cases a vendor session may see at all (list scoping). Mirrors
 * `matchesVendor` so the list and the detail guard can never disagree.
 */
export function visibleCasesForVendor<
  T extends Pick<AccreditationCase, 'vendorId' | 'contactEmail'>,
>(
  profile: VendorScopeProfile | null | undefined,
  cases: readonly T[],
  aliases: readonly VendorLoginAlias[] = [],
): T[] {
  if (!profile) return [];
  if (profile.kind !== 'vendor') return [...cases];
  return cases.filter((k) => matchesVendor(profile, k, aliases));
}
