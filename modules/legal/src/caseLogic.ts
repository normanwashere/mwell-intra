// Pure accreditation-case logic (no storage, no React).
//
// Everything the localStore + pages need to derive from a case's checklist,
// documents and signed instruments lives here so it can be unit-tested in a
// plain Node environment (`caseLogic.test.ts`) and later shared with the live
// Supabase adapter unchanged.

import type {
  AccreditationCase,
  AccreditationDoc,
  CaseProgressSummary,
  InboxBucket,
  RequirementChecklistItem,
  RequirementDefinition,
  RequirementGroup,
  RequirementGroupProgress,
  SignedInstrument,
} from './types';
import { REQUIREMENT_GROUP_LABEL } from './types';
import { CATALOG_BY_CODE } from './requirements/catalog';
import {
  daysUntil,
  tailorRequirements,
  type TailoringProfile,
} from './requirements/policy';

// ---------------------------------------------------------------------------
// Catalog → checklist seeding
// ---------------------------------------------------------------------------

/** Map a catalog definition onto a persistable checklist row. */
export function checklistItemFromDefinition(
  def: RequirementDefinition,
  caseId: string,
  id: string,
): RequirementChecklistItem {
  return {
    id,
    caseId,
    code: def.code,
    requirement: def.label,
    description: def.description,
    whyWeNeedIt: def.whyWeNeedIt,
    helpUrl: def.helpUrl,
    authority: def.authority,
    evidenceFormat: def.evidenceFormat,
    group: def.group,
    required: def.required,
    instrument: def.instrument,
    instrumentCode: def.instrumentCode,
    templateVersion: def.templateVersion,
    renewsAfterMonths: def.renewsAfterMonths,
    decision: 'pending',
    documentIds: [],
  };
}

/**
 * Build the tailored checklist for a new case from the policy engine.
 * `idGen` is injected so the store can use its prefixed ids and tests can use
 * deterministic ones.
 */
export function buildTailoredChecklist(
  profile: TailoringProfile,
  caseId: string,
  idGen: () => string,
): RequirementChecklistItem[] {
  return tailorRequirements(profile).map((def) =>
    checklistItemFromDefinition(def, caseId, idGen()),
  );
}

// ---------------------------------------------------------------------------
// v1 → v2 checklist migration
// ---------------------------------------------------------------------------

/**
 * The pre-catalog seed used these freeform labels. Mapping them onto catalog
 * codes lets legacy rows (e.g. the seeded Acme case) pick up group /
 * whyWeNeedIt / instrument metadata without losing decisions or documents.
 */
const LEGACY_LABEL_TO_CODE: Readonly<Record<string, string>> = {
  'SEC Registration': 'PH_SEC_REG',
  'BIR Form 2303': 'PH_BIR_2303',
  'Mayor\u2019s / Business Permit': 'PH_MAYORS_PERMIT',
  "Mayor's / Business Permit": 'PH_MAYORS_PERMIT',
  'GIS (latest)': 'PH_GIS',
  'Audited Financial Statements': 'PH_AFS',
  'Tax Clearance': 'PH_TAX_CLEARANCE',
  'PhilGEPS Registration': 'PH_PHILGEPS',
  'Sample Contract / MSA': 'SIGN_MSA',
};

/**
 * Idempotently upgrade a checklist row to the v2 shape. Rows that already
 * carry a `code` are returned as-is; legacy rows are enriched from the catalog
 * when their label matches a known mapping. Decisions, notes, and attached
 * document ids are always preserved.
 */
export function migrateChecklistItem(
  row: RequirementChecklistItem,
): RequirementChecklistItem {
  if (row.code) return row;
  const code = LEGACY_LABEL_TO_CODE[row.requirement];
  const def = code ? CATALOG_BY_CODE[code] : undefined;
  if (!def) return row;
  return {
    ...row,
    code: def.code,
    whyWeNeedIt: row.whyWeNeedIt ?? def.whyWeNeedIt,
    helpUrl: row.helpUrl ?? def.helpUrl,
    authority: row.authority ?? def.authority,
    evidenceFormat: row.evidenceFormat ?? def.evidenceFormat,
    group: row.group ?? def.group,
    instrument: row.instrument ?? def.instrument,
    instrumentCode: row.instrumentCode ?? def.instrumentCode,
    templateVersion: row.templateVersion ?? def.templateVersion,
    renewsAfterMonths: row.renewsAfterMonths ?? def.renewsAfterMonths,
  };
}

