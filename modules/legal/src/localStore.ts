// Local-only legal store (preview build).
//
// The real repository adapter (@intra/core-data + legal.* RPCs) lands
// post-MVP; until then we persist accreditation cases, checklist items,
// documents, timeline entries, and vendor invites to localStorage so the
// entire accreditation workflow (invite → onboard → docs → checklist →
// approve → renew) is clickable end-to-end.
//
// Namespaced under `intra.legal.v1.*` so a future migration is clean.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
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
  normalizeChecklistDecision,
} from './caseLogic';
import { cleanupCases } from './hygiene';
import { buildLegalSeed } from './seed';
import type { VendorLoginAlias } from './vendorAccess';
import type { TailoringProfile } from './requirements/policy';
import {
  resolveVendorInviteDelivery,
  type VendorInviteDeliveryEnvelope,
} from './vendorInviteDelivery';

type MaybePromise<T> = T | Promise<T>;
type LiveClient = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type UploadDocInput = {
  caseId: string;
  vendorId: string;
  requirementId?: string;
  docType: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
  storagePath?: string;
  expiresAt?: string;
  uploadedByEmail?: string;
};
type LiveProfile = Record<string, never> & {
  readonly jurisdiction: never;
  readonly originCountry: never;
  readonly entityType: never;
  readonly category: never;
  readonly riskTier: never;
  readonly contractType: never;
  readonly spendBand: never;
  readonly handlesPersonalData: never;
};
type LiveRow = Record<string, never> & {
  readonly id: never;
  readonly vendor_id: never;
  readonly vendor_name: never;
  readonly status: never;
  readonly opened_at: never;
  readonly case_id: never;
  readonly requirement: never;
  readonly required: never;
  readonly instrument: never;
  readonly doc_type: never;
  readonly filename: never;
  readonly mime_type: never;
  readonly uploaded_at: never;
  readonly at: never;
  readonly action: never;
  readonly email: never;
  readonly company_name: never;
  readonly created_at: never;
  readonly code: never;
  readonly template_version: never;
  readonly signer_name: never;
  readonly signed_at: never;
  readonly profile?: LiveProfile;
};
type LiveQueryError = { readonly message: string };
type InviteVendorRpcResult = LiveRow & {
  readonly invite?: LiveRow;
  readonly case?: LiveRow;
  readonly vendor?: LiveRow;
};

function useLiveClient(): LiveClient | null {
  const { mode, supabaseClient } = useSession();
  return mode === 'supabase' ? (supabaseClient as LiveClient | null) : null;
}

function isLive(client: LiveClient | null): client is LiveClient {
  return Boolean(client);
}

async function liveRpc<T>(
  client: LiveClient,
  schema: 'legal',
  fn: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.schema(schema).rpc(fn, { payload });
  if (error) throw new Error(error.message);
  return data as T;
}

function storageSafeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'document';
}

