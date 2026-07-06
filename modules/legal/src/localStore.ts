// Local-only legal store (preview build).
//
// The real repository adapter (@intra/core-data + legal.* RPCs) lands
// post-MVP; until then we persist accreditation cases, checklist items,
// documents, timeline entries, and vendor invites to localStorage so the
// entire accreditation workflow (invite → onboard → docs → checklist →
// approve → renew) is clickable end-to-end.
//
// Namespaced under `intra.legal.v1.*` so a future migration is clean.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccreditationCase,
  AccreditationDoc,
  CaseSignature,
  CaseStatus,
  CaseTimelineEntry,
  ChecklistDecision,
  DocumentStatus,
  RequirementChecklistItem,
  SignedInstrument,
  VendorInvite,
} from './types';
import {
  buildTailoredChecklist,
  derivePreviousCaseId,
  migrateChecklist,
} from './caseLogic';
import { cleanupCases } from './hygiene';
import { buildLegalSeed } from './seed';
import type { VendorLoginAlias } from './vendorAccess';
import type { TailoringProfile } from './requirements/policy';

const CASES_KEY = 'intra.legal.v1.cases';
const CHECKLIST_KEY = 'intra.legal.v1.checklist';
const DOCS_KEY = 'intra.legal.v1.docs';
const TIMELINE_KEY = 'intra.legal.v1.timeline';
const INVITES_KEY = 'intra.legal.v1.invites';
const SIGNED_KEY = 'intra.legal.v1.signed_instruments';
const ALIASES_KEY = 'intra.legal.v1.vendor_aliases';
const LEGACY_SEED_KEY = 'intra.legal.v1.seeded';
const SEED_KEY = 'intra.legal.v2.seeded';
const MIGRATED_KEY = 'intra.legal.v2.checklist_migrated';
const CHANGE_EVT = 'intra.legal.change';

function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
}
function nowIso(): string {
  return new Date().toISOString();
}
function daysAhead(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function safeRead<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
function safeWrite<T>(key: string, rows: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(new Event(CHANGE_EVT));
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Seed — six-case demo universe (see seed.ts). The legacy v1 single-case seed
// is superseded: when a browser still carries the v1 flag but not v2, the
// legal keys are wiped and reseeded so everyone lands on the same rich story.
// ---------------------------------------------------------------------------
const DEFAULT_REQUIREMENTS: Array<Omit<RequirementChecklistItem, 'id' | 'caseId' | 'documentIds'>> = [
  { requirement: 'SEC Registration', description: 'Latest SEC certificate of registration.', required: true, decision: 'pending' },
  { requirement: 'BIR Form 2303', description: 'Certificate of registration.', required: true, decision: 'pending' },
  { requirement: 'Mayor\u2019s / Business Permit', description: 'Current-year permit from the LGU.', required: true, decision: 'pending' },
  { requirement: 'GIS (latest)', description: 'General Information Sheet filed at SEC.', required: true, decision: 'pending' },
  { requirement: 'Audited Financial Statements', description: 'Most recent AFS.', required: true, decision: 'pending' },
  { requirement: 'Tax Clearance', description: 'From BIR — valid for the year.', required: false, decision: 'pending' },
  { requirement: 'PhilGEPS Registration', description: 'If bidding for government-adjacent work.', required: false, decision: 'pending' },
  { requirement: 'Sample Contract / MSA', description: 'Draft or executed master service agreement.', required: false, decision: 'pending' },
];

/**
 * Seed the demo dataset once per browser. Exported so the shell can call it
 * on first load (badges light up before the module is ever opened).
 */
export function ensureLegalSeed(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(SEED_KEY)) return;
    const hadV1 = Boolean(window.localStorage.getItem(LEGACY_SEED_KEY));
    if (hadV1) {
      // v1-seeded browser: wipe the thin single-case dataset so the rich
      // v2 story replaces it wholesale (demo store — no user data contract).
      for (const key of [
        CASES_KEY, CHECKLIST_KEY, DOCS_KEY, TIMELINE_KEY,
        INVITES_KEY, SIGNED_KEY, ALIASES_KEY,
      ]) {
        window.localStorage.removeItem(key);
      }
      window.localStorage.removeItem(MIGRATED_KEY);
    }
    const seed = buildLegalSeed(new Date());
    safeWrite(CASES_KEY, [...seed.cases, ...safeRead<AccreditationCase>(CASES_KEY)]);
    safeWrite(CHECKLIST_KEY, [...seed.checklist, ...safeRead<RequirementChecklistItem>(CHECKLIST_KEY)]);
    safeWrite(DOCS_KEY, [...seed.docs, ...safeRead<AccreditationDoc>(DOCS_KEY)]);
    safeWrite(TIMELINE_KEY, [...seed.timeline, ...safeRead<CaseTimelineEntry>(TIMELINE_KEY)]);
    safeWrite(INVITES_KEY, [...seed.invites, ...safeRead<VendorInvite>(INVITES_KEY)]);
    safeWrite(SIGNED_KEY, [...seed.signedInstruments, ...safeRead<SignedInstrument>(SIGNED_KEY)]);
    window.localStorage.setItem(SEED_KEY, '1');
    window.localStorage.setItem(LEGACY_SEED_KEY, '1');
  } catch {
    /* storage disabled — demo simply starts empty */
  }
}

