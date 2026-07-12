// Cross-module accreditation bridge (demo/memory mode).
//
// Procurement's PO-award gate must reflect the REAL accreditation outcome that
// the Legal module produces — not a hard-coded vendor list. In demo mode both
// modules live in the same browser, so we read Legal's cases straight from its
// localStorage key and derive each vendor's effective accreditation status.
//
// On Supabase cutover this whole file is replaced by a shared
// `core.vendors.accreditation_status` read; the merge contract below (legal is
// source of truth; unknown-in-legal vendors keep their catalogue status) stays.
//
// Defensive by design: any parse/shape error yields an empty index, so the
// static catalogue simply passes through unchanged (and unit tests, which have
// no Legal data in localStorage, are unaffected).

import type { ProcurementVendor } from './types';

const LEGAL_CASES_KEY = 'intra.legal.v1.cases';

type AccreditationStatus = ProcurementVendor['accreditationStatus'];

interface RawLegalCase {
  vendorId: string;
  vendorName: string;
  status: AccreditationStatus;
  openedAt?: string;
  expiresAt?: string;
  category?: string;
}

interface LegalAccreditation {
  status: AccreditationStatus;
  expiresAt?: string;
  vendorId: string;
  vendorName: string;
  category?: string;
}

const norm = (s: string): string => s.trim().toLowerCase();

function readLegalCases(): RawLegalCase[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LEGAL_CASES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is RawLegalCase =>
        !!c &&
        typeof (c as RawLegalCase).vendorId === 'string' &&
        typeof (c as RawLegalCase).vendorName === 'string' &&
        typeof (c as RawLegalCase).status === 'string',
    );
  } catch {
    return [];
  }
}

/** Mirror of Legal's computeCaseStatus expiry derivation. */
function effectiveStatus(c: RawLegalCase): AccreditationStatus {
  if (c.status === 'approved' && c.expiresAt) {
    const days = (new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000;
    if (Number.isFinite(days)) {
      if (days < 0) return 'expired';
      if (days <= 30) return 'renewal_due';
    }
  }
  // Provisional clearance lapses to expired once its window passes.
  if (c.status === 'provisional' && c.expiresAt) {
    if (new Date(c.expiresAt).getTime() < Date.now()) return 'expired';
  }
  return c.status;
}

/** Latest legal case per vendor, indexed by id and by normalized name. */
function legalIndex(): {
  byId: Map<string, LegalAccreditation>;
  byName: Map<string, LegalAccreditation>;
  all: LegalAccreditation[];
} {
  const latest = new Map<string, RawLegalCase>();
  for (const c of readLegalCases()) {
    const prev = latest.get(c.vendorId);
    if (!prev || (c.openedAt ?? '') > (prev.openedAt ?? '')) {
      latest.set(c.vendorId, c);
    }
  }
  const byId = new Map<string, LegalAccreditation>();
  const byName = new Map<string, LegalAccreditation>();
  const all: LegalAccreditation[] = [];
  for (const c of latest.values()) {
    const acc: LegalAccreditation = {
      status: effectiveStatus(c),
      expiresAt: c.expiresAt,
      vendorId: c.vendorId,
      vendorName: c.vendorName,
      category: c.category,
    };
    byId.set(c.vendorId, acc);
    byName.set(norm(c.vendorName), acc);
    all.push(acc);
  }
  return { byId, byName, all };
}

/**
 * Merge the static vendor catalogue with live Legal outcomes.
 * - A vendor with a matching Legal case (by id or name) takes Legal's status.
 * - Vendors that exist only in Legal (e.g. freshly invited + accredited) are
 *   appended so their POs can be authored/awarded.
 * - With no Legal data (unit tests), the catalogue passes through unchanged.
 */
export function mergeVendorsWithLegal(
  base: readonly ProcurementVendor[],
): ProcurementVendor[] {
  const { byId, byName, all } = legalIndex();
  if (all.length === 0) return [...base];

  const merged: ProcurementVendor[] = base.map((v) => {
    const acc = byId.get(v.id) ?? byName.get(norm(v.legalName));
    if (!acc) return v;
    return {
      ...v,
      accreditationStatus: acc.status,
      accreditationExpiresAt: acc.expiresAt ?? v.accreditationExpiresAt,
    };
  });

  const knownIds = new Set(merged.map((v) => v.id));
  const knownNames = new Set(merged.map((v) => norm(v.legalName)));
  for (const acc of all) {
    if (knownIds.has(acc.vendorId) || knownNames.has(norm(acc.vendorName))) {
      continue;
    }
    merged.push({
      id: acc.vendorId,
      legalName: acc.vendorName,
      category: acc.category,
      accreditationStatus: acc.status,
      accreditationExpiresAt: acc.expiresAt,
    });
  }
  return merged;
}
