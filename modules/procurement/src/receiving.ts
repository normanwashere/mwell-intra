// Pure PO-receipt math (UX-REVIEW-FULL-APP.md PR-24 / J2-7). Kept
// side-effect-free so the receive sheet, the localStore mutation, and the
// vitest specs all run the same clamping rules.

import type { PurchaseOrderLine } from './types';

/** Units still expected on a line (never negative). */
export function outstandingOf(line: PurchaseOrderLine): number {
  return Math.max(0, line.quantity - line.receivedQuantity);
}

export interface ReceiptLineInput {
  lineId: string;
  quantity: number;
}

export interface AcceptedReceiptLine {
  lineId: string;
  description: string;
  quantity: number;
}

export interface ApplyReceiptResult {
  /** Line list with receivedQuantity advanced (clamped to ordered qty). */
  lines: PurchaseOrderLine[];
  /** What was actually accepted after clamping/filtering. */
  accepted: AcceptedReceiptLine[];
  /** True when every line is now fully received → PO closes. */
  closes: boolean;
}

/**
 * Apply a (possibly partial) receipt to a PO's lines.
 *  - Quantities are clamped to each line's outstanding amount.
 *  - Zero/negative/NaN quantities and unknown line ids are ignored.
 *  - Returns null when nothing was accepted (caller shows an error toast
 *    instead of writing a no-op receipt).
 */
export function applyReceipt(
  lines: PurchaseOrderLine[],
  inputs: ReceiptLineInput[],
): ApplyReceiptResult | null {
  const wanted = new Map<string, number>();
  for (const input of inputs) {
    const qty = Number(input.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    wanted.set(input.lineId, qty);
  }

  const accepted: AcceptedReceiptLine[] = [];
  const nextLines = lines.map((line) => {
    const qty = wanted.get(line.id);
    if (qty === undefined) return line;
    const take = Math.min(qty, outstandingOf(line));
    if (take <= 0) return line;
    accepted.push({ lineId: line.id, description: line.description, quantity: take });
    return { ...line, receivedQuantity: line.receivedQuantity + take };
  });

  if (accepted.length === 0) return null;

  const closes = nextLines.every((l) => l.receivedQuantity >= l.quantity);
  return { lines: nextLines, accepted, closes };
}
