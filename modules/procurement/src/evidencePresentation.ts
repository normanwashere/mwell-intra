export function governedReceivedQuantity(
  purchaseOrderId: string,
  lineId: string,
  rows: ReadonlyArray<{ id: string; purchase_order_id: string; received_quantity?: unknown }>,
): number {
  const value = rows.find(row => row.id === lineId && row.purchase_order_id === purchaseOrderId)?.received_quantity;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return Number.NaN;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : Number.NaN;
}

export function receiptQuantityLabel(received: unknown, ordered: unknown): string {
  const quantity = typeof received === 'number' && Number.isFinite(received) && received >= 0 ? received : 'Unknown';
  const total = typeof ordered === 'number' && Number.isFinite(ordered) ? ordered : 'Unknown';
  return `${quantity} / ${total}`;
}

export function quantityLabel(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : 'Unknown';
}

export function poQuantityTotals(lines: ReadonlyArray<{ quantity: number; receivedQuantity: number }>): { ordered: number | undefined; received: number | undefined } {
  const sum = (key: 'quantity' | 'receivedQuantity') => {
    if (!lines.length || lines.some(line => quantityLabel(line[key]) === 'Unknown')) return undefined;
    const total = lines.reduce((value, line) => value + line[key], 0);
    return Number.isFinite(total) ? total : undefined;
  };
  return { ordered: sum('quantity'), received: sum('receivedQuantity') };
}

export function poReceiptSummary(lines: ReadonlyArray<{ quantity: number; receivedQuantity: number }>): string {
  const { ordered, received } = poQuantityTotals(lines);
  return `${lines.length} · ${receiptQuantityLabel(received, ordered)} received`;
}

export function attachmentSizeLabel(bytes: unknown): string {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0
    ? `${(bytes / 1024).toFixed(1)} KB` : 'Size unavailable';
}