/** Migrate a full checklist; reports whether anything changed. */
export function migrateChecklist(rows: RequirementChecklistItem[]): {
  rows: RequirementChecklistItem[];
  changed: boolean;
} {
  let changed = false;
  const next = rows.map((r) => {
    const m = migrateChecklistItem(r);
    if (m !== r) changed = true;
    return m;
  });
  return { rows: next, changed };
}

// ---------------------------------------------------------------------------
// Evidence + progress derivation
// ---------------------------------------------------------------------------

export interface CaseEvidence {
  docs: readonly AccreditationDoc[];
  signed: readonly SignedInstrument[];
}

/** Does this checklist item have vendor-side evidence attached? */
export function hasEvidence(
  item: RequirementChecklistItem,
  evidence: CaseEvidence,
): boolean {
  if (item.instrument) {
    return evidence.signed.some(
      (s) =>
        !s.revokedAt &&
        (s.code === item.instrumentCode || s.code === item.code),
    );
  }
  return evidence.docs.some(
    (d) =>
      (d.requirementId === item.id || item.documentIds.includes(d.id)) &&
      d.status !== 'rejected',
  );
}

/** Is any evidence for this item expiring within `windowDays` (default 30)? */
export function itemExpiringSoon(
  item: RequirementChecklistItem,
  evidence: CaseEvidence,
  windowDays = 30,
): boolean {
  return evidence.docs.some((d) => {
    if (d.requirementId !== item.id && !item.documentIds.includes(d.id)) {
      return false;
    }
    const days = daysUntil(d.expiresAt);
    return days !== null && days <= windowDays;
  });
}

const GROUP_ORDER: readonly RequirementGroup[] = [
  'statutory',
  'tax',
  'regulatory',
  'financial',
  'governance',
  'quality',
  'insurance',
  'ownership',
  'legal_instruments',
];

/** Sort key so grouped renders follow the canonical group order. */
export function groupOrderIndex(group: RequirementGroup | undefined): number {
  if (!group) return GROUP_ORDER.length;
  const idx = GROUP_ORDER.indexOf(group);
  return idx < 0 ? GROUP_ORDER.length : idx;
}

export function groupLabel(group: RequirementGroup | undefined): string {
  return group ? REQUIREMENT_GROUP_LABEL[group] : 'General';
}

/**
 * Roll the checklist + evidence up into the per-group and case-level progress
 * the case page renders (spec: grouped progress, "you still owe N", expiring
 * badges).
 */
export function computeCaseProgress(
  items: readonly RequirementChecklistItem[],
  evidence: CaseEvidence,
): CaseProgressSummary {
  const byGroup = new Map<RequirementGroup | undefined, RequirementChecklistItem[]>();
  for (const item of items) {
    const key = item.group;
    const list = byGroup.get(key);
    if (list) list.push(item);
    else byGroup.set(key, [item]);
  }

  const groups: RequirementGroupProgress[] = [...byGroup.entries()]
    .sort((a, b) => groupOrderIndex(a[0]) - groupOrderIndex(b[0]))
    .map(([group, rows]) => {
      const required = rows.filter((r) => r.required);
      const approved = rows.filter((r) => r.decision === 'approved').length;
      const rejected = rows.filter((r) => r.decision === 'rejected').length;
      const pending = rows.filter((r) => r.decision === 'pending').length;
      const submitted = rows.filter(
        (r) => r.decision === 'pending' && hasEvidence(r, evidence),
      ).length;
      const expiringSoon = rows.filter((r) =>
        itemExpiringSoon(r, evidence),
      ).length;
      const requiredApproved = required.filter(
        (r) => r.decision === 'approved',
      ).length;
      return {
        group: (group ?? 'governance') as RequirementGroup,
        label: groupLabel(group),
        total: rows.length,
        approved,
        rejected,
        pending,
        submitted,
        expiringSoon,
        ratio: required.length ? requiredApproved / required.length : 1,
      };
    });

  const required = items.filter((i) => i.required);
  const requiredApproved = required.filter((i) => i.decision === 'approved');
  const outstanding = required.filter(
    (i) =>
      i.decision !== 'approved' &&
      i.decision !== 'na' &&
      !hasEvidence(i, evidence),
  );
  const awaitingReview = items.filter(
    (i) => i.decision === 'pending' && hasEvidence(i, evidence),
  );

  return {
    total: items.length,
    approved: items.filter((i) => i.decision === 'approved').length,
    pending: items.filter((i) => i.decision === 'pending').length,
    rejected: items.filter((i) => i.decision === 'rejected').length,
    submitted: awaitingReview.length,
    expiringSoon: items.filter((i) => itemExpiringSoon(i, evidence)).length,
    ratio: required.length ? requiredApproved.length / required.length : 1,
    groups,
    outstanding,
    awaitingReview,
  };
}

