// Procurement → warehouse PO bridge (READ side of J1-6).
//
// The procurement module persists its purchase orders in localStorage under
// `intra.procurement.v2.purchase_orders`. The warehouse module reads that
// store — it NEVER writes it — so procurement-issued POs become visible on
// the warehouse Purchase Orders page ("From Procurement" badge, deep link
// back to /procurement/purchase-orders/<id>).
//
// Contract (owned by the procurement module):
//   Array of { id, poNumber, requestId?, vendorId, vendorName,
//              status: 'draft'|'pending_approval'|'approved'|'issued'|'closed'|'cancelled',
//              expectedDate?, notes?, origin,
//              lines: [{ id, description, quantity, uom?, unitPrice?, receivedQuantity }],
//              createdAt, updatedAt, total }
//
// Defensive by design: the procurement worker may add fields (e.g. receipt
// events) at any time. We ignore unknown fields, tolerate a missing/corrupt
// key, and skip malformed rows rather than throwing.

import { useCallback, useEffect, useState } from 'react';

export const PROCUREMENT_PO_KEY = 'intra.procurement.v2.purchase_orders';
/** Same-tab change event the procurement store dispatches on writes. */
const PROCUREMENT_CHANGE_EVENT = 'intra.procurement.change';

/** Procurement PO statuses the warehouse cares about (receivable). */
const RECEIVABLE_STATUSES = new Set(['approved', 'issued']);

export interface BridgedPOLine {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly uom?: string;
  readonly unitPrice?: number;
  readonly receivedQuantity: number;
}

/** A procurement PO mapped onto the warehouse PO card shape. */
export interface BridgedPO {
  readonly id: string;
  readonly poNumber: string;
  readonly vendorName: string;
  readonly status: 'approved' | 'issued';
  readonly expectedDate?: string;
  readonly createdAt: string;
  readonly lines: readonly BridgedPOLine[];
  /** Sum of ordered quantities across lines. */
  readonly totalOrdered: number;
  /** Sum of received quantities across lines. */
  readonly totalReceived: number;
  /** PO value: the store's `total` when sane, else Σ qty × unitPrice. */
  readonly value: number;
  /** Deep link back to the procurement module's PO detail. */
  readonly href: string;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function mapLine(raw: unknown, index: number): BridgedPOLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const line = raw as Record<string, unknown>;
  const quantity = asNumber(line.quantity, NaN);
  if (!Number.isFinite(quantity)) return null;
  return {
    id: asString(line.id, `line-${index}`),
    description: asString(line.description, 'Line item'),
    quantity,
    uom: typeof line.uom === 'string' ? line.uom : undefined,
    unitPrice:
      typeof line.unitPrice === 'number' && Number.isFinite(line.unitPrice)
        ? line.unitPrice
        : undefined,
    receivedQuantity: asNumber(line.receivedQuantity, 0),
  };
}

function mapPO(raw: unknown): BridgedPO | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const po = raw as Record<string, unknown>;
  const id = asString(po.id);
  const status = asString(po.status);
  if (!id || !RECEIVABLE_STATUSES.has(status)) return null;
  const lines = Array.isArray(po.lines)
    ? po.lines
        .map((l, i) => mapLine(l, i))
        .filter((l): l is BridgedPOLine => l !== null)
    : [];
  const totalOrdered = lines.reduce((s, l) => s + l.quantity, 0);
  const totalReceived = lines.reduce((s, l) => s + l.receivedQuantity, 0);
  const storedTotal = asNumber(po.total, NaN);
  const value = Number.isFinite(storedTotal)
    ? storedTotal
    : lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
  return {
    id,
    poNumber: asString(po.poNumber, id),
    vendorName: asString(po.vendorName, 'Unknown vendor'),
    status: status as 'approved' | 'issued',
    expectedDate:
      typeof po.expectedDate === 'string' ? po.expectedDate : undefined,
    createdAt: asString(po.createdAt, new Date(0).toISOString()),
    lines,
    totalOrdered,
    totalReceived,
    value,
    href: `/procurement/purchase-orders/${encodeURIComponent(id)}`,
  };
}

/**
 * Read receivable (approved/issued) procurement POs from localStorage.
 * Returns [] when the key is absent, corrupt, or not an array.
 */
export function readProcurementPOs(
  storage: Pick<Storage, 'getItem'> | undefined = typeof window !== 'undefined'
    ? window.localStorage
    : undefined,
): BridgedPO[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROCUREMENT_PO_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(mapPO)
    .filter((po): po is BridgedPO => po !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Live view of the bridged procurement POs. Re-reads on the procurement
 * module's same-tab change event and on cross-tab storage events.
 */
export function useProcurementPOs(): BridgedPO[] {
  // Start empty so SSR + first client render match.
  const [pos, setPos] = useState<BridgedPO[]>([]);

  const refresh = useCallback(() => {
    setPos(readProcurementPOs());
  }, []);

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === PROCUREMENT_PO_KEY) refresh();
    };
    window.addEventListener(PROCUREMENT_CHANGE_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PROCUREMENT_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  return pos;
}