async function uploadLiveAccreditationDocument(
  client: LiveClient,
  input: UploadDocInput,
): Promise<string | undefined> {
  if (!input.dataUrl?.startsWith('data:')) return input.storagePath;

  const objectPath =
    input.storagePath ??
    [
      'vendor',
      storageSafeSegment(input.vendorId),
      'legal',
      'accreditation',
      storageSafeSegment(input.caseId),
      `${globalThis.crypto?.randomUUID?.() ?? Date.now()}_${storageSafeSegment(input.filename)}`,
    ].join('/');

  const blob = await fetch(input.dataUrl).then((res) => res.blob());
  const { error } = await client.storage.from('documents').upload(objectPath, blob, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return objectPath;
}

function useLiveRows<T>(
  client: LiveClient | null,
  table: string,
  map: (row: LiveRow) => T,
  order?: { column: string; ascending?: boolean },
): [T[], boolean, () => Promise<void>] {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(client));
  const mapRef = useRef(map);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  const refresh = useCallback(async () => {
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = client.schema('legal').from(table).select('*');
      if (order) {
        query = query.order(order.column, { ascending: order.ascending ?? false });
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      setRows((data ?? []).map(mapRef.current));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [client, table, order?.column, order?.ascending]);

  useEffect(() => {
    let active = true;
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = client.schema('legal').from(table).select('*');
    if (order) {
      query = query.order(order.column, { ascending: order.ascending ?? false });
    }
    Promise.resolve(query)
      .then(({ data, error }: { data: LiveRow[] | null; error: LiveQueryError | null }) => {
        if (!active) return;
        if (error) throw error;
        setRows((data ?? []).map(mapRef.current));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setRows([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, table, order?.column, order?.ascending]);

  return [rows, loading, refresh];
}

function mapCase(row: LiveRow): AccreditationCase {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    status: row.status,
    openedAt: row.opened_at,
    submittedAt: row.submitted_at ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    decidedByEmail: row.decided_by_email ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    category: row.category ?? undefined,
    jurisdiction: row.jurisdiction ?? undefined,
    originCountry: row.origin_country ?? undefined,
    entityType: row.entity_type ?? undefined,
    vendorCategory: row.vendor_category ?? undefined,
    riskTier: row.risk_tier ?? undefined,
    contractType: row.contract_type ?? undefined,
    expectedAnnualSpend: row.expected_annual_spend ?? undefined,
    handlesPersonalData: row.handles_personal_data ?? undefined,
    lastReminderAt: row.last_reminder_at ?? undefined,
    invitedByEmail: row.invited_by_email ?? undefined,
    contactEmail: row.contact_email ?? undefined,
  } as AccreditationCase;
}

function mapChecklist(row: LiveRow): RequirementChecklistItem {
  return {
    id: row.id,
    caseId: row.case_id,
    code: row.code ?? undefined,
    requirement: row.requirement,
    description: row.description ?? undefined,
    whyWeNeedIt: row.why_we_need_it ?? undefined,
    helpUrl: row.help_url ?? undefined,
    authority: row.authority ?? undefined,
    evidenceFormat: row.evidence_format ?? undefined,
    group: row.requirement_group ?? undefined,
    required: Boolean(row.required),
    instrument: Boolean(row.instrument),
    instrumentCode: row.instrument_code ?? undefined,
    templateVersion: row.template_version ?? undefined,
    renewsAfterMonths: row.renews_after_months ?? undefined,
    decision: normalizeChecklistDecision(row.decision),
    reviewerEmail: row.reviewer_email ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewerNote: row.reviewer_note ?? undefined,
    documentIds: row.document_ids ?? [],
  } as RequirementChecklistItem;
}

function mapDoc(row: LiveRow): AccreditationDoc {
  return {
    id: row.id,
    caseId: row.case_id,
    vendorId: row.vendor_id,
    requirementId: row.requirement_id ?? undefined,
    docType: row.doc_type,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    dataUrl: row.data_url ?? undefined,
    storagePath: row.storage_path ?? undefined,
    status: row.status,
    version: Number(row.version ?? 1),
    uploadedAt: row.uploaded_at,
    uploadedByEmail: row.uploaded_by_email ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    reviewerNote: row.reviewer_note ?? undefined,
  };
}

function mapTimeline(row: LiveRow): CaseTimelineEntry {
  return {
    id: row.id,
    caseId: row.case_id,
    at: row.at,
    actorEmail: row.actor_email ?? undefined,
    action: row.action,
    detail: row.detail ?? undefined,
  };
}

function mapInvite(row: LiveRow): VendorInvite {
  const deliveryStatus = row.status === 'delivery_failed' ? 'delivery_failed' : 'sent';
  return {
    id: row.id,
    email: row.email,
    companyName: row.company_name,
    category: row.category ?? undefined,
    createdAt: row.created_at,
    createdByEmail: row.created_by_email ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    status: row.status,
    deliveryStatus,
    deliveryError: row.delivery_error ?? undefined,
    vendorId: row.vendor_id ?? undefined,
    caseId: row.case_id ?? undefined,
    jurisdiction: row.profile?.jurisdiction ?? undefined,
    originCountry: row.profile?.originCountry ?? undefined,
    entityType: row.profile?.entityType ?? undefined,
    vendorCategory: row.profile?.category ?? undefined,
    riskTier: row.profile?.riskTier ?? undefined,
    contractType: row.profile?.contractType ?? undefined,
    expectedAnnualSpend: row.profile?.spendBand ?? undefined,
    handlesPersonalData: row.profile?.handlesPersonalData ?? undefined,
  } as VendorInvite;
}

function mapSigned(row: LiveRow): SignedInstrument {
  return {
    id: row.id,
    caseId: row.case_id,
    code: row.code,
    templateVersion: row.template_version,
    signerName: row.signer_name,
    signerEmail: row.signer_email ?? undefined,
    signerTitle: row.signer_title ?? undefined,
    signaturePng: row.signature_png ?? '',
    signatureMethod: row.signature_method ?? 'typed',
    signedAt: row.signed_at,
    signerUa: row.signer_ua ?? '',
    fields: row.fields ?? undefined,
    documentHash: row.document_hash ?? undefined,
    signerParty: row.signer_party ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedByEmail: row.revoked_by_email ?? undefined,
  };
}

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
function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22)
  );
}
function safeWrite<T>(key: string, rows: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(new Event(CHANGE_EVT));
  } catch (err) {
    // Surface quota failures instead of silently dropping the write.
    if (isQuotaError(err)) {
      window.dispatchEvent(
        new CustomEvent('intra:storage-full', { detail: { key } }),
      );
    }
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
function useTrackedRows<T>(
  key: string,
  enabled = true,
): [T[], (rows: T[]) => void, boolean] {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
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
  }, [key, enabled]);

  const setPersisted = useCallback(
    (next: T[]) => {
      if (!enabled) return;
      safeWrite(key, next);
      setRows(next);
    },
    [key, enabled],
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
  ) => MaybePromise<AccreditationCase>;
  submitCase: (
    id: string,
    actor?: string,
    signature?: CaseSignature,
  ) => MaybePromise<AccreditationCase | null>;
  decideCase: (
    id: string,
    decision: 'approved' | 'rejected' | 'provisional',
    opts: {
      note?: string;
      expiresAt?: string;
      scope?: string;
      actor?: string;
      signature?: CaseSignature;
    },
  ) => MaybePromise<AccreditationCase | null>;
  /** Reviewer nudge: writes a timeline entry + bumps `lastReminderAt`. */
  sendReminder: (id: string, actor?: string) => MaybePromise<AccreditationCase | null>;
}

export function useAccreditationCases(): CasesAPI {
  const live = useLiveClient();
  const [localRows, set, localLoading] = useTrackedRows<AccreditationCase>(
    CASES_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading, refreshLive] = useLiveRows<AccreditationCase>(
    live,
    'accreditation_cases',
    mapCase,
    { column: 'opened_at', ascending: false },
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;

  const getById = useCallback((id: string) => rows.find((r) => r.id === id), [rows]);

  const addCase = useCallback<CasesAPI['addCase']>(
    (vendorId, vendorName, category, actor, opts) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'create_accreditation_case', {
          vendor_id: vendorId,
          vendor_name: vendorName,
          category,
          actor_email: actor,
          profile: opts?.profile,
          origin_country: opts?.originCountry,
          contact_email: opts?.contactEmail,
        }).then((row) => {
          const mapped = mapCase(row);
          return refreshLive().then(() => mapped);
        });
      }
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
    [set, live, refreshLive],
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
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'submit_accreditation_case', {
          id,
          actor_email: actor,
          signature,
        }).then((row) => {
          const mapped = mapCase(row);
          return refreshLive().then(() => mapped);
        });
      }
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
    [patchCase, live, refreshLive],
  );

  const decideCase = useCallback<CasesAPI['decideCase']>(
    (id, decision, opts) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'approve_accreditation_case', {
          id,
          decision,
          note: opts.note,
          expires_at: opts.expiresAt,
          scope: opts.scope,
          actor_email: opts.actor,
          signature: opts.signature,
        }).then((row) => {
          const mapped = mapCase(row);
          return refreshLive().then(() => mapped);
        });
      }
      // Defense-in-depth (the UI also gates): never approve a case while a
      // required checklist item is still unresolved. Signing an instrument
      // marks its item approved (see signInstrument), so this stays reachable.
      if (decision === 'approved') {
        const items = safeRead<RequirementChecklistItem>(CHECKLIST_KEY).filter(
          (i) => i.caseId === id,
        );
        const required = items.filter((i) => i.required);
        const allResolved = required.every(
          (i) => i.decision === 'approved' || i.decision === 'na',
        );
        if (required.length === 0 || !allResolved) return null;
      }
      const status: AccreditationCase['status'] =
        decision === 'approved'
          ? 'approved'
          : decision === 'provisional'
            ? 'provisional'
            : 'rejected';
      const patch: Partial<AccreditationCase> = {
        status,
        decidedAt: nowIso(),
        decidedByEmail: opts.actor,
        decisionNote: opts.note,
        decisionSignature: opts.signature,
      };
      if (decision === 'approved') {
        patch.expiresAt = opts.expiresAt ?? daysAhead(365);
        patch.scope = opts.scope;
      } else if (decision === 'provisional') {
        // Time-limited clearance — short expiry so the vendor must finish the
        // outstanding requirements to convert to full accreditation.
        patch.expiresAt = opts.expiresAt ?? daysAhead(60);
        patch.scope = opts.scope;
      }
      const merged = patchCase(id, patch);
      if (merged) {
        const signedBy = opts.signature
          ? ` E-signed by ${opts.signature.signerName}.`
          : '';
        const detail =
          decision === 'approved'
            ? `Accreditation approved${opts.scope ? ` — scope: ${opts.scope}` : ''}${patch.expiresAt ? `, expires ${patch.expiresAt}` : ''}.${signedBy}`
            : decision === 'provisional'
              ? `Temporary clearance granted${opts.scope ? ` — scope: ${opts.scope}` : ''}${patch.expiresAt ? `, expires ${patch.expiresAt}` : ''}.${signedBy}`
              : `Accreditation rejected${opts.note ? ` — ${opts.note}` : ''}.${signedBy}`;
        appendTimeline({
          caseId: id,
          actorEmail: opts.actor,
          action: decision,
          detail,
        });
      }
      return merged;
    },
    [patchCase, live, refreshLive],
  );

  const sendReminder = useCallback<CasesAPI['sendReminder']>(
    (id, actor) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'send_accreditation_reminder', {
          id,
          actor_email: actor,
        }).then((row) => {
          const mapped = mapCase(row);
          return refreshLive().then(() => mapped);
        });
      }
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
    [patchCase, live, refreshLive],
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
  ) => MaybePromise<RequirementChecklistItem | null>;
  attach: (itemId: string, docId: string) => MaybePromise<void>;
}

