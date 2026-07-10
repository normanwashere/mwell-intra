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
import { useSession } from '@intra/auth';
import type {
  ApprovalDecision,
  ApprovalSignature,
  ApprovalStep,
  ApproverTier,
  ProcurementRequest,
  ProcurementRequestLine,
  ProcurementVendor,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderReceipt,
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
import { applyReceipt, type ReceiptLineInput } from './receiving';
import { buildProcurementSeed } from './seed';
import { mergeVendorsWithLegal } from './accreditationBridge';
import {
  attachmentMetadataForRpc,
  materializeMemoryAttachments,
  removeUploadedRequestAttachments,
  uploadRequestAttachments,
  type PendingRequestAttachment,
} from './attachments';

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

function mapPurchaseOrder(row: LiveRow, receipts: PurchaseOrderReceipt[] = []): PurchaseOrder {
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
    receipts,
    total: Number(row.total ?? 0),
  } as PurchaseOrder;
}

function mapReceipt(row: LiveRow): PurchaseOrderReceipt & { purchaseOrderId: string } {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    receivedAt: row.received_at,
    receivedByEmail: row.received_by_email ?? undefined,
    note: row.note ?? undefined,
    lines: row.lines ?? [],
    closedPo: Boolean(row.closed_po),
  };
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
  // Full accreditation OR a live provisional (temporary) clearance both permit
  // award; both honor the expiry date when present.
  if (
    v.accreditationStatus !== 'approved' &&
    v.accreditationStatus !== 'provisional'
  ) {
    return false;
  }
  if (v.accreditationExpiresAt) {
    return new Date(v.accreditationExpiresAt) >= new Date();
  }
  return true;
}

/** True when award is permitted only under a time-limited provisional clearance. */
export function isProvisional(v: ProcurementVendor): boolean {
  return v.accreditationStatus === 'provisional';
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface NewRequestInput {
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
      const requestId = newId('req');
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
          const row = await liveRpc<LiveRow>(live, 'procurement', 'create_request', {
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

export interface ReceiveInput {
  /** Per-line quantities to accept (clamped to outstanding; ≤0 ignored). */
  lines: ReceiptLineInput[];
  actorEmail?: string;
  note?: string;
}

export interface PurchaseOrdersAPI {
  rows: PurchaseOrder[];
  loading: boolean;
  add: (input: NewPOInput) => MaybePromise<PurchaseOrder>;
  approve: (
    id: string,
    actor: { email?: string; signature?: ApprovalSignature; note?: string },
  ) => MaybePromise<PurchaseOrder | null>;
  issue: (id: string) => MaybePromise<PurchaseOrder | null>;
  cancel: (id: string) => MaybePromise<PurchaseOrder | null>;
  /** Record a (possibly partial) goods receipt. Appends a
   *  PurchaseOrderReceipt to the PO's `receipts` history (PR-24). */
  receive: (id: string, input: ReceiveInput) => MaybePromise<PurchaseOrder | null>;
  getById: (id: string) => PurchaseOrder | undefined;
}

export function usePurchaseOrders(): PurchaseOrdersAPI {
  const live = useLiveClient();
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
  const [liveReceipts, liveReceiptsLoading, refreshReceipts] = useLiveRows<
    PurchaseOrderReceipt & { purchaseOrderId: string }
  >(live, 'procurement', 'receipts', mapReceipt, {
    column: 'received_at',
    ascending: false,
  });
  const liveRows = liveBaseRows.map((row) =>
    mapPurchaseOrder(
      row,
      liveReceipts.filter((r) => r.purchaseOrderId === row.id),
    ),
  );
  const rows = isLive(live) ? liveRows : localRows;
  const loading = isLive(live) ? liveRowsLoading || liveReceiptsLoading : localLoading;
  const refreshLive = useCallback(async () => {
    await Promise.all([refreshPos(), refreshReceipts()]);
  }, [refreshPos, refreshReceipts]);

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
    (id: string) => {
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
    [patch, live, refreshLive],
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

  const receive = useCallback(
    (id: string, input: ReceiveInput): MaybePromise<PurchaseOrder | null> => {
      if (isLive(live)) {
        return liveRpc<LiveRow>(live, 'procurement', 'receive_purchase_order', {
          id,
          lines: input.lines,
          actor_email: input.actorEmail,
          note: input.note,
        }).then((row) => {
          const mapped = mapPurchaseOrder(row);
          return refreshLive().then(() => mapped);
        }) as MaybePromise<PurchaseOrder | null>;
      }
      const current = safeRead<PurchaseOrder>(PO_KEY);
      const po = current.find((r) => r.id === id);
      if (!po) return null;
      const result = applyReceipt(po.lines, input.lines);
      if (!result) return null;
      const status: PurchaseOrder['status'] = result.closes ? 'closed' : 'issued';
      const receipt: PurchaseOrderReceipt = {
        id: newId('rcpt'),
        receivedAt: nowIso(),
        receivedByEmail: input.actorEmail,
        note: input.note?.trim() || undefined,
        lines: result.accepted,
        closedPo: result.closes,
      };
      return patch(id, {
        lines: result.lines,
        status,
        receipts: [...(po.receipts ?? []), receipt],
      });
    },
    [patch, live, refreshLive],
  );

  const getById = useCallback((id: string) => rows.find((r) => r.id === id), [rows]);

  return { rows, loading, add, approve, issue, cancel, receive, getById };
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
