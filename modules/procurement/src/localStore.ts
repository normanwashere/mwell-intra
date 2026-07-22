// Local-only procurement store (preview build).
//
// The real repository adapter (@intra/core-data + procurement.* RPCs) lands
// post-MVP; until then we persist requests + POs + approval decisions to
// localStorage so every UX path (draft → submit → approve → PO → issue) is
// clickable end-to-end. Keys are namespaced under `intra.procurement.v2.*`
// (bumped from v1 to accommodate line items) so the switch to real RPCs can
// migrate cleanly.
//
// Step 3b adds policy-aligned multi-tier approvals:
//   • `submit()` builds the approval ladder from category + amount + sourcing.
//   • `decide()` advances one tier at a time. Approval on the last tier flips
//     the request to `approved`; a rejection at any tier terminates.
//
// TODO(procurement live): mirror the ladder + attachment persistence in
// procurement.submit_request / procurement.decide_request RPCs when they land.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCan, useSession } from '@intra/auth';
import type {
  ApprovalDecision,
  ApprovalSignature,
  ApprovalStep,
  ApproverTier,
  AcceptancePack,
  PaymentReadinessPack,
  PaymentReadinessStalenessEvent,
  ProcurementRequest,
  ProcurementRequestLine,
  ProcurementVendor,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderReceiptStatus,
  RequestAttachment,
  RequestCategory,
  SourcingMethod,
} from './types';
import {
  applyStepDecision,
  buildApprovalSteps,
  nextPendingStep,
  suggestSourcingMethod,
} from './policy';
import { buildProcurementSeed } from './seed';
import { mergeVendorsWithLegal } from './accreditationBridge';
import {
  attachmentMetadataForRpc,
  materializeMemoryAttachments,
  removeUploadedRequestAttachments,
  uploadRequestAttachments,
  type PendingRequestAttachment,
} from './attachments';
import { requestCreationRpc } from './requestDrafts';

type MaybePromise<T> = T | Promise<T>;
type LiveClient = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type LiveRow = Record<string, never> & {
  readonly id: never;
  readonly legal_name: never;
  readonly accreditation_status: never;
  readonly step_order: never;
  readonly tier: never;
  readonly status: never;
  readonly title: never;
  readonly created_at: never;
  readonly po_number: never;
  readonly core_vendor_id: never;
  readonly vendor_name: never;
  readonly updated_at: never;
  readonly purchase_order_id: never;
  readonly received_at: never;
  readonly request_id: never;
  readonly decided_at: never;
  readonly decided_by_email: never;
  readonly note: never;
  readonly signature: never;
};
type LiveQueryError = { readonly message: string };

function useLiveClient(): LiveClient | null {
  const { mode, supabaseClient } = useSession();
  return mode === 'supabase' ? (supabaseClient as LiveClient | null) : null;
}

function isLive(client: LiveClient | null): client is LiveClient {
  return Boolean(client);
}

async function liveRpc<T>(
  client: LiveClient,
  schema: 'procurement',
  fn: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.schema(schema).rpc(fn, { payload });
  if (error) throw new Error(error.message);
  return data as T;
}

function useLiveRows<T>(
  client: LiveClient | null,
  schema: 'core' | 'procurement',
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
      let query = client.schema(schema).from(table).select('*');
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
  }, [client, schema, table, order?.column, order?.ascending]);

  useEffect(() => {
    let active = true;
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = client.schema(schema).from(table).select('*');
    if (order) query = query.order(order.column, { ascending: order.ascending ?? false });
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
  }, [client, schema, table, order?.column, order?.ascending]);

  return [rows, loading, refresh];
}

function mapVendor(row: LiveRow): ProcurementVendor {
  return {
    id: row.id,
    legalName: row.legal_name,
    category: row.category ?? undefined,
    accreditationStatus: row.accreditation_status,
    accreditationExpiresAt: row.accreditation_expires_at ?? undefined,
    temporaryClearanceApproved: row.temporary_clearance_approved ?? undefined,
    temporaryClearanceScope: row.temporary_clearance_scope ?? undefined,
    temporaryClearanceEffectiveAt: row.temporary_clearance_effective_at ?? undefined,
  };
}

function mapStep(row: LiveRow): ApprovalStep {
  return {
    id: row.id,
    order: Number(row.step_order),
    tier: row.tier,
    status: row.status,
    label: row.label ?? undefined,
    note: row.note ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    decidedByEmail: row.decided_by_email ?? undefined,
    signature: row.signature ?? undefined,
  } as ApprovalStep;
}

function mapRequest(row: LiveRow, steps: ApprovalStep[] = []): ProcurementRequest {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    department: row.department ?? undefined,
    costCenter: row.cost_center ?? undefined,
    projectCode: row.project_code ?? undefined,
    budgetCode: row.budget_code ?? undefined,
    status: row.status,
    requesterName: row.requester_name ?? undefined,
    requesterEmail: row.requester_email ?? undefined,
    neededBy: row.needed_by ?? undefined,
    vendorId: row.core_vendor_id ?? undefined,
    vendorName: row.vendor_name ?? undefined,
    lines: row.lines ?? [],
    createdAt: row.created_at,
    submittedAt: row.submitted_at ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    decidedByEmail: row.decided_by_email ?? undefined,
    estimatedAmount: row.estimated_amount == null ? undefined : Number(row.estimated_amount),
    category: row.category ?? undefined,
    sourcingMethod: row.sourcing_method ?? undefined,
    sourcingOverride: row.sourcing_override ?? undefined,
    justification: row.justification ?? undefined,
    attachments: row.attachments ?? undefined,
    compliance: row.compliance ?? undefined,
    approvalSteps: steps,
  } as ProcurementRequest;
}

