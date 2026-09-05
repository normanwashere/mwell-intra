import type { PageQuery, PageResult, QualityInspection, WarehouseData } from '@intra/data-kit';

export async function loadCompleteControlQueue<T>(load: (query: PageQuery) => Promise<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await load({ limit: 100, ...(cursor ? { cursor } : {}) });
    rows.push(...page.rows);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('The queue could not be loaded completely. Retry before acting.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}

export interface PendingInspection {
  id: string;
  sourceType: 'receipt' | 'return';
  sourceId: string;
  productId: string;
  quantity: number;
  binId?: string;
  recordedAt: string;
  procurementPoLineId?: string;
  serialNumber?: string;
}

export function pendingQualityWork(data: WarehouseData, inspections: QualityInspection[]): PendingInspection[] {
  const pending: PendingInspection[] = inspections.filter(i => i.disposition === 'pending').map(i => ({
    id: i.id, sourceType: i.sourceType, sourceId: i.sourceId, productId: i.productId,
    quantity: i.quantity, binId: i.binId, serialNumber: i.serialNumber,
    procurementPoLineId: i.procurementPoLineId, recordedAt: i.inspectedAt,
  }));
  // Legacy receipts do not all have a line ID. Consume each inspection quantity
  // once across matching lines instead of subtracting the same total repeatedly.
  const remaining = new Map(inspections.map(i => [i.id, i.quantity]));
  const consume = (quantity: number, matches: (i: QualityInspection) => boolean) => {
    let outstanding = quantity;
    for (const i of inspections.filter(matches)) {
      const used = Math.min(outstanding, remaining.get(i.id) ?? 0);
      remaining.set(i.id, (remaining.get(i.id) ?? 0) - used);
      outstanding -= used;
      if (!outstanding) break;
    }
    return outstanding;
  };
  for (const receipt of data.receipts) receipt.lines.forEach((line, index) => {
    const lineId = line.procurementLineId;
    const quantity = consume(line.quantity, i => i.sourceType === 'receipt' && i.sourceId === receipt.id
      && i.productId === line.productId && (!i.procurementPoLineId || i.procurementPoLineId === lineId)
      && (!i.serialNumber || !line.serialNumbers?.length || line.serialNumbers.includes(i.serialNumber)));
    if (quantity > 0) pending.push({ id: `${receipt.id}-${line.productId}-${index}`, sourceType: 'receipt',
      sourceId: receipt.id, productId: line.productId, quantity, binId: line.binId,
      procurementPoLineId: lineId, recordedAt: receipt.createdAt });
  });
  for (const returned of data.returns) returned.lines.forEach((line, index) => {
    const quantity = consume(line.quantity, i => i.sourceType === 'return' && i.sourceId === returned.id
      && i.productId === line.productId && (i.binId ?? null) === (line.binId ?? null)
      && (i.serialNumber ?? null) === (line.serialNumber ?? null));
    if (quantity > 0) pending.push({ id: `${returned.id}-${line.productId}-${index}`, sourceType: 'return',
      sourceId: returned.id, productId: line.productId, quantity, binId: line.binId,
      serialNumber: line.serialNumber, recordedAt: returned.createdAt });
  });
  return pending.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
}
