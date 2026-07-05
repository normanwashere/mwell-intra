// Unit specs for the accreditation case logic (T1): tailored-checklist
// seeding, v1 → v2 migration, progress derivation, and inbox buckets.

import { describe, expect, it } from 'vitest';
import type {
  AccreditationCase,
  AccreditationDoc,
  RequirementChecklistItem,
  SignedInstrument,
} from './types';
import {
  buildTailoredChecklist,
  checklistItemFromDefinition,
  checklistRowRank,
  computeCaseProgress,
  deriveInboxBucket,
  derivePreviousCaseId,
  docVersionChain,
  groupLabel,
  groupOrderIndex,
  hasEvidence,
  isGroupSolved,
  itemExpiringSoon,
  migrateChecklist,
  migrateChecklistItem,
  sortChecklistRows,
} from './caseLogic';
import { CATALOG_BY_CODE } from './requirements/catalog';
import {
  DEFAULT_TAILORING_PROFILE,
  type TailoringProfile,
} from './requirements/policy';

let n = 0;
const nextId = () => `id_${++n}`;

const UK_IT_PROFILE: TailoringProfile = {
  jurisdiction: 'UK',
  entityType: 'corporation',
  category: 'it_software',
  riskTier: 'medium',
  contractType: 'sla',
  spendBand: '1m_10m',
  handlesPersonalData: true,
};

function baseCase(over: Partial<AccreditationCase> = {}): AccreditationCase {
  return {
    id: 'case_1',
    vendorId: 'ven_1',
    vendorName: 'Test Vendor',
    status: 'submitted',
    openedAt: new Date().toISOString(),
    ...over,
  };
}

function doc(over: Partial<AccreditationDoc> = {}): AccreditationDoc {
  return {
    id: nextId(),
    caseId: 'case_1',
    vendorId: 'ven_1',
    docType: 'test',
    filename: 'test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    status: 'submitted',
    version: 1,
    uploadedAt: new Date().toISOString(),
    ...over,
  };
}

