// Procurement CSV handoff (policy §finance). MVP integration boundary is CSV
// only — this produces the PO extract Finance imports downstream. Pure string
// builders (no DOM) so they are unit-testable; `downloadCsv` is the thin
// browser side-effect.

import type { PurchaseOrder } from './types';

function csvCell(value: string | number | undefined | null): string {
  const s = value == null ? '' : String(value);
  // Escape per RFC 4180 when the cell contains a comma, quote, or newline.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: (string | number | undefined | null)[]): string {
  return cells.map(csvCell).join(',');
}

const PO_HEADERS = [
  'PO Number',
  'Vendor',
  'Status',
  'Origin',
  'Total',
  'Ordered Units',
  'Received Units',
  'Request ID',
  'Created',
  'Updated',
  'Approved',
  'Approved By',
] as const;

/** Build a finance-ready CSV extract of purchase orders. */
export function purchaseOrdersToCsv(pos: readonly PurchaseOrder[]): string {
  const rows = pos.map((po) => {
    const ordered = po.lines.reduce((s, l) => s + l.quantity, 0);
    const received = po.lines.reduce((s, l) => s + l.receivedQuantity, 0);
    return csvRow([
      po.poNumber,
      po.vendorName,
      po.status,
      po.origin,
      po.total,
      ordered,
      received,
      po.requestId ?? '',
      po.createdAt,
      po.updatedAt,
      po.approvedAt ?? '',
      po.approvedByEmail ?? '',
    ]);
  });
  return [csvRow([...PO_HEADERS]), ...rows].join('\n');
}

/** Trigger a client-side CSV download. No-op during SSR. */
export function downloadCsv(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
