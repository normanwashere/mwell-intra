'use client';

// useModuleBadges (T5) — cheap, read-only "live count" chips for the home
// dashboard. Reads the SAME localStorage keys the module localStores write
// (procurement v2 / legal v1) and listens for their change events, so the
// counts update without importing the modules themselves. Every read is
// guarded: missing/corrupt keys simply produce no badge.

import { useCallback, useEffect, useState } from 'react';
import type { SessionProfile } from '@intra/auth';
import type { UserRoles } from '@intra/rbac';

const PROC_REQ_KEY = 'intra.procurement.v2.requests';
const LEGAL_CASES_KEY = 'intra.legal.v1.cases';
const LEGAL_CHECKLIST_KEY = 'intra.legal.v1.checklist';
const LEGAL_DOCS_KEY = 'intra.legal.v1.docs';
const PROC_EVT = 'intra.procurement.change';
const LEGAL_EVT = 'intra.legal.change';

export interface ModuleBadge {
  /** e.g. "2 awaiting approval" */
  label: string;
  count: number;
}

/** Badges keyed by module href ("/procurement", "/legal", "/vendor"). */
export type ModuleBadges = Partial<Record<string, ModuleBadge>>;

function readRows<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

function computeBadges(
  profile: SessionProfile | null,
  userRoles: Partial<UserRoles>,
): ModuleBadges {
  const badges: ModuleBadges = {};

  // Procurement — pending approvals for approver-ish roles, in-flight
  // requests for everyone else with module access.
  const procRoles = userRoles.procurement ?? [];
  if (procRoles.length > 0) {
    const requests = readRows<{ status?: string }>(PROC_REQ_KEY);
    const inFlight = requests.filter(
      (r) => r.status === 'submitted' || r.status === 'under_review',
    ).length;
    const isApprover =
      procRoles.includes('approver') ||
      procRoles.includes('admin') ||
      procRoles.includes('finance') ||
      procRoles.includes('procurement_officer');
    if (inFlight > 0) {
      badges['/procurement'] = {
        count: inFlight,
        label: isApprover
          ? plural(inFlight, 'request') + ' awaiting approval'
          : plural(inFlight, 'request') + ' in review',
      };
    }
  }

  // Legal — cases waiting on the reviewer.
  if ((userRoles.legal ?? []).length > 0) {
    const cases = readRows<{ status?: string }>(LEGAL_CASES_KEY);
    const waiting = cases.filter(
      (c) => c.status === 'submitted' || c.status === 'under_review',
    ).length;
    if (waiting > 0) {
      badges['/legal'] = {
        count: waiting,
        label: plural(waiting, 'case') + ' waiting on you',
      };
    }
  }

  // Vendor portal — outstanding required docs on the vendor's own case(s).
  if (profile?.kind === 'vendor' && profile.vendorId) {
    const cases = readRows<{ id: string; vendorId?: string; status?: string }>(
      LEGAL_CASES_KEY,
    );
    const mine = new Set(
      cases
        .filter(
          (c) =>
            c.vendorId === profile.vendorId &&
            (c.status === 'draft' || c.status === 'submitted' || c.status === 'under_review'),
        )
        .map((c) => c.id),
    );
    if (mine.size > 0) {
      const checklist = readRows<{
        caseId: string;
        id: string;
        required?: boolean;
        decision?: string;
        documentIds?: string[];
        instrument?: boolean;
      }>(LEGAL_CHECKLIST_KEY);
      const docs = readRows<{ requirementId?: string; status?: string }>(LEGAL_DOCS_KEY);
      const outstanding = checklist.filter(
        (i) =>
          mine.has(i.caseId) &&
          i.required &&
          i.decision === 'pending' &&
          (i.documentIds?.length ?? 0) === 0 &&
          !docs.some((d) => d.requirementId === i.id && d.status !== 'rejected'),
      ).length;
      if (outstanding > 0) {
        badges['/vendor'] = {
          count: outstanding,
          label: plural(outstanding, 'document') + ' outstanding',
        };
      }
    }
  }

  return badges;
}

export function useModuleBadges(
  profile: SessionProfile | null,
  userRoles: Partial<UserRoles>,
): ModuleBadges {
  // Start empty so server + first client render match (hydration-safe);
  // populate after mount.
  const [badges, setBadges] = useState<ModuleBadges>({});

  const refresh = useCallback(() => {
    setBadges(computeBadges(profile, userRoles));
  }, [profile, userRoles]);

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener(PROC_EVT, refresh);
    window.addEventListener(LEGAL_EVT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PROC_EVT, refresh);
      window.removeEventListener(LEGAL_EVT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  return badges;
}