export function useChecklist(): ChecklistAPI {
  const live = useLiveClient();
  const [localRows, set, localLoading] = useTrackedRows<RequirementChecklistItem>(
    CHECKLIST_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading, refreshLive] =
    useLiveRows<RequirementChecklistItem>(
      live,
      'requirement_checklist_items',
      mapChecklist,
      { column: 'created_at', ascending: true },
    );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;

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
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'review_checklist_item', {
          id: itemId,
          item_id: itemId,
          decision,
          reviewer_email: reviewer.email,
          reviewer_note: reviewer.note,
          note: reviewer.note,
        }).then((row) => {
          const mapped = mapChecklist(row);
          return refreshLive().then(() => mapped);
        });
      }
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
    [patchItem, live, refreshLive],
  );

  const attach = useCallback(
    (itemId: string, docId: string) => {
      if (isLive(live)) {
        return Promise.resolve();
      }
      const current = safeRead<RequirementChecklistItem>(CHECKLIST_KEY);
      const idx = current.findIndex((r) => r.id === itemId);
      if (idx < 0) return;
      const item = current[idx]!;
      if (item.documentIds.includes(docId)) return;
      const nextList = current.slice();
      nextList[idx] = { ...item, documentIds: [...item.documentIds, docId] };
      set(nextList);
    },
    [set, live],
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
  upload: (input: UploadDocInput) => MaybePromise<AccreditationDoc>;
  setStatus: (docId: string, status: DocumentStatus, actor?: string, note?: string) => MaybePromise<AccreditationDoc | null>;
}

