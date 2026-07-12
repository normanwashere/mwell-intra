// Legal accreditation demo seed — six cases telling the full lifecycle story:
// mid-review, approved international, renewal-due, high-risk with a rejected
// resubmission chain, fresh invite (draft), and a rejected case.
//
// Pure + deterministic (injected `now`, counter ids) so it can be unit-tested
// in Node. Checklists are built through the SAME policy engine the invite
// wizard uses (buildTailoredChecklist), then decisions/docs/instruments are
// layered on programmatically so the seed stays valid as the catalog evolves.

import type {
  AccreditationCase,
  AccreditationDoc,
  CaseSignature,
  CaseTimelineEntry,
  RequirementChecklistItem,
  SignedInstrument,
  VendorInvite,
} from './types';
import { buildTailoredChecklist } from './caseLogic';
import type { TailoringProfile } from './requirements/policy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function idGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}_seed_${(++n).toString().padStart(3, '0')}`;
}

function daysAgo(now: Date, days: number, hourOfDay = 10): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hourOfDay, (days * 13) % 60, 0, 0);
  return d.toISOString();
}

function daysAheadDate(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tiny SVG "document" placeholder rendered as a data URL. */
function docDataUrl(title: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="820">` +
    `<rect width="640" height="820" fill="#ffffff" stroke="#cbd5e1"/>` +
    `<rect x="48" y="48" width="240" height="22" fill="#0f172a" opacity="0.85"/>` +
    `<text x="48" y="110" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#0f172a">${title}</text>` +
    `<g fill="#94a3b8">` +
    Array.from({ length: 14 })
      .map((_, i) => `<rect x="48" y="${150 + i * 40}" width="${i % 3 === 2 ? 380 : 544}" height="12" rx="6"/>`)
      .join('') +
    `</g>` +
    `<text x="48" y="770" font-family="Arial" font-size="13" fill="#64748b">Demo placeholder — not a real document.</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Typed-signature PNG stand-in (SVG data URL, same look as SignaturePad). */
function signatureDataUrl(name: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="160">` +
    `<rect width="600" height="160" fill="#ffffff"/>` +
    `<text x="300" y="92" font-family="'Segoe Script','Snell Roundhand','Apple Chancery',cursive" ` +
    `font-size="52" font-style="italic" fill="#0f172a" text-anchor="middle">${name}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function caseSignature(name: string, at: string): CaseSignature {
  return {
    method: 'typed',
    dataUrl: signatureDataUrl(name),
    signerName: name,
    signedAt: at,
    userAgent: 'seed | demo dataset',
  };
}

export interface LegalSeed {
  cases: AccreditationCase[];
  checklist: RequirementChecklistItem[];
  docs: AccreditationDoc[];
  timeline: CaseTimelineEntry[];
  invites: VendorInvite[];
  signedInstruments: SignedInstrument[];
}

const LEGAL_REVIEWER = 'legal@mwell.demo';

// ---------------------------------------------------------------------------
// Case assembly engine
// ---------------------------------------------------------------------------

interface CaseSpec {
  vendorId: string;
  vendorName: string;
  contactEmail: string;
  contactName: string;
  category: string;
  profile: TailoringProfile;
  originCountry?: string;
  openedDaysAgo: number;
  /** undefined = still a draft (vendor hasn't submitted). */
  submittedDaysAgo?: number;
  /** True when the reviewer explicitly moved the case to under_review. */
  reviewStarted?: boolean;
  decision?: {
    outcome: 'approved' | 'rejected';
    daysAgo: number;
    note?: string;
    scope?: string;
    /** Days from `now` until accreditation expiry (approved only). */
    expiresInDays?: number;
  };
  /**
   * How far along the vendor/reviewer are:
   * - uploadRatio: share of required doc items that have an upload.
   * - approveRatio: share of uploaded items the reviewer has approved.
   * - signInstruments: sign this many of the case's instrument items.
   * - rejectedResubmission: build a v1-rejected → v2-submitted chain on one item.
   */
  progress: {
    uploadRatio: number;
    approveRatio: number;
    signInstruments: number;
    rejectedResubmission?: boolean;
  };
}

export function buildLegalSeed(now: Date = new Date()): LegalSeed {
  const caseId = idGen('case');
  const rqId = idGen('rq');
  const docId = idGen('doc');
  const tlId = idGen('tl');
  const invId = idGen('inv');
  const sigId = idGen('sig');

  const cases: AccreditationCase[] = [];
  const checklist: RequirementChecklistItem[] = [];
  const docs: AccreditationDoc[] = [];
  const timeline: CaseTimelineEntry[] = [];
  const invites: VendorInvite[] = [];
  const signedInstruments: SignedInstrument[] = [];

  const pushTimeline = (
    cid: string,
    at: string,
    action: string,
    detail: string,
    actorEmail?: string,
  ) => {
    timeline.push({ id: tlId(), caseId: cid, at, action, detail, actorEmail });
  };

  const buildCase = (spec: CaseSpec): AccreditationCase => {
    const id = caseId();
    const openedAt = daysAgo(now, spec.openedDaysAgo, 9);
    const submittedAt =
      spec.submittedDaysAgo !== undefined ? daysAgo(now, spec.submittedDaysAgo, 11) : undefined;
    const decidedAt = spec.decision ? daysAgo(now, spec.decision.daysAgo, 15) : undefined;

    let status: AccreditationCase['status'] = 'draft';
    if (submittedAt) status = 'submitted';
    if (spec.reviewStarted && submittedAt && !spec.decision) status = 'under_review';
    if (spec.decision) status = spec.decision.outcome;

    const kase: AccreditationCase = {
      id,
      vendorId: spec.vendorId,
      vendorName: spec.vendorName,
      status,
      openedAt,
      submittedAt,
      decidedAt,
      decidedByEmail: spec.decision ? LEGAL_REVIEWER : undefined,
      decisionNote: spec.decision?.note,
      expiresAt:
        spec.decision?.outcome === 'approved'
          ? daysAheadDate(now, spec.decision.expiresInDays ?? 365)
          : undefined,
      scope: spec.decision?.scope,
      category: spec.category,
      jurisdiction: spec.profile.jurisdiction,
      originCountry: spec.originCountry,
      entityType: spec.profile.entityType,
      vendorCategory: spec.profile.category,
      riskTier: spec.profile.riskTier,
      contractType: spec.profile.contractType,
      expectedAnnualSpend: spec.profile.spendBand,
      handlesPersonalData: spec.profile.handlesPersonalData,
      invitedByEmail: LEGAL_REVIEWER,
      contactEmail: spec.contactEmail,
      submissionSignature: submittedAt
        ? caseSignature(spec.contactName, submittedAt)
        : undefined,
      decisionSignature: decidedAt
        ? caseSignature('Andre Villanueva', decidedAt)
        : undefined,
    };
    cases.push(kase);

    // Tailored checklist through the real policy engine.
    const items = buildTailoredChecklist(spec.profile, id, rqId);

    pushTimeline(
      id,
      openedAt,
      'created',
      `Case opened for ${spec.vendorName} — ${items.length} tailored requirements.`,
      LEGAL_REVIEWER,
    );

    // Layer vendor progress onto the checklist.
    const docItems = items.filter((i) => !i.instrument && i.required);
    const instrumentItems = items.filter((i) => i.instrument);
    const uploadCount = Math.round(docItems.length * spec.progress.uploadRatio);
    const approveCount = Math.round(uploadCount * spec.progress.approveRatio);

    docItems.forEach((item, idx) => {
      if (idx >= uploadCount) return;
      const uploadedAt = daysAgo(now, Math.max(0, spec.openedDaysAgo - 1 - (idx % 5)), 12);

      // One item optionally carries a rejected v1 → submitted v2 chain. The
      // v2 resubmission is always awaiting review (never pre-approved).
      const isResubmission = Boolean(spec.progress.rejectedResubmission) && idx === 0;
      const approved = !isResubmission && idx < approveCount;
      if (isResubmission) {
        const v1 = {
          id: docId(),
          caseId: id,
          vendorId: spec.vendorId,
          requirementId: item.id,
          docType: item.requirement,
          filename: `${(item.code ?? 'document').toLowerCase()}-v1.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 182_044,
          dataUrl: docDataUrl(`${item.requirement} (v1)`),
          status: 'rejected' as const,
          version: 1,
          uploadedAt: daysAgo(now, spec.openedDaysAgo - 1, 10),
          uploadedByEmail: spec.contactEmail,
          reviewerNote: 'Scanned copy is unreadable — please upload the certified original.',
        };
        docs.push(v1);
        pushTimeline(id, v1.uploadedAt, 'doc_uploaded', `${item.requirement} · ${v1.filename} (v1)`, spec.contactEmail);
        pushTimeline(
          id,
          daysAgo(now, spec.openedDaysAgo - 2, 14),
          'doc_reviewed',
          `${item.requirement} · ${v1.filename} → rejected (unreadable scan)`,
          LEGAL_REVIEWER,
        );
      }

      const doc: AccreditationDoc = {
        id: docId(),
        caseId: id,
        vendorId: spec.vendorId,
        requirementId: item.id,
        docType: item.requirement,
        filename: `${(item.code ?? 'document').toLowerCase()}${isResubmission ? '-v2' : ''}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 240_512 + idx * 1_311,
        dataUrl: docDataUrl(item.requirement),
        status: approved ? 'approved' : 'submitted',
        version: isResubmission ? 2 : 1,
        uploadedAt,
        uploadedByEmail: spec.contactEmail,
      };
      docs.push(doc);
      pushTimeline(id, uploadedAt, 'doc_uploaded', `${item.requirement} · ${doc.filename} (v${doc.version})`, spec.contactEmail);

      item.documentIds = [...item.documentIds, doc.id];
      if (approved) {
        item.decision = 'approved';
        item.reviewerEmail = LEGAL_REVIEWER;
        item.reviewedAt = daysAgo(now, Math.max(0, spec.openedDaysAgo - 3 - (idx % 4)), 16);
        pushTimeline(id, item.reviewedAt, 'checklist_decided', `${item.requirement} → approved.`, LEGAL_REVIEWER);
      }
    });

    // Sign the requested number of instruments.
    instrumentItems.slice(0, spec.progress.signInstruments).forEach((item, idx) => {
      const signedAt = daysAgo(now, Math.max(0, spec.openedDaysAgo - 2 - idx), 13);
      const record: SignedInstrument = {
        id: sigId(),
        caseId: id,
        code: item.instrumentCode ?? item.code ?? 'SIGN_NDA',
        templateVersion: item.templateVersion ?? '2026.01.01',
        signerName: spec.contactName,
        signerTitle: 'Authorized Signatory',
        signerEmail: spec.contactEmail,
        signaturePng: signatureDataUrl(spec.contactName),
        signatureMethod: 'typed',
        signedAt,
        signerUa: 'seed | demo dataset',
      };
      signedInstruments.push(record);
      item.decision = 'approved';
      item.reviewerEmail = LEGAL_REVIEWER;
      item.reviewedAt = signedAt;
      pushTimeline(
        id,
        signedAt,
        'instrument_signed',
        `${record.code} (v${record.templateVersion}) e-signed by ${spec.contactName} (typed).`,
        spec.contactEmail,
      );
    });

    // Approved decisions imply the reviewer cleared everything outstanding.
    if (spec.decision?.outcome === 'approved') {
      for (const item of items) {
        if (item.decision === 'pending') {
          item.decision = item.required ? 'approved' : 'na';
          item.reviewerEmail = LEGAL_REVIEWER;
          item.reviewedAt = decidedAt;
        }
      }
    }

    checklist.push(...items);

    if (submittedAt) {
      pushTimeline(
        id,
        submittedAt,
        'submitted',
        `Vendor submitted the intake for legal review — completeness attested and e-signed by ${spec.contactName}.`,
        spec.contactEmail,
      );
    }
    if (spec.decision && decidedAt) {
      pushTimeline(
        id,
        decidedAt,
        spec.decision.outcome,
        spec.decision.outcome === 'approved'
          ? `Accreditation approved — scope: ${spec.decision.scope ?? spec.category}, expires ${kase.expiresAt}. E-signed by Andre Villanueva.`
          : `Accreditation rejected — ${spec.decision.note ?? 'see decision note'}. E-signed by Andre Villanueva.`,
        LEGAL_REVIEWER,
      );
    }

    return kase;
  };

  // ── 1. Acme Medical Supplies — submitted, mid-review (the demo vendor) ────
  buildCase({
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    contactEmail: 'vendor@acme.demo',
    contactName: 'Grace Lim',
    category: 'Medical devices',
    profile: {
      jurisdiction: 'PH',
      entityType: 'corporation',
      category: 'medical_pharma',
      riskTier: 'medium',
      contractType: 'master_supply',
      spendBand: '1m_10m',
      handlesPersonalData: false,
    },
    openedDaysAgo: 14,
    submittedDaysAgo: 9,
    progress: { uploadRatio: 0.6, approveRatio: 0.5, signInstruments: 1 },
  });

  // ── 2. Global Health Devices (SG) — approved international vendor ─────────
  buildCase({
    vendorId: 'ven-globalhealth',
    vendorName: 'Global Health Devices Pte. Ltd.',
    contactEmail: 'compliance@globalhealth.sg',
    contactName: 'Wei Ling Tan',
    category: 'Medical devices (import)',
    profile: {
      jurisdiction: 'SG',
      entityType: 'corporation',
      category: 'medical_pharma',
      riskTier: 'high',
      contractType: 'master_supply',
      spendBand: '10m_50m',
      handlesPersonalData: true,
    },
    openedDaysAgo: 120,
    submittedDaysAgo: 95,
    decision: {
      outcome: 'approved',
      daysAgo: 80,
      scope: 'Medical devices, diagnostic consumables (import)',
      expiresInDays: 285,
    },
    progress: { uploadRatio: 1, approveRatio: 1, signInstruments: 4 },
  });

  // ── 3. BrightPath Print & Signage — renewal due (expires in ~20 days) ────
  buildCase({
    vendorId: 'ven-brightpath',
    vendorName: 'BrightPath Print & Signage',
    contactEmail: 'accounts@brightpath.ph',
    contactName: 'Paolo Garcia',
    category: 'Marketing collateral',
    profile: {
      jurisdiction: 'PH',
      entityType: 'sole_prop',
      category: 'marketing',
      riskTier: 'low',
      contractType: 'spot_po',
      spendBand: '100k_1m',
      handlesPersonalData: false,
    },
    openedDaysAgo: 340,
    submittedDaysAgo: 330,
    decision: {
      outcome: 'approved',
      daysAgo: 320,
      scope: 'Print & signage production',
      expiresInDays: 20,
    },
    progress: { uploadRatio: 1, approveRatio: 1, signInstruments: 2 },
  });

  // ── 4. CareGrid Staffing — under review, high risk, resubmission chain ───
  buildCase({
    vendorId: 'ven-caregrid',
    vendorName: 'CareGrid Staffing Solutions, Inc.',
    contactEmail: 'legal@caregrid.ph',
    contactName: 'Miguel Santos',
    category: 'Manpower / staffing',
    profile: {
      jurisdiction: 'PH',
      entityType: 'corporation',
      category: 'manpower',
      riskTier: 'high',
      contractType: 'manpower_supply',
      spendBand: '1m_10m',
      handlesPersonalData: true,
    },
    openedDaysAgo: 28,
    submittedDaysAgo: 20,
    reviewStarted: true,
    progress: {
      uploadRatio: 0.8,
      approveRatio: 0.4,
      signInstruments: 3,
      rejectedResubmission: true,
    },
  });

  // ── 5. Vertex Analytics (UK) — fresh invite, draft case ──────────────────
  const vertexProfile: TailoringProfile = {
    jurisdiction: 'UK',
    entityType: 'corporation',
    category: 'it_software',
    riskTier: 'medium',
    contractType: 'sla',
    spendBand: '1m_10m',
    handlesPersonalData: true,
  };
  buildCase({
    vendorId: 'ven-vertex',
    vendorName: 'Vertex Analytics Ltd.',
    contactEmail: 'onboarding@vertexanalytics.co.uk',
    contactName: 'Sarah Whitmore',
    category: 'Analytics platform',
    profile: vertexProfile,
    openedDaysAgo: 2,
    progress: { uploadRatio: 0, approveRatio: 0, signInstruments: 0 },
  });
  invites.push({
    id: invId(),
    email: 'onboarding@vertexanalytics.co.uk',
    companyName: 'Vertex Analytics Ltd.',
    category: 'Analytics platform',
    createdAt: daysAgo(now, 2, 9),
    createdByEmail: LEGAL_REVIEWER,
    status: 'sent',
    jurisdiction: vertexProfile.jurisdiction,
    entityType: vertexProfile.entityType,
    vendorCategory: vertexProfile.category,
    riskTier: vertexProfile.riskTier,
    contractType: vertexProfile.contractType,
    expectedAnnualSpend: vertexProfile.spendBand,
    handlesPersonalData: vertexProfile.handlesPersonalData,
  });

  // ── 6. QuickHaul Trucking — rejected ──────────────────────────────────────
  buildCase({
    vendorId: 'ven-quickhaul',
    vendorName: 'QuickHaul Trucking Services',
    contactEmail: 'dispatch@quickhaul.ph',
    contactName: 'Rey Bautista',
    category: 'Logistics',
    profile: {
      jurisdiction: 'PH',
      entityType: 'sole_prop',
      category: 'logistics',
      riskTier: 'medium',
      contractType: 'spot_po',
      spendBand: '100k_1m',
      handlesPersonalData: false,
    },
    openedDaysAgo: 60,
    submittedDaysAgo: 50,
    decision: {
      outcome: 'rejected',
      daysAgo: 42,
      note: 'Expired business permit and no proof of comprehensive vehicle insurance. May reapply once both are current.',
    },
    progress: { uploadRatio: 0.5, approveRatio: 0.3, signInstruments: 1 },
  });

  // Timeline arrives newest-first in the store; sort accordingly.
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  return { cases, checklist, docs, timeline, invites, signedInstruments };
}