// ---------------------------------------------------------------------------
// Document version chains (F2.1)
// ---------------------------------------------------------------------------

export interface DocVersionChain {
  /** Newest version — rendered as the full "current" row. */
  current: AccreditationDoc;
  /** Older versions, newest first — collapsed behind a disclosure. */
  previous: AccreditationDoc[];
}

/**
 * Order a requirement's documents into a current-vs-superseded chain.
 * Sorted by `version` desc with `uploadedAt` desc as the tie-break, so a
 * re-upload always outranks the rejected v1 above it. Returns null when the
 * list is empty.
 */
export function docVersionChain(
  docs: readonly AccreditationDoc[],
): DocVersionChain | null {
  if (docs.length === 0) return null;
  const sorted = [...docs].sort(
    (a, b) =>
      b.version - a.version ||
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );
  return { current: sorted[0]!, previous: sorted.slice(1) };
}

// ---------------------------------------------------------------------------
// Checklist ordering + group collapse (§2.2.2 / §2.2.5)
// ---------------------------------------------------------------------------

/**
 * Attention-first sort rank inside a group: rejected → pending (nothing
 * submitted) → submitted (evidence awaiting review) → approved / n-a.
 */
export function checklistRowRank(
  item: RequirementChecklistItem,
  evidence: CaseEvidence,
): number {
  if (item.decision === 'rejected') return 0;
  if (item.decision === 'pending') return hasEvidence(item, evidence) ? 2 : 1;
  return 3; // approved / na
}

export function sortChecklistRows(
  rows: readonly RequirementChecklistItem[],
  evidence: CaseEvidence,
): RequirementChecklistItem[] {
  return [...rows].sort(
    (a, b) => checklistRowRank(a, evidence) - checklistRowRank(b, evidence),
  );
}

/**
 * A group renders collapsed (✓ summary row) when every REQUIRED item is
 * approved / n-a and nothing in it was rejected; groups with rejected or
 * open items auto-expand.
 */
export function isGroupSolved(
  rows: readonly RequirementChecklistItem[],
): boolean {
  if (rows.length === 0) return true;
  if (rows.some((r) => r.decision === 'rejected')) return false;
  const required = rows.filter((r) => r.required);
  if (required.length === 0) {
    return rows.every((r) => r.decision !== 'pending');
  }
  return required.every(
    (r) => r.decision === 'approved' || r.decision === 'na',
  );
}

// ---------------------------------------------------------------------------
// Renewal continuity (F2.3)
// ---------------------------------------------------------------------------

/**
 * The vendor's latest prior case — linked onto a new case as
 * `previousCaseId` so renewal reviews can reach last cycle's documents.
 * Ties on openedAt resolve by id for determinism.
 */
export function derivePreviousCaseId(
  existing: readonly AccreditationCase[],
  vendorId: string,
): string | undefined {
  const prior = existing
    .filter((k) => k.vendorId === vendorId)
    .sort(
      (a, b) =>
        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime() ||
        b.id.localeCompare(a.id),
    );
  return prior[0]?.id;
}

// ---------------------------------------------------------------------------
// Reviewer inbox buckets
// ---------------------------------------------------------------------------

/**
 * Compute which inbox bucket a case belongs to. Returns `null` for terminal
 * cases (approved and current, rejected) which only show under "All".
 */
export function deriveInboxBucket(
  kase: AccreditationCase,
  items: readonly RequirementChecklistItem[],
  evidence: CaseEvidence,
): InboxBucket | null {
  // Renewal takes precedence: an approved case that is expiring / expired
  // needs re-papering regardless of its checklist state.
  if (kase.status === 'approved' && kase.expiresAt) {
    const days = daysUntil(kase.expiresAt);
    if (days !== null && days <= 30) return 'renewal_due';
    return null;
  }
  if (kase.status === 'approved' || kase.status === 'rejected') return null;

  const progress = computeCaseProgress(items, evidence);
  const required = items.filter((i) => i.required);
  const requiredDone =
    required.length > 0 &&
    required.every((i) => i.decision === 'approved' || i.decision === 'na');
  if (requiredDone) return 'ready_for_decision';
  if (kase.status === 'draft') return 'waiting_on_vendor';
  if (progress.awaitingReview.length > 0) return 'waiting_on_legal';
  return 'waiting_on_vendor';
}

export const INBOX_BUCKET_LABEL: Record<InboxBucket, string> = {
  waiting_on_vendor: 'Waiting on vendor',
  waiting_on_legal: 'Waiting on Legal',
  ready_for_decision: 'Ready for decision',
  renewal_due: 'Renewals',
};