export function useAccreditationDocs(): DocsAPI {
  const live = useLiveClient();
  const [localRows, set, localLoading] = useTrackedRows<AccreditationDoc>(
    DOCS_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading, refreshLive] = useLiveRows<AccreditationDoc>(
    live,
    'accreditation_docs',
    mapDoc,
    { column: 'uploaded_at', ascending: false },
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;

  const forCase = useCallback(
    (caseId: string) => rows.filter((r) => r.caseId === caseId),
    [rows],
  );
  const forRequirement = useCallback(
    (itemId: string) => rows.filter((r) => r.requirementId === itemId),
    [rows],
  );

  const upload = useCallback<DocsAPI['upload']>(
    async (input) => {
      if (isLive(live)) {
        const storagePath = await uploadLiveAccreditationDocument(live, input);
        return liveRpc<LiveRow>(live, 'legal', 'upload_accreditation_doc', {
          case_id: input.caseId,
          vendor_id: input.vendorId,
          requirement_id: input.requirementId,
          doc_type: input.docType,
          filename: input.filename,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          storage_path: storagePath,
          expires_at: input.expiresAt,
          uploaded_by_email: input.uploadedByEmail,
        }).then((row) => {
          const mapped = mapDoc(row);
          return refreshLive().then(() => mapped);
        });
      }
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
        storagePath: input.storagePath,
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
    [set, live, refreshLive],
  );

  const setStatus = useCallback<DocsAPI['setStatus']>(
    (docId, status, actor, note) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'update_accreditation_doc_status', {
          doc_id: docId,
          status,
          actor_email: actor,
          note,
        }).then((row) => {
          const mapped = mapDoc(row);
          return refreshLive().then(() => mapped);
        });
      }
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
    [set, live, refreshLive],
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
  documentHash?: string;
  canonicalText?: string;
  signerParty?: 'service_provider' | 'mphtc';
}

export interface SignedInstrumentsAPI {
  rows: SignedInstrument[];
  loading: boolean;
  forCase: (caseId: string) => SignedInstrument[];
  /** Latest non-revoked signature for an instrument code on a case. */
  findSigned: (caseId: string, code: string) => SignedInstrument | undefined;
  sign: (input: SignInstrumentInput) => MaybePromise<SignedInstrument>;
}

/**
 * Persist a signed instrument + timeline entry. Exported standalone (not just
 * via the hook) so the sign page can commit synchronously inside an event
 * handler and tests can exercise persistence without React.
 */
export function signInstrument(input: SignInstrumentInput): SignedInstrument {
  const existing = safeRead<SignedInstrument>(SIGNED_KEY);
  const governedMnda = input.templateVersion.startsWith('mnda-tech-service-provider-');
  if (governedMnda) {
    if (!input.documentHash?.match(/^[a-f0-9]{64}$/) || !input.signerParty) {
      throw new Error('Governed MNDA signatures require a SHA-256 document hash and signer party.');
    }
    const instrumentRows = existing.filter(
      (row) => row.caseId === input.caseId && row.code === input.code && !row.revokedAt,
    );
    if (instrumentRows.some((row) => row.signerParty === input.signerParty)) {
      throw new Error('This party has already signed the governed MNDA.');
    }
    if (instrumentRows.some((row) => row.documentHash !== input.documentHash)) {
      throw new Error('Both MNDA parties must sign the same document hash.');
    }
  }
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
    documentHash: input.documentHash,
    signerParty: input.signerParty,
  };
  const nextSigned = [record, ...existing];
  safeWrite(SIGNED_KEY, nextSigned);
  // Signing a legal instrument IS its fulfillment — there is no separate
  // reviewer decision path for instrument rows (they route to the sign page).
  // Mark the matching checklist item(s) approved so `readyForDecision` (all
  // required items approved) becomes reachable for real, non-seeded cases.
  const checklist = safeRead<RequirementChecklistItem>(CHECKLIST_KEY);
  let checklistChanged = false;
  const nextChecklist = checklist.map((item) => {
    const hasBothMndaParties =
      !governedMnda ||
      (nextSigned.some(
        (row) =>
          row.caseId === input.caseId &&
          row.code === input.code &&
          row.documentHash === input.documentHash &&
          row.signerParty === 'service_provider' &&
          !row.revokedAt,
      ) &&
        nextSigned.some(
          (row) =>
            row.caseId === input.caseId &&
            row.code === input.code &&
            row.documentHash === input.documentHash &&
            row.signerParty === 'mphtc' &&
            !row.revokedAt,
        ));
    const matches =
      item.caseId === input.caseId &&
      item.instrument &&
      (item.instrumentCode === input.code || item.code === input.code) &&
      hasBothMndaParties &&
      item.decision !== 'approved';
    if (!matches) return item;
    checklistChanged = true;
    return {
      ...item,
      decision: 'approved' as const,
      reviewedAt: nowIso(),
      reviewerEmail: input.signerEmail,
      reviewerNote: `Satisfied by e-signature (${input.code} v${input.templateVersion}).`,
    };
  });
  if (checklistChanged) safeWrite(CHECKLIST_KEY, nextChecklist);
  appendTimeline({
    caseId: input.caseId,
    actorEmail: input.signerEmail,
    action: 'instrument_signed',
    detail: `${input.code} (v${input.templateVersion}) e-signed by ${input.signerName} (${input.signatureMethod}).`,
  });
  return record;
}