function seedOnce(): void {
  ensureLegalSeed();
}

/**
 * One-time v1 → v2 checklist upgrade: enrich legacy rows with catalog
 * metadata (code / group / whyWeNeedIt / instrument fields) while preserving
 * decisions and attached documents. Runs before the first read so every hook
 * sees the migrated shape.
 */
function migrateOnce(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(MIGRATED_KEY)) return;
  const current = safeRead<RequirementChecklistItem>(CHECKLIST_KEY);
  const { rows, changed } = migrateChecklist(current);
  if (changed) safeWrite(CHECKLIST_KEY, rows);
  window.localStorage.setItem(MIGRATED_KEY, '1');
}

/**
 * Demo-data hygiene (F1.2): repair vendorId collisions left behind by E2E
 * walks that rebound invite-minted cases onto `ven-acme`. `cleanupCases` is
 * deterministic + idempotent, so re-running on clean data is a no-op; the
 * module-level flag just keeps the console.warn to once per page load.
 */
let hygieneRanThisLoad = false;
function cleanupOnce(): void {
  if (typeof window === 'undefined' || hygieneRanThisLoad) return;
  hygieneRanThisLoad = true;
  const cases = safeRead<AccreditationCase>(CASES_KEY);
  const invites = safeRead<VendorInvite>(INVITES_KEY);
  const result = cleanupCases(cases, invites);
  if (!result.changed) return;
  safeWrite(CASES_KEY, result.cases);
  // Intentionally timeline-free: hygiene is plumbing, not case activity.
  console.warn(
    `[legal] demo-data hygiene: repaired ${result.reassigned.length + result.dropped.length} inconsistent case(s) ` +
      `(${result.reassigned.map((k) => `${k.vendorName} → reassigned`).join(', ')}` +
      `${result.reassigned.length && result.dropped.length ? ', ' : ''}` +
      `${result.dropped.map((k) => `${k.vendorName} → dropped`).join(', ')}).`,
  );
}

// ---------------------------------------------------------------------------
// Shared hook wiring
// ---------------------------------------------------------------------------
function useTrackedRows<T>(key: string): [T[], (rows: T[]) => void, boolean] {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      seedOnce();
      migrateOnce();
      cleanupOnce();
    }
    setRows(safeRead<T>(key));
    setLoading(false);
    if (typeof window === 'undefined') return;
    const onChange = () => setRows(safeRead<T>(key));
    window.addEventListener(CHANGE_EVT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGE_EVT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [key]);

  const setPersisted = useCallback(
    (next: T[]) => {
      safeWrite(key, next);
      setRows(next);
    },
    [key],
  );

  return [rows, setPersisted, loading];
}

