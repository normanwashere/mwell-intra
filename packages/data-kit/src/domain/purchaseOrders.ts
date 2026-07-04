import type { POStatus, Product, PurchaseOrder } from './types';

export function poTotalOrdered(po: PurchaseOrder): number {
  return po.lines.reduce((sum, l) => sum + l.quantityOrdered, 0);
}

export function poTotalReceived(po: PurchaseOrder): number {
  return po.lines.reduce((sum, l) => sum + l.quantityReceived, 0);
}

/** Percent of ordered quantity received, rounded to the nearest integer. */
export function poProgress(po: PurchaseOrder): number {
  const ordered = poTotalOrdered(po);
  if (ordered <= 0) return 0;
  return Math.round((poTotalReceived(po) / ordered) * 100);
}

/**
 * Next status for a PO given how much has been received. Terminal `cancelled`
 * orders are left untouched.
 */
export function poStatusAfterReceipt(po: PurchaseOrder): POStatus {
  if (po.status === 'cancelled') return 'cancelled';
  const ordered = poTotalOrdered(po);
  const received = poTotalReceived(po);
  if (received <= 0) return 'ordered';
  if (received >= ordered) return 'received';
  return 'partially_received';
}

/** Total ordered value using each product's unit cost. */
export function poValue(po: PurchaseOrder, products: Product[]): number {
  const costById = new Map(products.map((p) => [p.id, p.unitCost]));
  return po.lines.reduce(
    (sum, l) => sum + l.quantityOrdered * (costById.get(l.productId) ?? 0),
    0,
  );
}