export function useSignedInstruments(): SignedInstrumentsAPI {
  const live = useLiveClient();
  const [localRows, , localLoading] = useTrackedRows<SignedInstrument>(
    SIGNED_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading, refreshLive] = useLiveRows<SignedInstrument>(
    live,
    'signed_instruments',
    mapSigned,
    { column: 'signed_at', ascending: false },
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;

  const forCase = useCallback(
    (caseId: string) => rows.filter((r) => r.caseId === caseId),
    [rows],
  );
  const findSigned = useCallback(
    (caseId: string, code: string) =>
      rows.find((r) => r.caseId === caseId && r.code === code && !r.revokedAt),
    [rows],
  );
  const sign = useCallback(
    (input: SignInstrumentInput) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'legal', 'sign_instrument', {
          case_id: input.caseId,
          code: input.code,
          template_version: input.templateVersion,
          signer_name: input.signerName,
          signer_email: input.signerEmail,
          signer_title: input.signerTitle,
          signature_png: input.signaturePng,
          signature_method: input.signatureMethod,
          signer_ua: input.signerUa,
          fields: input.fields,
          document_hash: input.documentHash,
          canonical_text: input.canonicalText,
          signer_party: input.signerParty,
        }).then((row) => {
          const mapped = mapSigned(row);
          return refreshLive().then(() => mapped);
        });
      }
      return signInstrument(input);
    },
    [live, refreshLive],
  );

  return { rows, loading, forCase, findSigned, sign };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
