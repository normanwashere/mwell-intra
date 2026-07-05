// Local-only procurement store (preview build).
//
// The real repository adapter (@intra/core-data + procurement.* RPCs) lands
// post-MVP; until then we persist requests + POs + approval decisions to
// localStorage so every UX path (draft → submit → approve → PO → issue) is
// clickable end-to-end. Keys are namespaced under `intra.procurement.v2.*`
// (bumped from v1 to accommodate line items) so the switch to real RPCs can
// migrate cleanly.

import { useCallback, useEffect, useState } from 'react';
import type {
  ApprovalDecision,
  ProcurementRequest,
  ProcurementRequestLine,
  ProcurementVendor,
  PurchaseOrder,
  PurchaseOrderLine,
} from './types';

// ---------------------------------------------------------------------------
// Namespaced storage keys
// ---------------------------------------------------------------------------
const REQ_KEY = 'intra.procurement.v2.requests';
const PO_KEY = 'intra.procurement.v2.purchase_orders';
const APPR_KEY = 'intra.procurement.v2.approvals';
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

function safeWrite<T>(key: string, rows: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(new Event(CHANGE_EVT));
  } catch {
    /* quota exceeded / disabled — noop */
  }
}

function useTrackedRows<T>(key: string): [T[], (rows: T[]) => void, boolean] {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
];

export function useProcurementVendors(): ProcurementVendor[] {
  return DEMO_VENDORS;
}

export function isAccredited(v: ProcurementVendor): boolean {
  if (v.accreditationStatus !== 'approved') return false;
  if (v.accreditationExpiresAt) {
    return new Date(v.accreditationExpiresAt) >= new Date();
  }
  return true;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface NewRequestInput {
  title: string;
  description?: string;
  department?: string;
  costCenter?: string;
  neededBy?: string;
  vendorId?: string;
  vendorName?: string;
  requesterName?: string;
  requesterEmail?: string;
  lines: Array<Omit<ProcurementRequestLine, 'id'>>;
}

function totalOf(lines: ProcurementRequestLine[] | PurchaseOrderLine[]): number {
  return lines.reduce((sum, l) => {
    const price = typeof l.unitPrice === 'number' ? l.unitPrice : 0;
    const qty = typeof l.quantity === 'number' ? l.quantity : 0;
    return sum + price * qty;
  }, 0);
}

export interface ProcurementRequestsAPI {
  rows: ProcurementRequest[];
  loading: boolean;
  add: (input: NewRequestInput) => ProcurementRequest;
  update: (id: string, patch: Partial<ProcurementRequest>) => ProcurementRequest | null;
  submit: (id: string) => ProcurementRequest | null;
  cancel: (id: string) => ProcurementRequest | null;
  decide: (
    id: string,
    decision: 'approved' | 'rejected',
    actor: { email?: string; note?: string },
  ) => ProcurementRequest | null;
  getById: (id: string) => ProcurementRequest | undefined;
}

export function useProcurementRequests(): ProcurementRequestsAPI {
  const [rows, set, loading] = useTrackedRows<ProcurementRequest>(REQ_KEY);

  const add = useCallback(
    (input: NewRequestInput): ProcurementRequest => {
      const lines: ProcurementRequestLine[] = input.lines.map((l) => ({
        ...l,
        id: newId('rl'),
      }));
      const next: ProcurementRequest = {
        id: newId('req'),
        createdAt: nowIso(),
        status: 'draft',
        title: input.title,
        description: input.description,
        department: input.department,
        costCenter: input.costCenter,
        neededBy: input.neededBy,
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        requesterName: input.requesterName,
        requesterEmail: input.requesterEmail,
        lines,
        estimatedAmount: totalOf(lines),
      };
      set([next, ...safeRead<ProcurementRequest>(REQ_KEY)]);
      return next;
    },
    [set],
  );

  const update = useCallback(
    (id: string, patch: Partial<ProcurementRequest>): ProcurementRequest | null => {
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
    [set],
  );

  const submit = useCallback(
    (id: string) =>
      update(id, {
        status: 'submitted',
        submittedAt: nowIso(),
      }),
    [update],
  );

  const cancel = useCallback(
    (id: string) => update(id, { status: 'cancelled' }),
    [update],
  );

  const decide = useCallback(
    (id: string, decision: 'approved' | 'rejected', actor: { email?: string; note?: string }) => {
      const patch: Partial<ProcurementRequest> = {
        status: decision === 'approved' ? 'approved' : 'rejected',
        decidedAt: nowIso(),
        decisionNote: actor.note,
        decidedByEmail: actor.email,
      };
      const row = update(id, patch);
      if (row) recordApproval({
        entityType: 'request',
        entityId: id,
        decision,
        note: actor.note,
        decidedAt: patch.decidedAt!,
        decidedByEmail: actor.email,
      });
      return row;
    },
    [update],
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
  add: (input: NewPOInput) => PurchaseOrder;
  approve: (id: string, actor: { email?: string }) => PurchaseOrder | null;
  issue: (id: string) => PurchaseOrder | null;
  cancel: (id: string) => PurchaseOrder | null;
  receive: (id: string, line: string, qty: number) => PurchaseOrder | null;
  getById: (id: string) => PurchaseOrder | undefined;
}

export function usePurchaseOrders(): PurchaseOrdersAPI {
  const [rows, set, loading] = useTrackedRows<PurchaseOrder>(PO_KEY);

  const add = useCallback(
    (input: NewPOInput): PurchaseOrder => {
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
      set([next, ...existing]);
      return next;
    },
    [set],
  );

  const patch = useCallback(
    (id: string, p: Partial<PurchaseOrder>): PurchaseOrder | null => {
      const current = safeRead<PurchaseOrder>(PO_KEY);
      const idx = current.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const merged: PurchaseOrder = { ...current[idx]!, ...p, updatedAt: nowIso() };
      const nextList = current.slice();
      nextList[idx] = merged;
      set(nextList);
      return merged;
    },
    [set],
  );

  const approve = useCallback(
    (id: string, actor: { email?: string }) =>
      patch(id, { status: 'approved', approvedAt: nowIso(), approvedByEmail: actor.email }),
    [patch],
  );

  const issue = useCallback((id: string) => patch(id, { status: 'issued' }), [patch]);
  const cancel = useCallback((id: string) => patch(id, { status: 'cancelled' }), [patch]);

  const receive = useCallback(
    (id: string, lineId: string, qty: number): PurchaseOrder | null => {
      const current = safeRead<PurchaseOrder>(PO_KEY);
      const po = current.find((r) => r.id === id);
      if (!po) return null;
      const lines = po.lines.map((l) =>
        l.id === lineId
          ? { ...l, receivedQuantity: Math.min(l.quantity, l.receivedQuantity + qty) }
          : l,
      );
      const allDone = lines.every((l) => l.receivedQuantity >= l.quantity);
      const status: PurchaseOrder['status'] = allDone ? 'closed' : 'issued';
      return patch(id, { lines, status });
    },
    [patch],
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
  const [rows] = useTrackedRows<ApprovalDecision>(APPR_KEY);
  if (!entityId) return rows;
  return rows.filter((r) => r.entityId === entityId);
}