function signedRow(over: Partial<SignedInstrument> = {}): SignedInstrument {
  return {
    id: nextId(),
    caseId: 'case_1',
    code: 'SIGN_NDA',
    templateVersion: 'nda-v1',
    signerName: 'Alice Vendor',
    signaturePng: 'data:image/png;base64,x',
    signatureMethod: 'drawn',
    signedAt: new Date().toISOString(),
    signerUa: 'test-ua',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tailored checklist seeding
// ---------------------------------------------------------------------------

describe('buildTailoredChecklist', () => {
  it('maps catalog definitions onto checklist rows with v2 fields', () => {
    const def = CATALOG_BY_CODE['PH_SEC_REG']!;
    const item = checklistItemFromDefinition(def, 'case_1', 'rq_1');
    expect(item).toMatchObject({
      id: 'rq_1',
      caseId: 'case_1',
      code: 'PH_SEC_REG',
      requirement: def.label,
      whyWeNeedIt: def.whyWeNeedIt,
      group: 'statutory',
      required: true,
      instrument: false,
      decision: 'pending',
      documentIds: [],
    });
  });

  it('seeds a UK IT vendor with GDPR DPA + Companies House but NO BIR/SEC', () => {
    const items = buildTailoredChecklist(UK_IT_PROFILE, 'case_1', nextId);
    const codes = items.map((i) => i.code);
    expect(codes).toContain('EU_GDPR_DPA');
    expect(codes).toContain('UK_COMPANIES_HOUSE');
    expect(codes).toContain('ISO_27001');
    expect(codes).not.toContain('PH_BIR_2303');
    expect(codes).not.toContain('PH_SEC_REG');
    expect(codes).not.toContain('PH_MAYORS_PERMIT');
  });

  it('includes signable instruments as instrument rows', () => {
    const items = buildTailoredChecklist(UK_IT_PROFILE, 'case_1', nextId);
    const instruments = items.filter((i) => i.instrument);
    expect(instruments.length).toBeGreaterThanOrEqual(5);
    const nda = instruments.find((i) => i.code === 'SIGN_NDA');
    expect(nda?.instrumentCode).toBe('SIGN_NDA');
    expect(nda?.group).toBe('legal_instruments');
  });

  it('omits personal-data instruments when the vendor handles no personal data', () => {
    const items = buildTailoredChecklist(
      { ...UK_IT_PROFILE, handlesPersonalData: false },
      'case_1',
      nextId,
    );
    const codes = items.map((i) => i.code);
    expect(codes).not.toContain('EU_GDPR_DPA');
  });

  it('adds the EDD pack only for high-risk vendors', () => {
    const low = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'c', nextId);
    expect(low.map((i) => i.code)).not.toContain('INTL_EDD');
    const high = buildTailoredChecklist(
      { ...DEFAULT_TAILORING_PROFILE, riskTier: 'high' },
      'c',
      nextId,
    );
    expect(high.map((i) => i.code)).toContain('INTL_EDD');
  });
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

describe('migrateChecklistItem', () => {
  const legacy: RequirementChecklistItem = {
    id: 'rq_legacy',
    caseId: 'case_1',
    requirement: 'SEC Registration',
    description: 'Latest SEC certificate of registration.',
    required: true,
    decision: 'approved',
    reviewerNote: 'checked against SEC portal',
    documentIds: ['doc_1'],
  };

  it('enriches known legacy labels with catalog metadata', () => {
    const migrated = migrateChecklistItem(legacy);
    expect(migrated.code).toBe('PH_SEC_REG');
    expect(migrated.group).toBe('statutory');
    expect(migrated.whyWeNeedIt).toBeTruthy();
    expect(migrated.authority).toBe('SEC');
  });

  it('preserves decisions, notes and attached documents', () => {
    const migrated = migrateChecklistItem(legacy);
    expect(migrated.decision).toBe('approved');
    expect(migrated.reviewerNote).toBe('checked against SEC portal');
    expect(migrated.documentIds).toEqual(['doc_1']);
  });

  it('is idempotent — rows that already carry a code pass through unchanged', () => {
    const once = migrateChecklistItem(legacy);
    const twice = migrateChecklistItem(once);
    expect(twice).toBe(once);
  });

  it('leaves unknown legacy labels intact instead of guessing', () => {
    const unknown: RequirementChecklistItem = {
      ...legacy,
      requirement: 'Some Bespoke Document',
    };
    const migrated = migrateChecklistItem(unknown);
    expect(migrated.code).toBeUndefined();
    expect(migrated.requirement).toBe('Some Bespoke Document');
  });

  it('migrates the full legacy Acme seed and flags the change', () => {
    const labels = [
      'SEC Registration',
      'BIR Form 2303',
      'Mayor\u2019s / Business Permit',
      'GIS (latest)',
      'Audited Financial Statements',
      'Tax Clearance',
      'PhilGEPS Registration',
      'Sample Contract / MSA',
    ];
    const rows = labels.map((label, i) => ({
      id: `rq_${i}`,
      caseId: 'case_1',
      requirement: label,
      required: true,
      decision: 'pending' as const,
      documentIds: [],
    }));
    const { rows: migrated, changed } = migrateChecklist(rows);
    expect(changed).toBe(true);
    expect(migrated.every((r) => r.code)).toBe(true);
    const msa = migrated.find((r) => r.requirement === 'Sample Contract / MSA');
    expect(msa?.instrument).toBe(true);
    expect(msa?.instrumentCode).toBe('SIGN_MSA');
  });

  it('reports changed=false when nothing needed migrating', () => {
    const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'c', nextId);
    const { changed } = migrateChecklist(items);
    expect(changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evidence + progress
// ---------------------------------------------------------------------------

describe('evidence + progress', () => {
  it('hasEvidence sees docs attached by requirementId or documentIds', () => {
    const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', nextId);
    const target = items.find((i) => !i.instrument)!;
    expect(hasEvidence(target, { docs: [], signed: [] })).toBe(false);
    expect(
      hasEvidence(target, { docs: [doc({ requirementId: target.id })], signed: [] }),
    ).toBe(true);
  });

  it('hasEvidence sees signed instruments for instrument rows (not docs)', () => {
    const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', nextId);
    const nda = items.find((i) => i.code === 'SIGN_NDA')!;
    expect(hasEvidence(nda, { docs: [], signed: [] })).toBe(false);
    expect(hasEvidence(nda, { docs: [], signed: [signedRow()] })).toBe(true);
    // Revoked signatures don't count.
    expect(
      hasEvidence(nda, {
        docs: [],
        signed: [signedRow({ revokedAt: new Date().toISOString() })],
      }),
    ).toBe(false);
  });

  it('itemExpiringSoon flags docs expiring within the window', () => {
    const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', nextId);
    const target = items.find((i) => !i.instrument)!;
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    expect(
      itemExpiringSoon(target, {
        docs: [doc({ requirementId: target.id, expiresAt: soon })],
        signed: [],
      }),
    ).toBe(true);
    expect(
      itemExpiringSoon(target, {
        docs: [doc({ requirementId: target.id, expiresAt: far })],
        signed: [],
      }),
    ).toBe(false);
  });

  it('computeCaseProgress rolls up outstanding + awaiting-review counts', () => {
    const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', nextId);
    const required = items.filter((i) => i.required);
    const first = required.find((i) => !i.instrument)!;
    const progress = computeCaseProgress(items, {
      docs: [doc({ requirementId: first.id })],
      signed: [],
    });
    expect(progress.total).toBe(items.length);
    expect(progress.awaitingReview.map((i) => i.id)).toContain(first.id);
    expect(progress.outstanding.map((i) => i.id)).not.toContain(first.id);
    // Everything else required is still outstanding.
    expect(progress.outstanding.length).toBe(required.length - 1);
    expect(progress.ratio).toBe(0);
  });

  it('groups follow the canonical order and expose per-group ratios', () => {
    const items = buildTailoredChecklist(UK_IT_PROFILE, 'case_1', nextId);
    const progress = computeCaseProgress(items, { docs: [], signed: [] });
    const orders = progress.groups.map((g) => groupOrderIndex(g.group));
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const g of progress.groups) {
      expect(g.label).toBe(groupLabel(g.group));
      expect(g.ratio).toBeGreaterThanOrEqual(0);
      expect(g.ratio).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Inbox buckets
// ---------------------------------------------------------------------------

describe('deriveInboxBucket', () => {
  const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', () =>
    nextId(),
  );

  it('draft case with no evidence → waiting_on_vendor', () => {
    const bucket = deriveInboxBucket(baseCase({ status: 'draft' }), items, {
      docs: [],
      signed: [],
    });
    expect(bucket).toBe('waiting_on_vendor');
  });

  it('submitted case with unreviewed evidence → waiting_on_legal', () => {
    const target = items.find((i) => i.required && !i.instrument)!;
    const bucket = deriveInboxBucket(baseCase(), items, {
      docs: [doc({ requirementId: target.id })],
      signed: [],
    });
    expect(bucket).toBe('waiting_on_legal');
  });

  it('submitted case with no evidence at all → waiting_on_vendor', () => {
    const bucket = deriveInboxBucket(baseCase(), items, { docs: [], signed: [] });
    expect(bucket).toBe('waiting_on_vendor');
  });

  it('all required items approved → ready_for_decision', () => {
    const done = items.map((i) =>
      i.required ? { ...i, decision: 'approved' as const } : i,
    );
    const bucket = deriveInboxBucket(baseCase(), done, { docs: [], signed: [] });
    expect(bucket).toBe('ready_for_decision');
  });

  it('approved case expiring within 30 days → renewal_due', () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const bucket = deriveInboxBucket(
      baseCase({ status: 'approved', expiresAt: soon }),
      items,
      { docs: [], signed: [] },
    );
    expect(bucket).toBe('renewal_due');
  });

  it('approved case with a far-out expiry → no bucket (terminal)', () => {
    const far = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    const bucket = deriveInboxBucket(
      baseCase({ status: 'approved', expiresAt: far }),
      items,
      { docs: [], signed: [] },
    );
    expect(bucket).toBeNull();
  });

  it('rejected case → no bucket (terminal)', () => {
    const bucket = deriveInboxBucket(baseCase({ status: 'rejected' }), items, {
      docs: [],
      signed: [],
    });
    expect(bucket).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Document version chains (F2.1)
// ---------------------------------------------------------------------------

describe('docVersionChain', () => {
  it('orders by version desc — newest is current, rest are previous', () => {
    const v1 = doc({ version: 1, uploadedAt: '2026-07-01T00:00:00.000Z' });
    const v3 = doc({ version: 3, uploadedAt: '2026-07-03T00:00:00.000Z' });
    const v2 = doc({ version: 2, uploadedAt: '2026-07-02T00:00:00.000Z' });
    const chain = docVersionChain([v1, v3, v2])!;
    expect(chain.current.id).toBe(v3.id);
    expect(chain.previous.map((d) => d.id)).toEqual([v2.id, v1.id]);
  });

  it('tie-breaks equal versions on uploadedAt desc', () => {
    const older = doc({ version: 1, uploadedAt: '2026-07-01T00:00:00.000Z' });
    const newer = doc({ version: 1, uploadedAt: '2026-07-04T00:00:00.000Z' });
    const chain = docVersionChain([older, newer])!;
    expect(chain.current.id).toBe(newer.id);
    expect(chain.previous.map((d) => d.id)).toEqual([older.id]);
  });

  it('returns null for an empty list', () => {
    expect(docVersionChain([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Checklist ordering + group collapse (§2.2.2 / §2.2.5)
// ---------------------------------------------------------------------------

describe('checklist ordering + group collapse', () => {
  const items = buildTailoredChecklist(DEFAULT_TAILORING_PROFILE, 'case_1', nextId);

  it('ranks rejected → pending → submitted → approved', () => {
    const plain = items.filter((i) => !i.instrument);
    const rejected = { ...plain[0]!, decision: 'rejected' as const };
    const pending = { ...plain[1]!, decision: 'pending' as const };
    const submitted = { ...plain[2]!, decision: 'pending' as const };
    const approved = { ...plain[3]!, decision: 'approved' as const };
    const evidence = { docs: [doc({ requirementId: submitted.id })], signed: [] };
    const sorted = sortChecklistRows(
      [approved, submitted, pending, rejected],
      evidence,
    );
    expect(sorted.map((r) => r.id)).toEqual([
      rejected.id,
      pending.id,
      submitted.id,
      approved.id,
    ]);
    expect(checklistRowRank(rejected, evidence)).toBe(0);
    expect(checklistRowRank(approved, evidence)).toBe(3);
  });

  it('marks a group solved when all required items are approved / n-a', () => {
    const group = items.filter((i) => i.group === 'statutory');
    const solved = group.map((i) =>
      i.required ? { ...i, decision: 'approved' as const } : { ...i, decision: 'na' as const },
    );
    expect(isGroupSolved(solved)).toBe(true);
  });

  it('keeps a group expanded when anything is rejected or still open', () => {
    const group = items.filter((i) => i.group === 'statutory');
    expect(isGroupSolved(group)).toBe(false); // all pending
    const oneRejected = group.map((i, idx) =>
      idx === 0
        ? { ...i, decision: 'rejected' as const }
        : { ...i, decision: 'approved' as const },
    );
    expect(isGroupSolved(oneRejected)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Renewal continuity (F2.3)
// ---------------------------------------------------------------------------

describe('derivePreviousCaseId', () => {
  const older = baseCase({
    id: 'case_2025',
    openedAt: '2025-06-01T00:00:00.000Z',
    status: 'approved',
  });
  const newer = baseCase({
    id: 'case_2026',
    openedAt: '2026-06-01T00:00:00.000Z',
    status: 'approved',
  });

  it('links the latest prior case for the same vendor', () => {
    expect(derivePreviousCaseId([older, newer], 'ven_1')).toBe('case_2026');
    expect(derivePreviousCaseId([newer, older], 'ven_1')).toBe('case_2026');
  });

  it('returns undefined for a first-time vendor', () => {
    expect(derivePreviousCaseId([older, newer], 'ven_other')).toBeUndefined();
    expect(derivePreviousCaseId([], 'ven_1')).toBeUndefined();
  });

  it('ignores other vendors\u2019 cases entirely', () => {
    const foreign = baseCase({ id: 'case_x', vendorId: 'ven_2' });
    expect(derivePreviousCaseId([foreign, older], 'ven_1')).toBe('case_2025');
  });
});