export function useCaseTimeline(caseId?: string): { rows: CaseTimelineEntry[]; loading: boolean } {
  const live = useLiveClient();
  const [localRows, , localLoading] = useTrackedRows<CaseTimelineEntry>(
    TIMELINE_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading] = useLiveRows<CaseTimelineEntry>(
    live,
    'case_timeline',
    mapTimeline,
    { column: 'at', ascending: false },
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;
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
  invite: (input: InviteInput) => MaybePromise<VendorInvite>;
  retry: (inviteId: string) => MaybePromise<VendorInvite>;
}

async function mapInviteDeliveryResponse(
  response: Response,
  refresh: () => Promise<void>,
): Promise<VendorInvite> {
  const result = (await response.json().catch(() => ({}))) as
    | (InviteVendorRpcResult & VendorInviteDeliveryEnvelope)
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      'error' in result && result.error
        ? result.error
        : 'Vendor invitation delivery failed.',
    );
  }
  const resolved = resolveVendorInviteDelivery(
    result as InviteVendorRpcResult & VendorInviteDeliveryEnvelope,
  );
  const mapped: VendorInvite = {
    ...mapInvite(resolved.inviteRow as LiveRow),
    caseId: resolved.caseId,
    vendorId: resolved.vendorId,
    status: resolved.deliveryStatus,
    deliveryStatus: resolved.deliveryStatus,
    deliveryError: resolved.deliveryError,
  };
  await refresh();
  return mapped;
}

export function useVendorInvites(): InvitesAPI {
  const live = useLiveClient();
  const [localRows, set, localLoading] = useTrackedRows<VendorInvite>(
    INVITES_KEY,
    !isLive(live),
  );
  const [liveRows, liveLoading, refreshLive] = useLiveRows<VendorInvite>(
    live,
    'vendor_invites',
    mapInvite,
    { column: 'created_at', ascending: false },
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveLoading : localLoading;
  const invite = useCallback<InvitesAPI['invite']>(
    (input) => {
      if (isLive(live)) {
        return fetch('/api/legal/vendor-invites', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: input.email.trim(),
            company_name: input.companyName.trim(),
            category: input.category,
            actor_email: input.actor,
            profile: input.profile,
            origin_country: input.originCountry,
          }),
        }).then((response) => mapInviteDeliveryResponse(response, refreshLive));
      }
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
    [set, live, refreshLive],
  );
  const retry = useCallback<InvitesAPI['retry']>(
    (inviteId) => {
      if (!isLive(live)) {
        const existing = safeRead<VendorInvite>(INVITES_KEY).find(
          (row) => row.id === inviteId,
        );
        if (!existing) throw new Error('Vendor invite not found.');
        return existing;
      }
      return fetch('/api/legal/vendor-invites', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_id: inviteId }),
      }).then((response) => mapInviteDeliveryResponse(response, refreshLive));
    },
    [live, refreshLive],
  );
  return { rows, loading, invite, retry };
}

// ---------------------------------------------------------------------------
// Vendor login aliases (demo bridge, see useVendorInvites.invite)
// ---------------------------------------------------------------------------
export function useVendorAliases(): {
  rows: VendorLoginAlias[];
  loading: boolean;
} {
  const live = useLiveClient();
  const [rows, , loading] = useTrackedRows<VendorLoginAlias>(
    ALIASES_KEY,
    !isLive(live),
  );
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
  // Provisional clearance lapses to expired once its short window passes.
  if (kase.status === 'provisional' && kase.expiresAt) {
    if (new Date(kase.expiresAt).getTime() < Date.now()) return 'expired';
  }
  return kase.status;
}