function mapAcceptancePack(row: LiveRow): AcceptancePack {
  const exceptions: unknown = row.exceptions;
  const acceptedScope: unknown = row.accepted_scope;
  const acceptedScopeText = typeof acceptedScope === 'string'
    ? acceptedScope
    : acceptedScope && typeof acceptedScope === 'object' && 'summary' in acceptedScope
      ? String((acceptedScope as { summary: unknown }).summary)
      : JSON.stringify(acceptedScope ?? {});
  const acceptedQuantity = acceptedScope && typeof acceptedScope === 'object' && 'lines' in acceptedScope
    ? ((acceptedScope as { lines?: Array<{ quantity?: unknown }> }).lines ?? [])
      .reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)
    : undefined;
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    requestId: row.request_id ?? undefined,
    warehouseReceiptReference: row.warehouse_receipt_reference ?? undefined,
    acceptanceType: row.acceptance_type as unknown as AcceptancePack['acceptanceType'],
    acceptedScope: acceptedScopeText,
    acceptedQuantity,
    exceptions: Array.isArray(exceptions) ? exceptions.map(String) : [],
    acceptedByEmail: row.accepted_by_email ?? undefined,
    acceptedAt: row.accepted_at,
    documentHash: row.document_hash ?? undefined,
    status: row.status,
  } as unknown as AcceptancePack;
}

function mapPaymentReadinessPack(row: LiveRow): PaymentReadinessPack {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    acceptancePackId: row.acceptance_pack_id,
    acceptancePackIds: Array.isArray(row.acceptance_pack_ids) ? row.acceptance_pack_ids : undefined,
    acceptedQuantity: row.accepted_quantity == null ? undefined : Number(row.accepted_quantity),
    poMatch: Boolean(row.po_match),
    invoiceOrSiReference: row.invoice_or_si_storage_path ?? undefined,
    milestoneSupportReference: row.milestone_support_storage_path ?? undefined,
    taxWithholdingSupportReference: row.tax_withholding_support_storage_path ?? undefined,
    status: row.status,
    preparedByEmail: row.prepared_by_email ?? undefined,
    preparedAt: row.prepared_at,
    financeReviewedByEmail: row.finance_reviewed_by_email ?? undefined,
    financeReviewedAt: row.finance_reviewed_at ?? undefined,
    financeNote: row.finance_note ?? undefined,
    correctedFrom: row.corrected_from ?? undefined,
    evidenceStale: Boolean(row.evidence_stale),
    evidenceStaleAt: row.evidence_stale_at ?? undefined,
  } as unknown as PaymentReadinessPack;
}

function mapPurchaseOrder(
  row: LiveRow,
  receiptStatus?: PurchaseOrderReceiptStatus,
  acceptancePacks: AcceptancePack[] = [],
  paymentReadiness?: PaymentReadinessPack,
  commitmentReadiness?: PurchaseOrder['commitmentReadiness'],
  paymentReadinessStalenessEvents: PaymentReadinessStalenessEvent[] = [],
): PurchaseOrder {
  return {
    id: row.id,
    poNumber: row.po_number,
    requestId: row.request_id ?? undefined,
    vendorId: row.core_vendor_id,
    vendorName: row.vendor_name,
    status: row.status,
    actorEmail: row.actor_email ?? undefined,
    expectedDate: row.expected_date ?? undefined,
    notes: row.notes ?? undefined,
    origin: row.origin ?? 'procurement',
    lines: row.lines ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? undefined,
    approvedByEmail: row.approved_by_email ?? undefined,
    approvalSignature: row.approval_signature ?? undefined,
    receiptStatus,
    commitmentReadiness,
    acceptancePack: acceptancePacks.at(-1),
    acceptancePacks,
    paymentReadiness,
    paymentReadinessStalenessEvents,
    total: Number(row.total ?? 0),
  } as PurchaseOrder;
}

function mapReceiptStatus(row: LiveRow): PurchaseOrderReceiptStatus & { purchaseOrderId: string } {
  return {
    purchaseOrderId: row.purchase_order_id,
    orderedQuantity: Number(row.ordered_quantity ?? 0),
    acceptedQuantity: Number(row.accepted_quantity ?? 0),
    rejectedOrQuarantinedQuantity: Number(row.rejected_or_quarantined_quantity ?? 0),
    outstandingQuantity: Number(row.outstanding_quantity ?? 0),
    latestReceiptReference: row.latest_warehouse_receipt_reference ?? undefined,
    latestQcStatus: row.qc_status,
    lastReceiptAt: row.last_received_at ?? undefined,
    acceptedLines: Array.isArray(row.accepted_lines) ? row.accepted_lines : [],
  } as unknown as PurchaseOrderReceiptStatus & { purchaseOrderId: string };
}

// ---------------------------------------------------------------------------
// Namespaced storage keys
// ---------------------------------------------------------------------------
const REQ_KEY = 'intra.procurement.v2.requests';
const PO_KEY = 'intra.procurement.v2.purchase_orders';
const APPR_KEY = 'intra.procurement.v2.approvals';
const SEED_KEY = 'intra.procurement.v2.seeded';
const CHANGE_EVT = 'intra.procurement.change';

