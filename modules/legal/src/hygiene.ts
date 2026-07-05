// Demo-data hygiene (UX-REVIEW-VENDOR-LEGAL.md F1.2).
//
// The corruption pattern: automated E2E walks rebound invite-minted cases to
// the only login-able vendor id (`ven-acme`), so Acme's portal listed another
// company's case. The rule generalizes to: a case is INCONSISTENT when another
// case shares its vendorId but not its vendorName. We keep the oldest case on
// that vendorId (the legitimate owner), and quarantine the rest:
//   • when an invite exists for the case's company, reassign the case to its
//     correct `ven-<inviteId>` vendor id;
//   • otherwise drop the case (and, by caseId, its orphaned rows are simply
//     never rendered — the store keys everything by caseId).
//
// Pure + deterministic + idempotent: same input ⇒ same output, and running the
// cleanup on already-clean data changes nothing.

import type { AccreditationCase, VendorInvite } from './types';

export interface CleanupResult {
  cases: AccreditationCase[];
  /** Cases whose vendorId was rebound to their invite's `ven-<inviteId>`. */
  reassigned: AccreditationCase[];
  /** Cases dropped because no invite could re-home them. */
  dropped: AccreditationCase[];
  changed: boolean;
}

function openedAtMs(kase: AccreditationCase): number {
  const t = new Date(kase.openedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Detect + repair vendorId collisions. Deterministic: ties on `openedAt`
 * resolve by id (lexicographic) so repeated runs always pick the same keeper.
 */
export function cleanupCases(
  cases: readonly AccreditationCase[],
  invites: readonly VendorInvite[],
): CleanupResult {
  const byVendor = new Map<string, AccreditationCase[]>();
  for (const kase of cases) {
    const list = byVendor.get(kase.vendorId);
    if (list) list.push(kase);
    else byVendor.set(kase.vendorId, [kase]);
  }

  const reassignments = new Map<string, string>(); // caseId → new vendorId
  const dropIds = new Set<string>();
  const reassigned: AccreditationCase[] = [];
  const dropped: AccreditationCase[] = [];

  for (const list of byVendor.values()) {
    const names = new Set(list.map((k) => k.vendorName));
    if (names.size <= 1) continue; // consistent — nothing to do
    // Keep the oldest case (deterministic tie-break on id).
    const keeper = [...list].sort(
      (a, b) => openedAtMs(a) - openedAtMs(b) || a.id.localeCompare(b.id),
    )[0]!;
    for (const kase of list) {
      if (kase.id === keeper.id || kase.vendorName === keeper.vendorName) {
        continue;
      }
      // Newest matching invite for this company re-homes the case.
      const invite = [...invites]
        .filter((i) => i.companyName === kase.vendorName)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
            a.id.localeCompare(b.id),
        )[0];
      if (invite) {
        reassignments.set(kase.id, `ven-${invite.id}`);
        reassigned.push(kase);
      } else {
        dropIds.add(kase.id);
        dropped.push(kase);
      }
    }
  }

  if (reassignments.size === 0 && dropIds.size === 0) {
    return { cases: [...cases], reassigned, dropped, changed: false };
  }

  const next = cases
    .filter((k) => !dropIds.has(k.id))
    .map((k) => {
      const newVendorId = reassignments.get(k.id);
      return newVendorId ? { ...k, vendorId: newVendorId } : k;
    });
  return { cases: next, reassigned, dropped, changed: true };
}