function appendTimeline(entry: Omit<CaseTimelineEntry, 'id' | 'at'>): void {
  const current = safeRead<CaseTimelineEntry>(TIMELINE_KEY);
  safeWrite(TIMELINE_KEY, [
    { ...entry, id: newId('tl'), at: nowIso() },
    ...current,
  ]);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
export interface AddCaseOptions {
  /** Tailoring axes from the invite wizard. When present the checklist is
   *  seeded from the requirement catalog instead of the legacy defaults. */
  profile?: TailoringProfile;
  /** Free-text country when jurisdiction is OTHER. */
  originCountry?: string;
  /** Vendor contact email captured on the invite. */
  contactEmail?: string;
}

export interface CasesAPI {
  rows: AccreditationCase[];
  loading: boolean;
  getById: (id: string) => AccreditationCase | undefined;
  addCase: (
    vendorId: string,
    vendorName: string,
    category?: string,
    actor?: string,
    opts?: AddCaseOptions,
  ) => AccreditationCase;
  submitCase: (
    id: string,
    actor?: string,
    signature?: CaseSignature,
  ) => AccreditationCase | null;
  decideCase: (
    id: string,
    decision: 'approved' | 'rejected',
    opts: {
      note?: string;
      expiresAt?: string;
      scope?: string;
      actor?: string;
      signature?: CaseSignature;
    },
  ) => AccreditationCase | null;
  /** Reviewer nudge: writes a timeline entry + bumps `lastReminderAt`. */
  sendReminder: (id: string, actor?: string) => AccreditationCase | null;
}

export function useAccreditationCases(): CasesAPI {
  const [rows, set, loading] = useTrackedRows<AccreditationCase>(CASES_KEY);

  const getById = useCallback((id: string) => rows.find((r) => r.id === id), [rows]);

  const addCase = useCallback<CasesAPI['addCase']>(
    (vendorId, vendorName, category, actor, opts) => {
      const profile = opts?.profile;
      // Renewal continuity (F2.3): link the vendor's latest prior case so
      // reviewers can reach last cycle's documents from the new case.
      const previousCaseId = derivePreviousCaseId(
        safeRead<AccreditationCase>(CASES_KEY),
        vendorId,
      );
      const next: AccreditationCase = {
        id: newId('case'),
        vendorId,
        vendorName,
        status: 'draft',
        openedAt: nowIso(),
        category,
        invitedByEmail: actor,
        contactEmail: opts?.contactEmail,
        previousCaseId,
        ...(profile
          ? {
              jurisdiction: profile.jurisdiction,
              originCountry: opts?.originCountry,
              entityType: profile.entityType,
              vendorCategory: profile.category,
              riskTier: profile.riskTier,
              contractType: profile.contractType,
              expectedAnnualSpend: profile.spendBand,
              handlesPersonalData: profile.handlesPersonalData,
            }
          : {}),
      };
      set([next, ...safeRead<AccreditationCase>(CASES_KEY)]);
      // Seed the checklist: tailored from the catalog when the wizard sent a
      // profile, otherwise the legacy defaults (migrated to v2 shape).
      const items: RequirementChecklistItem[] = profile
        ? buildTailoredChecklist(profile, next.id, () => newId('rq'))
        : migrateChecklist(
            DEFAULT_REQUIREMENTS.map((r) => ({
              ...r,
              id: newId('rq'),
              caseId: next.id,
              documentIds: [],
            })),
          ).rows;
      safeWrite(CHECKLIST_KEY, [...items, ...safeRead<RequirementChecklistItem>(CHECKLIST_KEY)]);
      const instrumentCount = items.filter((i) => i.instrument).length;
      appendTimeline({
        caseId: next.id,
        actorEmail: actor,
        action: 'created',
        detail: profile
          ? `Case opened for ${vendorName} — ${items.length} tailored requirements (${instrumentCount} signable instruments).`
          : `Case opened for ${vendorName}.`,
      });
      return next;
    },
    [set],
  );

  const patchCase = useCallback(
    (id: string, patch: Partial<AccreditationCase>): AccreditationCase | null => {
      const current = safeRead<AccreditationCase>(CASES_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const merged: AccreditationCase = { ...current[idx]!, ...patch };
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      return merged;
    },
    [set],
  );

  const submitCase = useCallback<CasesAPI['submitCase']>(
    (id, actor, signature) => {
      const merged = patchCase(id, {
        status: 'submitted',
        submittedAt: nowIso(),
        submissionSignature: signature,
      });
      if (merged) {
        appendTimeline({
          caseId: id,
          actorEmail: actor,
          action: 'submitted',
          detail: signature
            ? `Vendor submitted the intake for legal review — completeness attested and e-signed by ${signature.signerName}.`
            : 'Vendor submitted the intake for legal review.',
        });
      }
      return merged;
    },
    [patchCase],
  );

  const decideCase = useCallback<CasesAPI['decideCase']>(
    (id, decision, opts) => {
      const patch: Partial<AccreditationCase> = {
        status: decision === 'approved' ? 'approved' : 'rejected',
        decidedAt: nowIso(),
        decidedByEmail: opts.actor,
        decisionNote: opts.note,
        decisionSignature: opts.signature,
      };
      if (decision === 'approved') {
        patch.expiresAt = opts.expiresAt ?? daysAhead(365);
        patch.scope = opts.scope;
      }
      const merged = patchCase(id, patch);
      if (merged) {
        const signedBy = opts.signature
          ? ` E-signed by ${opts.signature.signerName}.`
          : '';
        appendTimeline({
          caseId: id,
          actorEmail: opts.actor,
          action: decision,
          detail:
            decision === 'approved'
              ? `Accreditation approved${opts.scope ? ` — scope: ${opts.scope}` : ''}${patch.expiresAt ? `, expires ${patch.expiresAt}` : ''}.${signedBy}`
              : `Accreditation rejected${opts.note ? ` — ${opts.note}` : ''}.${signedBy}`,
        });
      }
      return merged;
    },
    [patchCase],
  );

  const sendReminder = useCallback<CasesAPI['sendReminder']>(
    (id, actor) => {
      const merged = patchCase(id, { lastReminderAt: nowIso() });
      if (merged) {
        appendTimeline({
          caseId: id,
          actorEmail: actor,
          action: 'reminder_sent',
          detail: `Reminder sent to ${merged.contactEmail ?? merged.vendorName} to complete the outstanding requirements.`,
        });
      }
      return merged;
    },
    [patchCase],
  );

  return { rows, loading, getById, addCase, submitCase, decideCase, sendReminder };
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
export interface ChecklistAPI {
  rows: RequirementChecklistItem[];
  loading: boolean;
  forCase: (caseId: string) => RequirementChecklistItem[];
  review: (
    itemId: string,
    decision: ChecklistDecision,
    reviewer: { email?: string; note?: string },
  ) => RequirementChecklistItem | null;
  attach: (itemId: string, docId: string) => void;
}

export function useChecklist(): ChecklistAPI {
  const [rows, set, loading] = useTrackedRows<RequirementChecklistItem>(CHECKLIST_KEY);

  const forCase = useCallback(
    (caseId: string) => rows.filter((r) => r.caseId === caseId),
    [rows],
  );

  const patchItem = useCallback(
    (itemId: string, patch: Partial<RequirementChecklistItem>) => {
      const current = safeRead<RequirementChecklistItem>(CHECKLIST_KEY);
      const idx = current.findIndex((r) => r.id === itemId);
      if (idx < 0) return null;
      const merged: RequirementChecklistItem = { ...current[idx]!, ...patch };
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      return merged;
    },
    [set],
  );

  const review = useCallback<ChecklistAPI['review']>(
    (itemId, decision, reviewer) => {
      const merged = patchItem(itemId, {
        decision,
        reviewerEmail: reviewer.email,
        reviewedAt: nowIso(),
        reviewerNote: reviewer.note,
      });
      if (merged) {
        appendTimeline({
          caseId: merged.caseId,
          actorEmail: reviewer.email,
          action: 'checklist_decided',
          detail: `${merged.requirement} → ${decision}${reviewer.note ? ` (${reviewer.note})` : ''}.`,
        });
      }
      return merged;
    },
    [patchItem],
  );

  const attach = useCallback(
    (itemId: string, docId: string) => {
      const current = safeRead<RequirementChecklistItem>(CHECKLIST_KEY);
      const idx = current.findIndex((r) => r.id === itemId);
      if (idx < 0) return;
      const item = current[idx]!;
      if (item.documentIds.includes(docId)) return;
      const nextList = current.slice();
      nextList[idx] = { ...item, documentIds: [...item.documentIds, docId] };
      set(nextList);
    },
    [set],
  );

  return { rows, loading, forCase, review, attach };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export interface DocsAPI {
  rows: AccreditationDoc[];
  loading: boolean;
  forCase: (caseId: string) => AccreditationDoc[];
  forRequirement: (itemId: string) => AccreditationDoc[];
  upload: (input: {
    caseId: string;
    vendorId: string;
    requirementId?: string;
    docType: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl?: string;
    expiresAt?: string;
    uploadedByEmail?: string;
  }) => AccreditationDoc;
  setStatus: (docId: string, status: DocumentStatus, actor?: string, note?: string) => AccreditationDoc | null;
}

export function useAccreditationDocs(): DocsAPI {
  const [rows, set, loading] = useTrackedRows<AccreditationDoc>(DOCS_KEY);

  const forCase = useCallback(
    (caseId: string) => rows.filter((r) => r.caseId === caseId),
    [rows],
  );
  const forRequirement = useCallback(
    (itemId: string) => rows.filter((r) => r.requirementId === itemId),
    [rows],
  );

  const upload = useCallback<DocsAPI['upload']>(
    (input) => {
      const versionExisting = safeRead<AccreditationDoc>(DOCS_KEY).filter(
        (r) => r.caseId === input.caseId && r.docType === input.docType,
      );
      const doc: AccreditationDoc = {
        id: newId('doc'),
        caseId: input.caseId,
        vendorId: input.vendorId,
        requirementId: input.requirementId,
        docType: input.docType,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        dataUrl: input.dataUrl,
        status: 'submitted',
        version: versionExisting.length + 1,
        uploadedAt: nowIso(),
        uploadedByEmail: input.uploadedByEmail,
        expiresAt: input.expiresAt,
      };
      set([doc, ...safeRead<AccreditationDoc>(DOCS_KEY)]);
      appendTimeline({
        caseId: input.caseId,
        actorEmail: input.uploadedByEmail,
        action: 'doc_uploaded',
        detail: `${input.docType} · ${input.filename} (v${doc.version})`,
      });
      return doc;
    },
    [set],
  );

  const setStatus = useCallback<DocsAPI['setStatus']>(
    (docId, status, actor, note) => {
      const current = safeRead<AccreditationDoc>(DOCS_KEY);
      const idx = current.findIndex((r) => r.id === docId);
      if (idx < 0) return null;
      const merged: AccreditationDoc = {
        ...current[idx]!,
        status,
        reviewerNote: note,
      };
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      appendTimeline({
        caseId: merged.caseId,
        actorEmail: actor,
        action: 'doc_reviewed',
        detail: `${merged.docType} · ${merged.filename} → ${status}${note ? ` (${note})` : ''}`,
      });
      return merged;
    },
    [set],
  );

  return { rows, loading, forCase, forRequirement, upload, setStatus };
}

// ---------------------------------------------------------------------------
// Signed instruments (NDA / DPA / declarations — DocuSign-style records)
// ---------------------------------------------------------------------------

export interface SignInstrumentInput {
  caseId: string;
  /** Catalog instrument code (`SIGN_NDA`) or template code (`nda_mutual`). */
  code: string;
  /** Template version snapshot so historical signatures stay traceable. */
  templateVersion: string;
  signerName: string;
  signerEmail?: string;
  signerTitle?: string;
  /** PNG data URL from @intra/ui SignaturePad. */
  signaturePng: string;
  signatureMethod: 'drawn' | 'typed';
  signerUa: string;
  /** Captured disclosure field values, when the template declares fields. */
  fields?: Record<string, string>;
}

export interface SignedInstrumentsAPI {
  rows: SignedInstrument[];
  loading: boolean;
  forCase: (caseId: string) => SignedInstrument[];
  /** Latest non-revoked signature for an instrument code on a case. */
  findSigned: (caseId: string, code: string) => SignedInstrument | undefined;
  sign: (input: SignInstrumentInput) => SignedInstrument;
}

/**
 * Persist a signed instrument + timeline entry. Exported standalone (not just
 * via the hook) so the sign page can commit synchronously inside an event
 * handler and tests can exercise persistence without React.
 */
export function signInstrument(input: SignInstrumentInput): SignedInstrument {
  const record: SignedInstrument = {
    id: newId('sig'),
    caseId: input.caseId,
    code: input.code,
    templateVersion: input.templateVersion,
    signerName: input.signerName,
    signerEmail: input.signerEmail,
    signerTitle: input.signerTitle,
    signaturePng: input.signaturePng,
    signatureMethod: input.signatureMethod,
    signedAt: nowIso(),
    signerUa: input.signerUa,
    fields: input.fields,
  };
  safeWrite(SIGNED_KEY, [record, ...safeRead<SignedInstrument>(SIGNED_KEY)]);
  appendTimeline({
    caseId: input.caseId,
    actorEmail: input.signerEmail,
    action: 'instrument_signed',
    detail: `${input.code} (v${input.templateVersion}) e-signed by ${input.signerName} (${input.signatureMethod}).`,
  });
  return record;
}

export function useSignedInstruments(): SignedInstrumentsAPI {
  const [rows, , loading] = useTrackedRows<SignedInstrument>(SIGNED_KEY);

  const forCase = useCallback(
    (caseId: string) => rows.filter((r) => r.caseId === caseId),
    [rows],
  );
  const findSigned = useCallback(
    (caseId: string, code: string) =>
      rows.find((r) => r.caseId === caseId && r.code === code && !r.revokedAt),
    [rows],
  );
  const sign = useCallback((input: SignInstrumentInput) => signInstrument(input), []);

  return { rows, loading, forCase, findSigned, sign };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
export function useCaseTimeline(caseId?: string): { rows: CaseTimelineEntry[]; loading: boolean } {
  const [rows, , loading] = useTrackedRows<CaseTimelineEntry>(TIMELINE_KEY);
  const filtered = useMemo(
    () => (caseId ? rows.filter((r) => r.caseId === caseId) : rows),
    [rows, caseId],
  );
  return { rows: filtered, loading };
}

// ---------------------------------------------------------------------------
// Vendor invites (Legal → Vendor onboarding)
// ---------------------------------------------------------------------------
export interface InviteInput {
  email: string;
  companyName: string;
  category?: string;
  actor?: string;
  /** v2: tailoring axes captured by the invite wizard. */
  profile?: TailoringProfile;
  originCountry?: string;
}

export interface InvitesAPI {
  rows: VendorInvite[];
  loading: boolean;
  invite: (input: InviteInput) => VendorInvite;
}

export function useVendorInvites(): InvitesAPI {
  const [rows, set, loading] = useTrackedRows<VendorInvite>(INVITES_KEY);
  const invite = useCallback<InvitesAPI['invite']>(
    (input) => {
      const next: VendorInvite = {
        id: newId('inv'),
        email: input.email,
        companyName: input.companyName,
        category: input.category,
        createdAt: nowIso(),
        createdByEmail: input.actor,
        status: 'sent',
        ...(input.profile
          ? {
              jurisdiction: input.profile.jurisdiction,
              originCountry: input.originCountry,
              entityType: input.profile.entityType,
              vendorCategory: input.profile.category,
              riskTier: input.profile.riskTier,
              contractType: input.profile.contractType,
              expectedAnnualSpend: input.profile.spendBand,
              handlesPersonalData: input.profile.handlesPersonalData,
            }
          : {}),
      };
      set([next, ...safeRead<VendorInvite>(INVITES_KEY)]);
      // Demo vendor identity provisioning (F1.3): persist a login alias
      // (contact email → the `ven-<inviteId>` vendor this invite mints) so
      // the vendor-scoping checks (vendorAccess.matchesVendor) can accept a
      // memory-mode session signed in with the invited email. Demo-only
      // bridge — the shell's SessionProvider/demoProfiles are untouched, and
      // live mode replaces this with real vendor profiles + RLS.
      const aliases = safeRead<VendorLoginAlias>(ALIASES_KEY);
      const email = input.email.trim().toLowerCase();
      if (!aliases.some((a) => a.email === email)) {
        safeWrite(ALIASES_KEY, [
          {
            email,
            vendorId: `ven-${next.id}`,
            companyName: input.companyName,
            createdAt: next.createdAt,
          },
          ...aliases,
        ]);
      }
      return next;
    },
    [set],
  );
  return { rows, loading, invite };
}

// ---------------------------------------------------------------------------
// Vendor login aliases (demo bridge, see useVendorInvites.invite)
// ---------------------------------------------------------------------------
export function useVendorAliases(): {
  rows: VendorLoginAlias[];
  loading: boolean;
} {
  const [rows, , loading] = useTrackedRows<VendorLoginAlias>(ALIASES_KEY);
  return { rows, loading };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
export function isExpiringSoon(iso: string | undefined, days = 30): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  const soon = Date.now() + days * 86_400_000;
  return t <= soon;
}
export function computeCaseStatus(kase: AccreditationCase): CaseStatus {
  if (kase.status === 'approved' && kase.expiresAt) {
    const t = new Date(kase.expiresAt).getTime();
    if (t < Date.now()) return 'expired';
    if (isExpiringSoon(kase.expiresAt, 30)) return 'renewal_due';
  }
  return kase.status;
}