function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
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
    // Surface quota failures instead of silently dropping the write (a large
    // base64 attachment can otherwise vanish on reload with no feedback).
    if (isQuotaError(err)) {
      window.dispatchEvent(
        new CustomEvent('intra:storage-full', { detail: { key } }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Demo seed — "Mwell operations, last 6 months" (see seed.ts)
// ---------------------------------------------------------------------------

/**
 * Seed the demo dataset once per browser. Exported so the shell can call it
 * on first load (badges light up before the module is ever opened). Existing
 * user-created rows are preserved: the seed only prepends when the flag is
 * absent AND the request store is empty.
 */
export function ensureProcurementSeed(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(SEED_KEY)) return;
    const { requests, purchaseOrders, approvals } = buildProcurementSeed(new Date());
    const existingReqs = safeRead<ProcurementRequest>(REQ_KEY);
    const existingPos = safeRead<PurchaseOrder>(PO_KEY);
    const existingAppr = safeRead<ApprovalDecision>(APPR_KEY);
    safeWrite(REQ_KEY, [...existingReqs, ...requests]);
    safeWrite(PO_KEY, [...existingPos, ...purchaseOrders]);
    safeWrite(APPR_KEY, [...existingAppr, ...approvals]);
    window.localStorage.setItem(SEED_KEY, '1');
  } catch {
    /* storage disabled — demo simply starts empty */
  }
}

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
    ensureProcurementSeed();
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

// ---------------------------------------------------------------------------
// Vendors (demo — matches what a real @intra/core-data `getVendors()` returns)
// ---------------------------------------------------------------------------

/**
 * Seed vendors so the demo can walk PO authoring (which requires an accredited
 * vendor). Two accredited + one draft + one expired mirror the states Legal
 * would produce.
 */
export const DEMO_VENDORS: ProcurementVendor[] = [
  {
    id: 'ven-acme',
    legalName: 'Acme Medical Supplies, Inc.',
    category: 'Medical devices',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2027-01-31',
  },
  {
    id: 'ven-north-star',
    legalName: 'North Star Logistics Corp.',
    category: 'Freight & logistics',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2026-11-15',
  },
  {
    id: 'ven-brightpath',
    legalName: 'BrightPath Print & Signage',
    category: 'Marketing collateral',
    accreditationStatus: 'renewal_due',
    accreditationExpiresAt: '2026-08-01',
  },
  {
    id: 'ven-mediconsult',
    legalName: 'MediConsult Advisory Partners',
    category: 'Consulting',
    accreditationStatus: 'submitted',
  },
  {
    id: 'ven-techbridge',
    legalName: 'TechBridge IT Solutions, Inc.',
    category: 'IT & software',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2027-03-31',
  },
  {
    id: 'ven-cornerstone',
    legalName: 'Cornerstone Builders & Interiors Corp.',
    category: 'Construction',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2026-12-31',
  },
  {
    id: 'ven-caregrid',
    legalName: 'CareGrid Staffing Solutions, Inc.',
    category: 'Manpower',
    accreditationStatus: 'under_review',
  },
  {
    id: 'ven-eventworks',
    legalName: 'EventWorks Productions, Inc.',
    category: 'Events & activations',
    accreditationStatus: 'approved',
    accreditationExpiresAt: '2027-02-28',
  },
];

export function useProcurementVendors(): ProcurementVendor[] {
  const live = useLiveClient();
  const [liveRows] = useLiveRows<ProcurementVendor>(
    live,
    'core',
    'vendors',
    mapVendor,
    { column: 'legal_name', ascending: true },
  );
  if (isLive(live)) return liveRows;
  // Legal is the source of truth for accreditation. In demo mode we read its
  // cases from localStorage and merge; in unit tests (no legal data) this is a
  // no-op and the static catalogue passes through. On Supabase cutover the
  // bridge is replaced by a shared core.vendors read.
  return mergeVendorsWithLegal(DEMO_VENDORS);
}

export function isAccredited(v: ProcurementVendor): boolean {
  const now = new Date();
  if (v.accreditationStatus === 'approved') {
    return !v.accreditationExpiresAt || new Date(v.accreditationExpiresAt) >= now;
  }
  if (v.accreditationStatus !== 'provisional') return false;
  return Boolean(
    v.temporaryClearanceApproved &&
    v.temporaryClearanceScope?.trim() &&
    v.accreditationExpiresAt &&
    new Date(v.accreditationExpiresAt) >= now &&
    (!v.temporaryClearanceEffectiveAt || new Date(v.temporaryClearanceEffectiveAt) <= now),
  );
}

/** True when award is permitted only under a time-limited provisional clearance. */
export function isProvisional(v: ProcurementVendor): boolean {
  return v.accreditationStatus === 'provisional';
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface NewRequestInput {
  draftId?: string;
  title: string;
  description?: string;
  department?: string;
  costCenter?: string;
  projectCode?: string;
  budgetCode?: string;
  neededBy?: string;
  vendorId?: string;
  vendorName?: string;
  requesterName?: string;
  requesterEmail?: string;
  lines: Array<Omit<ProcurementRequestLine, 'id'>>;
  // Policy-aligned optional fields
  category?: RequestCategory;
  sourcingMethod?: SourcingMethod;
  sourcingOverride?: boolean;
  justification?: ProcurementRequest['justification'];
  attachments?: PendingRequestAttachment[];
  compliance?: ProcurementRequest['compliance'];
}

function totalOf(lines: ProcurementRequestLine[] | PurchaseOrderLine[]): number {
  return lines.reduce((sum, l) => {
    const price = typeof l.unitPrice === 'number' ? l.unitPrice : 0;
    const qty = typeof l.quantity === 'number' ? l.quantity : 0;
    return sum + price * qty;
  }, 0);
}

export interface DecideActor {
  email?: string;
  note?: string;
  /** Which tier the actor is deciding on behalf of. When omitted we fall
   *  back to the next-pending step's tier (single-tier demo fallback). */
  tier?: ApproverTier;
  /** Electronic signature captured on the approval sheet before commit.
   *  Approvals REQUIRE a signature; rejections may omit it (rejection is a
   *  gate, not a legally binding sign-off). Enforcement lives in the UI. */
  signature?: ApprovalSignature;
}

export interface ProcurementRequestsAPI {
  rows: ProcurementRequest[];
  loading: boolean;
  add: (input: NewRequestInput) => MaybePromise<ProcurementRequest>;
  update: (id: string, patch: Partial<ProcurementRequest>) => MaybePromise<ProcurementRequest | null>;
  submit: (id: string) => MaybePromise<ProcurementRequest | null>;
  cancel: (id: string) => MaybePromise<ProcurementRequest | null>;
  decide: (
    id: string,
    decision: 'approved' | 'rejected',
    actor: DecideActor,
  ) => MaybePromise<ProcurementRequest | null>;
  getById: (id: string) => ProcurementRequest | undefined;
}

export function useProcurementRequests(): ProcurementRequestsAPI {
  const live = useLiveClient();
  const [localRows, set, localLoading] = useTrackedRows<ProcurementRequest>(
    REQ_KEY,
    !isLive(live),
  );
  const [liveBaseRows, liveRowsLoading, refreshRequests] = useLiveRows<LiveRow>(
    live,
    'procurement',
    'requests',
    (row) => row,
    { column: 'created_at', ascending: false },
  );
  const [liveSteps, liveStepsLoading, refreshSteps] = useLiveRows<ApprovalStep & { requestId: string }>(
    live,
    'procurement',
    'approval_steps',
    (row) => ({ ...mapStep(row), requestId: row.request_id }),
    { column: 'step_order', ascending: true },
  );
  const liveRows = liveBaseRows.map((row) =>
    mapRequest(
      row,
      liveSteps
        .filter((s) => s.requestId === row.id)
        .sort((a, b) => a.order - b.order),
    ),
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveRowsLoading || liveStepsLoading : localLoading;
  const refreshLive = useCallback(async () => {
    await Promise.all([refreshRequests(), refreshSteps()]);
  }, [refreshRequests, refreshSteps]);

  const add = useCallback(
    async (input: NewRequestInput): Promise<ProcurementRequest> => {
      const lines: ProcurementRequestLine[] = input.lines.map((l) => ({
        ...l,
        id: newId('rl'),
      }));
      const estimatedAmount = totalOf(lines);
      // Auto-suggest a sourcing method if the caller didn't provide one so
      // even legacy callers (no category picker yet) get policy alignment.
      const suggested = suggestSourcingMethod({
        category: input.category,
        amount: estimatedAmount,
      });
      const requestId = input.draftId ?? newId('req');
      const attachments: RequestAttachment[] = isLive(live)
        ? await uploadRequestAttachments(live, requestId, input.attachments ?? [])
        : await materializeMemoryAttachments(input.attachments ?? []);
      const next: ProcurementRequest = {
        id: requestId,
        createdAt: nowIso(),
        status: 'draft',
        title: input.title,
        description: input.description,
        department: input.department,
        costCenter: input.costCenter,
        projectCode: input.projectCode,
        budgetCode: input.budgetCode,
        neededBy: input.neededBy,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        lines,
        estimatedAmount,
        category: input.category,
        sourcingMethod: input.sourcingMethod ?? suggested,
        sourcingOverride:
          input.sourcingOverride ??
          (input.sourcingMethod !== undefined && input.sourcingMethod !== suggested),
        justification: input.justification,
        attachments: attachments.length > 0 ? attachments : undefined,
        compliance: input.compliance,
      };
      if (isLive(live)) {
        try {
          const row = await liveRpc<LiveRow>(live, 'procurement', requestCreationRpc(input.draftId), {
            id: next.id,
            title: next.title,
            description: next.description,
            department: next.department,
            cost_center: next.costCenter,
            project_code: next.projectCode,
            budget_code: next.budgetCode,
            needed_by: next.neededBy,
            vendor_id: next.vendorId,
            vendor_name: next.vendorName,
            requester_name: next.requesterName,
            requester_email: next.requesterEmail,
            lines: next.lines,
            estimated_amount: next.estimatedAmount,
            category: next.category,
            sourcing_method: next.sourcingMethod,
            sourcing_override: next.sourcingOverride,
            justification: next.justification,
            attachments: attachments.map(attachmentMetadataForRpc),
            compliance: next.compliance,
          });
          const mapped = mapRequest(row);
          await refreshLive();
          return mapped;
        } catch (error) {
          await removeUploadedRequestAttachments(
            live,
            attachments.flatMap((attachment) =>
              attachment.storagePath ? [attachment.storagePath] : [],
            ),
          ).catch(() => undefined);
          throw error;
        }
      }
      set([next, ...safeRead<ProcurementRequest>(REQ_KEY)]);
      return next;
    },
    [set, live, refreshLive],
  );

  const update = useCallback(
    (
      id: string,
      patch: Partial<ProcurementRequest>,
    ): MaybePromise<ProcurementRequest | null> => {
      if (isLive(live)) {
        return Promise.reject(
          new Error('Live request editing is not available after creation yet.'),
        );
      }
      const current = safeRead<ProcurementRequest>(REQ_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const merged: ProcurementRequest = { ...current[idx]!, ...patch };
      if (patch.lines) merged.estimatedAmount = totalOf(patch.lines);
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      return merged;
    },
    [set, live],
  );

  const submit = useCallback(
    (id: string) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'submit_request', {
          id,
        }).then((row) => {
          const mapped = mapRequest(row);
          return refreshLive().then(() => mapped);
        });
      }
      const current = safeRead<ProcurementRequest>(REQ_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const req = current[idx]!;
      // Build ladder from the latest category + amount + sourcing method.
      const steps = buildApprovalSteps(
        {
          category: req.category,
          amount: req.estimatedAmount,
          sourcingMethod:
            req.sourcingMethod ??
            suggestSourcingMethod({
              category: req.category,
              amount: req.estimatedAmount,
            }),
        },
        () => newId('step'),
      );
      return update(id, {
        status: 'submitted',
        submittedAt: nowIso(),
        approvalSteps: steps,
      });
    },
    [update, live, refreshLive],
  );

  const cancel = useCallback(
    (id: string) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'cancel_request', { id }).then(
          (row) => {
            const mapped = mapRequest(row);
            return refreshLive().then(() => mapped);
          },
        );
      }
      return update(id, { status: 'cancelled' });
    },
    [update, live, refreshLive],
  );

  const decide = useCallback(
    (
      id: string,
      decision: 'approved' | 'rejected',
      actor: DecideActor,
    ) => {
      if (isLive(live)) {
        const req = rows.find((r) => r.id === id);
        const step = req ? nextPendingStep(req.approvalSteps) : undefined;
        return liveRpc<LiveRow>(live, 'procurement', 'decide_request_step', {
          request_id: id,
          step_id: step?.id,
          tier: actor.tier ?? step?.tier,
          decision,
          decided_by_email: actor.email,
          note: actor.note,
          signature: actor.signature,
        }).then((row) => {
          const mapped = mapRequest(row);
          return refreshLive().then(() => mapped);
        });
      }
      const current = safeRead<ProcurementRequest>(REQ_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const req = current[idx]!;
      const steps: ApprovalStep[] = req.approvalSteps ?? [];

      // Fallback: legacy rows submitted before the ladder existed still need
      // to be actionable. Build a single-tier ladder pinned to the actor.
      const workingSteps =
        steps.length > 0
          ? steps
          : [
              {
                id: newId('step'),
                order: 1,
                tier: (actor.tier ?? 'final_approver') as ApproverTier,
                status: 'pending' as const,
                label: 'Approval',
              },
            ];
      const targetTier = actor.tier ?? nextPendingStep(workingSteps)?.tier;
      if (!targetTier) return null;

      const decidedAt = nowIso();
      const result = applyStepDecision(workingSteps, targetTier, decision, {
        email: actor.email,
        note: actor.note,
        at: decidedAt,
        signature: actor.signature,
      });
      if (!result) return null;

      const nextStatus: ProcurementRequest['status'] = result.terminal
        ? result.outcome === 'approved'
          ? 'approved'
          : 'rejected'
        : 'under_review';

      const patch: Partial<ProcurementRequest> = {
        status: nextStatus,
        approvalSteps: result.steps,
        decidedAt: result.terminal ? decidedAt : undefined,
        decisionNote: result.terminal ? actor.note : undefined,
        decidedByEmail: result.terminal ? actor.email : undefined,
      };
      const row = update(id, patch);
      if (row) {
        const step = result.steps.find((s) => s.decidedAt === decidedAt);
        recordApproval({
          entityType: 'request',
          entityId: id,
          decision,
          note: actor.note,
          decidedAt,
          decidedByEmail: actor.email,
          tier: targetTier,
          stepId: step?.id,
          signature: actor.signature,
        });
      }
      return row;
    },
    [update, live, rows, refreshLive],
  );

  const getById = useCallback(
    (id: string) => rows.find((r) => r.id === id),
    [rows],
  );

  return { rows, loading, add, update, submit, cancel, decide, getById };
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export interface NewPOInput {
  requestId?: string;
  vendorId: string;
  vendorName: string;
  expectedDate?: string;
  notes?: string;
  actorEmail?: string;
  origin?: 'procurement' | 'warehouse';
  lines: Array<Omit<PurchaseOrderLine, 'id' | 'receivedQuantity'>>;
}

function nextPoNumber(existing: PurchaseOrder[]): string {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const nums = existing
    .map((p) => (p.poNumber?.startsWith(prefix) ? Number(p.poNumber.slice(prefix.length)) : 0))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${next.toString().padStart(4, '0')}`;
}

export interface PurchaseOrdersAPI {
  rows: PurchaseOrder[];
  loading: boolean;
  add: (input: NewPOInput) => MaybePromise<PurchaseOrder>;
  approve: (
    id: string,
    actor: { email?: string; signature?: ApprovalSignature; note?: string },
  ) => MaybePromise<PurchaseOrder | null>;
  issue: (id: string, readiness: { sourceAwardApproved: boolean; vendorEligible: boolean }) => MaybePromise<PurchaseOrder | null>;
  cancel: (id: string) => MaybePromise<PurchaseOrder | null>;
  recordAcceptance: (id: string, input: { acceptanceType: 'goods' | 'service' | 'milestone'; acceptedScope: string; acceptedLines?: Array<{ poLineId: string; quantity: number }>; exceptions: string[]; actorEmail?: string }) => MaybePromise<PurchaseOrder | null>;
  createPolicyEvidence: (requestId: string, input: { controlCode: string; evidenceType: string; facts?: Record<string, unknown> }) => Promise<void>;
  reviewPolicyEvidence: (id: string, decision: 'approved' | 'rejected') => Promise<void>;
  supersedePolicyEvidence: (id: string) => Promise<void>;
  createFinancialProtection: (requestId: string, input: { protectionType: string; triggerBasis: string; requiredAmount?: number }) => Promise<void>;
  reviewFinancialProtection: (id: string, decision: 'approved' | 'waived', waiver?: { reason: string; basis: string; evidenceStoragePath: string }) => Promise<void>;
  supersedeFinancialProtection: (id: string) => Promise<void>;
  preparePayment: (id: string, input: { poMatch: boolean; invoiceOrSiReference: string; milestoneSupportReference: string; taxWithholdingSupportReference: string; actorEmail?: string }) => MaybePromise<PurchaseOrder | null>;
  reviewPayment: (id: string, input: { status: 'returned' | 'accepted'; note?: string; actorEmail?: string }) => MaybePromise<PurchaseOrder | null>;
  getById: (id: string) => PurchaseOrder | undefined;
}

export function usePurchaseOrders(): PurchaseOrdersAPI {
  const live = useLiveClient();
  const canViewFinance = useCan('procurement', 'view_finance');
  const [localRows, set, localLoading] = useTrackedRows<PurchaseOrder>(
    PO_KEY,
    !isLive(live),
  );
  const [liveBaseRows, liveRowsLoading, refreshPos] = useLiveRows<LiveRow>(
    live,
    'procurement',
    'purchase_orders',
    (row) => row,
    { column: 'created_at', ascending: false },
  );
  const [liveReceiptStatuses, liveReceiptStatusesLoading, refreshReceiptStatuses] = useLiveRows<
    PurchaseOrderReceiptStatus & { purchaseOrderId: string }
  >(live, 'procurement', 'v_purchase_order_receipt_status', mapReceiptStatus);
  const [liveAcceptances, liveAcceptancesLoading, refreshAcceptances] = useLiveRows<AcceptancePack>(
    live, 'procurement', 'acceptance_packs', mapAcceptancePack,
    { column: 'accepted_at', ascending: false },
  );
  const [liveCommitmentReadiness, setLiveCommitmentReadiness] = useState<Array<
    NonNullable<PurchaseOrder['commitmentReadiness']> & { purchaseOrderId: string }
  >>([]);
  const [liveCommitmentLoading, setLiveCommitmentLoading] = useState(Boolean(live));
  const refreshCommitmentReadiness = useCallback(async () => {
    if (!live) { setLiveCommitmentReadiness([]); setLiveCommitmentLoading(false); return; }
    setLiveCommitmentLoading(true);
    try {
      const readiness = await Promise.all(liveBaseRows.filter((row) => Boolean(row.request_id)).map(async (row) => ({
        ...(await liveRpc<NonNullable<PurchaseOrder['commitmentReadiness']>>(live, 'procurement', 'commitment_readiness', {
          request_id: row.request_id, vendor_id: row.core_vendor_id,
          phase: row.status === 'draft' || row.status === 'pending_approval' ? 'award' : 'issue',
        })),
        purchaseOrderId: String(row.id),
      })));
      setLiveCommitmentReadiness(readiness);
    } catch { setLiveCommitmentReadiness([]); }
    finally { setLiveCommitmentLoading(false); }
  }, [live, liveBaseRows]);
  useEffect(() => { void refreshCommitmentReadiness(); }, [refreshCommitmentReadiness]);
  const [livePaymentPacks, livePaymentPacksLoading, refreshPaymentPacks] = useLiveRows<PaymentReadinessPack>(
    live, 'procurement', 'payment_readiness_packs', mapPaymentReadinessPack,
    { column: 'prepared_at', ascending: false },
  );
  const [liveStalenessEvents, setLiveStalenessEvents] = useState<PaymentReadinessStalenessEvent[]>([]);
  const [liveStalenessLoading, setLiveStalenessLoading] = useState(Boolean(live));
  const refreshStalenessEvents = useCallback(async () => {
    if (!live || !canViewFinance) { setLiveStalenessEvents([]); setLiveStalenessLoading(false); return; }
    setLiveStalenessLoading(true);
    try {
      const rows = await liveRpc<Array<Record<string, unknown>>>(
        live, 'procurement', 'payment_readiness_staleness_work_items', {},
      );
      setLiveStalenessEvents(rows.map((row) => ({
        id: String(row.event_id),
        paymentReadinessPackId: String(row.payment_readiness_pack_id),
        purchaseOrderId: String(row.purchase_order_id),
        priorStatus: row.prior_status as PaymentReadinessStalenessEvent['priorStatus'],
        priorAcceptanceEvidenceVersion: Number(row.prior_acceptance_evidence_version),
        acceptanceEvidenceVersion: Number(row.acceptance_evidence_version),
        reason: String(row.reason),
        recordedAt: String(row.recorded_at),
        financeReviewedByEmail: row.finance_reviewed_by_email
          ? String(row.finance_reviewed_by_email) : undefined,
        financeReviewedAt: row.finance_reviewed_at ? String(row.finance_reviewed_at) : undefined,
        financeNote: row.finance_note ? String(row.finance_note) : undefined,
      })));
    } catch { setLiveStalenessEvents([]); }
    finally { setLiveStalenessLoading(false); }
  }, [canViewFinance, live]);
  useEffect(() => { void refreshStalenessEvents(); }, [refreshStalenessEvents]);
  const liveRows = liveBaseRows.map((row) =>
    mapPurchaseOrder(
      row,
      liveReceiptStatuses.find((status) => status.purchaseOrderId === row.id),
      liveAcceptances.filter((pack) => pack.purchaseOrderId === row.id && pack.status !== 'superseded')
        .sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt)),
      livePaymentPacks.find((pack) => pack.purchaseOrderId === row.id && pack.status !== 'superseded'),
      liveCommitmentReadiness.find((readiness) => readiness.purchaseOrderId === row.id),
      liveStalenessEvents.filter((event) => event.purchaseOrderId === row.id),
    ),
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live)
    ? liveRowsLoading || liveReceiptStatusesLoading || liveAcceptancesLoading || livePaymentPacksLoading || liveCommitmentLoading || liveStalenessLoading
    : localLoading;
  const refreshLive = useCallback(async () => {
    await Promise.all([refreshPos(), refreshReceiptStatuses(), refreshAcceptances(), refreshPaymentPacks(), refreshCommitmentReadiness(), refreshStalenessEvents()]);
  }, [refreshPos, refreshReceiptStatuses, refreshAcceptances, refreshPaymentPacks, refreshCommitmentReadiness, refreshStalenessEvents]);

  const add = useCallback(
    (input: NewPOInput): MaybePromise<PurchaseOrder> => {
      const existing = safeRead<PurchaseOrder>(PO_KEY);
      const lines: PurchaseOrderLine[] = input.lines.map((l) => ({
        ...l,
        id: newId('pl'),
        receivedQuantity: 0,
      }));
      const next: PurchaseOrder = {
        id: newId('po'),
        poNumber: nextPoNumber(existing),
        requestId: input.requestId,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        status: 'draft',
        origin: input.origin ?? 'procurement',
        actorEmail: input.actorEmail,
        expectedDate: input.expectedDate,
        notes: input.notes,
        lines,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        total: totalOf(lines),
      };
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'create_purchase_order', {
          request_id: next.requestId,
          vendor_id: next.vendorId,
          vendor_name: next.vendorName,
          actor_email: next.actorEmail,
          expected_date: next.expectedDate,
          notes: next.notes,
          lines: next.lines,
          total: next.total,
        }).then((row) => {
          const mapped = mapPurchaseOrder(row);
          return refreshLive().then(() => mapped);
        });
      }
      set([next, ...existing]);
      return next;
    },
    [set, live, refreshLive],
  );

  const patch = useCallback(
    (id: string, p: Partial<PurchaseOrder>): PurchaseOrder | null => {
      if (isLive(live)) return null;
      const current = safeRead<PurchaseOrder>(PO_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const merged: PurchaseOrder = { ...current[idx]!, ...p, updatedAt: nowIso() };
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      return merged;
    },
    [set, live],
  );

  const approve = useCallback(
    (
      id: string,
      actor: { email?: string; signature?: ApprovalSignature; note?: string },
    ) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'approve_purchase_order', {
          id,
          actor_email: actor.email,
          note: actor.note,
          signature: actor.signature,
        }).then((row) => {
          const mapped = mapPurchaseOrder(row);
          return refreshLive().then(() => mapped);
        });
      }
      const approvedAt = nowIso();
      const row = patch(id, {
        status: 'approved',
        approvedAt,
        approvedByEmail: actor.email,
        approvalSignature: actor.signature,
      });
      if (row) {
        recordApproval({
          entityType: 'purchase_order',
          entityId: id,
          decision: 'approved',
          note: actor.note,
          decidedAt: approvedAt,
          decidedByEmail: actor.email,
          signature: actor.signature,
        });
      }
      return row;
    },
    [patch, live, refreshLive],
  );

  const issue = useCallback(
    (id: string, readiness: { sourceAwardApproved: boolean; vendorEligible: boolean }) => {
      const current = rows.find((row) => row.id === id);
      if (!current || current.status !== 'approved' || !readiness.sourceAwardApproved || !readiness.vendorEligible) {
        return null;
      }
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'issue_purchase_order', {
          id,
        }).then((row) => {
          const mapped = mapPurchaseOrder(row);
          return refreshLive().then(() => mapped);
        });
      }
      return patch(id, { status: 'issued' });
    },
    [patch, live, refreshLive, rows],
  );
  const cancel = useCallback(
    (id: string) => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'cancel_purchase_order', {
          id,
        }).then((row) => {
          const mapped = mapPurchaseOrder(row);
          return refreshLive().then(() => mapped);
        });
      }
      return patch(id, { status: 'cancelled' });
    },
    [patch, live, refreshLive],
  );

  const recordAcceptance = useCallback((id: string, input: { acceptanceType: 'goods' | 'service' | 'milestone'; acceptedScope: string; acceptedLines?: Array<{ poLineId: string; quantity: number }>; exceptions: string[]; actorEmail?: string }): MaybePromise<PurchaseOrder | null> => {
    const current = rows.find((row) => row.id === id);
    if (!current) return null;
    if (input.acceptanceType === 'goods' &&
        (current.receiptStatus?.acceptedQuantity ?? 0) <= 0) return null;
      if (isLive(live)) {
        const acceptedScope = input.acceptanceType === 'goods'
          ? {
              summary: input.acceptedScope,
              lines: input.acceptedLines ?? [],
            }
          : input.acceptedScope;
        return liveRpc<LiveRow>(live, 'procurement', 'record_acceptance_pack', {
        purchase_order_id: id,
        acceptance_type: input.acceptanceType,
          accepted_scope: acceptedScope,
        exceptions: input.exceptions,
        warehouse_receipt_reference: current.receiptStatus?.latestReceiptReference,
      }).then(() => refreshLive().then(() => current));
    }
    const acceptancePack: AcceptancePack = {
      id: newId('accept'), purchaseOrderId: id, requestId: current.requestId,
      warehouseReceiptReference: current.receiptStatus?.latestReceiptReference,
      acceptanceType: input.acceptanceType, acceptedScope: input.acceptedScope,
      exceptions: input.exceptions, acceptedByEmail: input.actorEmail,
      acceptedAt: nowIso(), acceptedQuantity: (input.acceptedLines ?? []).reduce((sum, line) => sum + line.quantity, 0),
      status: input.exceptions.length ? 'accepted_with_exceptions' : 'accepted',
    };
    const acceptancePacks = [...(current.acceptancePacks ?? (current.acceptancePack ? [current.acceptancePack] : [])), acceptancePack];
    return patch(id, { acceptancePack, acceptancePacks });
  }, [live, patch, refreshLive, rows]);

  const createPolicyEvidence = useCallback(async (requestId: string, input: { controlCode: string; evidenceType: string; facts?: Record<string, unknown> }) => {
    if (!live) return;
    await liveRpc(live, 'procurement', 'create_policy_evidence', { request_id: requestId, control_code: input.controlCode, evidence_type: input.evidenceType, facts: input.facts ?? {} });
    await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);
  const reviewPolicyEvidence = useCallback(async (id: string, decision: 'approved' | 'rejected') => {
    if (!live) return; await liveRpc(live, 'procurement', 'review_policy_evidence', { id, decision }); await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);
  const supersedePolicyEvidence = useCallback(async (id: string) => {
    if (!live) return; await liveRpc(live, 'procurement', 'supersede_policy_evidence', { id }); await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);
  const createFinancialProtection = useCallback(async (requestId: string, input: { protectionType: string; triggerBasis: string; requiredAmount?: number }) => {
    if (!live) return;
    await liveRpc(live, 'procurement', 'create_financial_protection', { request_id: requestId, protection_type: input.protectionType, trigger_basis: input.triggerBasis, required_amount: input.requiredAmount });
    await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);
  const reviewFinancialProtection = useCallback(async (id: string, decision: 'approved' | 'waived', waiver?: { reason: string; basis: string; evidenceStoragePath: string }) => {
    if (!live) return;
    await liveRpc(live, 'procurement', 'review_financial_protection', {
      id, decision, waiver_reason: waiver?.reason, waiver_basis: waiver?.basis,
      waiver_evidence_storage_path: waiver?.evidenceStoragePath,
    });
    await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);
  const supersedeFinancialProtection = useCallback(async (id: string) => {
    if (!live) return; await liveRpc(live, 'procurement', 'supersede_financial_protection', { id }); await refreshCommitmentReadiness();
  }, [live, refreshCommitmentReadiness]);

  const preparePayment = useCallback((id: string, input: { poMatch: boolean; invoiceOrSiReference: string; milestoneSupportReference: string; taxWithholdingSupportReference: string; actorEmail?: string }): MaybePromise<PurchaseOrder | null> => {
    const current = rows.find((row) => row.id === id);
    const activeAcceptances = current?.acceptancePacks ?? (current?.acceptancePack ? [current.acceptancePack] : []);
    if (!current || activeAcceptances.length === 0) return null;
    if (isLive(live)) {
      return liveRpc<LiveRow>(live, 'procurement', 'prepare_payment_readiness', {
        purchase_order_id: id,
        po_match: input.poMatch,
        invoice_or_si_storage_path: input.invoiceOrSiReference,
        milestone_support_storage_path: input.milestoneSupportReference,
        tax_withholding_support_storage_path: input.taxWithholdingSupportReference,
        corrected_from: current.paymentReadiness?.status === 'returned' || current.paymentReadiness?.evidenceStale
          ? current.paymentReadiness.id
          : undefined,
      }).then(() => refreshLive().then(() => current));
    }
    const paymentReadiness: PaymentReadinessPack = {
      id: newId('pay'), purchaseOrderId: id, acceptancePackId: activeAcceptances[0]!.id,
      acceptancePackIds: activeAcceptances.map((acceptance) => acceptance.id),
      poMatch: input.poMatch, invoiceOrSiReference: input.invoiceOrSiReference,
      milestoneSupportReference: input.milestoneSupportReference,
      taxWithholdingSupportReference: input.taxWithholdingSupportReference,
      status: 'ready_for_finance', preparedByEmail: input.actorEmail, preparedAt: nowIso(),
      correctedFrom: current.paymentReadiness?.status === 'returned' || current.paymentReadiness?.evidenceStale
        ? current.paymentReadiness.id : undefined,
    };
    return patch(id, { paymentReadiness });
  }, [live, patch, refreshLive, rows]);

  const reviewPayment = useCallback((id: string, input: { status: 'returned' | 'accepted'; note?: string; actorEmail?: string }): MaybePromise<PurchaseOrder | null> => {
    const current = rows.find((row) => row.id === id);
    if (!current?.paymentReadiness) return null;
    if (isLive(live)) {
      return liveRpc<LiveRow>(live, 'procurement', 'review_payment_readiness', {
        id: current.paymentReadiness.id, status: input.status, note: input.note,
      }).then(() => refreshLive().then(() => current));
    }
    return patch(id, { paymentReadiness: {
      ...current.paymentReadiness, status: input.status,
      financeReviewedByEmail: input.actorEmail, financeReviewedAt: nowIso(),
      financeNote: input.note,
    } });
  }, [live, patch, refreshLive, rows]);

  const getById = useCallback((id: string) => rows.find((r) => r.id === id), [rows]);

  return { rows, loading, add, approve, issue, cancel, recordAcceptance,
    createPolicyEvidence, reviewPolicyEvidence, supersedePolicyEvidence,
    createFinancialProtection, reviewFinancialProtection, supersedeFinancialProtection,
    preparePayment, reviewPayment, getById };
}

export interface AcceptanceWorkItem {
  purchaseOrderId: string;
  poNumber: string;
  requestId: string;
  status: string;
  warehouseReceiptReference?: string;
  qcStatus?: string;
  lines: Array<{
    poLineId: string;
    description: string;
    uom: string;
    orderedQuantity: number;
    qcAcceptedQuantity: number;
    rejectedOrQuarantinedQuantity: number;
    warehouseReceiptId: string;
    qcInspectionIds: string[];
  }>;
}

function mapAcceptanceWorkItem(row: Record<string, unknown>): AcceptanceWorkItem {
  return {
    purchaseOrderId: String(row.purchase_order_id),
    poNumber: String(row.po_number),
    requestId: String(row.request_id),
    status: String(row.status),
    warehouseReceiptReference: row.warehouse_receipt_reference == null
      ? undefined : String(row.warehouse_receipt_reference),
    qcStatus: row.qc_status == null ? undefined : String(row.qc_status),
    lines: ((row.lines ?? []) as Array<Record<string, unknown>>).map((line) => ({
      poLineId: String(line.poLineId),
      description: String(line.description),
      uom: String(line.uom ?? 'ea'),
      orderedQuantity: Number(line.orderedQuantity ?? 0),
      qcAcceptedQuantity: Number(line.qcAcceptedQuantity ?? 0),
      rejectedOrQuarantinedQuantity: Number(line.rejectedOrQuarantinedQuantity ?? 0),
      warehouseReceiptId: String(line.warehouseReceiptId),
      qcInspectionIds: Array.isArray(line.qcInspectionIds)
        ? line.qcInspectionIds.map(String) : [],
    })),
  };
}

export function useAcceptanceWorkItem(purchaseOrderId: string) {
  const live = useLiveClient();
  const [item, setItem] = useState<AcceptanceWorkItem | null>(null);
  const [loading, setLoading] = useState(Boolean(live));

  const load = useCallback(async () => {
    if (!live || !purchaseOrderId) { setItem(null); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await liveRpc<Array<Record<string, unknown>>>(
        live, 'procurement', 'acceptance_work_items', { purchase_order_id: purchaseOrderId },
      );
      setItem(rows[0] ? mapAcceptanceWorkItem(rows[0]) : null);
    } finally {
      setLoading(false);
    }
  }, [live, purchaseOrderId]);

  useEffect(() => { void load(); }, [load]);

  const recordAcceptance = useCallback(async (input: {
    acceptedScope: string;
    acceptedLines: Array<{
      poLineId: string;
      quantity: number;
      warehouseReceiptId: string;
      qcInspectionIds: string[];
    }>;
    exceptions: string[];
  }) => {
    if (!live || !item) return false;
    await liveRpc(live, 'procurement', 'record_acceptance_pack', {
      purchase_order_id: item.purchaseOrderId,
      acceptance_type: 'goods',
      accepted_scope: { summary: input.acceptedScope, lines: input.acceptedLines },
      exceptions: input.exceptions,
      warehouse_receipt_reference: item.warehouseReceiptReference,
    });
    await load();
    return true;
  }, [item, live, load]);

  return { item, loading, recordAcceptance };
}

// ---------------------------------------------------------------------------
// Approval history (append-only)
// ---------------------------------------------------------------------------

function recordApproval(a: ApprovalDecision): void {
  if (typeof window === 'undefined') return;
  const current = safeRead<ApprovalDecision>(APPR_KEY);
  safeWrite(APPR_KEY, [a, ...current]);
}

export function useApprovalHistory(entityId?: string): ApprovalDecision[] {
  const live = useLiveClient();
  const [localRows] = useTrackedRows<ApprovalDecision>(APPR_KEY, !isLive(live));
  const [liveRows] = useLiveRows<ApprovalDecision>(
    live,
    'procurement',
    'approval_steps',
    (row) => ({
      entityType: 'request',
      entityId: row.request_id,
      decision: row.status,
      note: row.note ?? undefined,
      decidedAt: row.decided_at,
      decidedByEmail: row.decided_by_email ?? undefined,
      tier: row.tier,
      stepId: row.id,
      signature: row.signature ?? undefined,
    }) as ApprovalDecision,
    { column: 'decided_at', ascending: false },
  );
  const rows = isLive(live) ? liveRows.filter((r) => r.decidedAt) : localRows;
  if (!entityId) return rows;
  return rows.filter((r) => r.entityId === entityId);
}
