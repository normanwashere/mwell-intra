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
  const specificity = (i: QualityInspection) => 2 * Number(Boolean(i.procurementPoLineId))
    + 4 * Number(Boolean(i.serialNumber)) + Number(Boolean(i.binId));
  const unique = new Map<string, QualityInspection>();
  const identity = (i: QualityInspection) => JSON.stringify([
    i.sourceType, i.sourceId, i.productId, i.quantity, i.disposition,
    i.procurementPoLineId ?? null, i.serialNumber ?? null, i.binId ?? null, i.inspectedAt,
  ]);
  for (const inspection of inspections) {
    const previous = unique.get(inspection.id);
    if (previous && identity(previous) !== identity(inspection)) {
      throw new Error('Conflicting inspection records. Reload the quality queue before acting.');
    }
    unique.set(inspection.id, inspection);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    specificity(b) - specificity(a)
    || a.id.localeCompare(b.id));
  const pending: PendingInspection[] = ordered.filter(i => i.disposition === 'pending').map(i => ({
    id: i.id, sourceType: i.sourceType, sourceId: i.sourceId, productId: i.productId,
    quantity: i.quantity, binId: i.binId, serialNumber: i.serialNumber,
    procurementPoLineId: i.procurementPoLineId, recordedAt: i.inspectedAt,
  }));
  // Legacy receipts do not all have a line ID. Consume each inspection quantity
  // once across matching lines instead of subtracting the same total repeatedly.
  const remaining = new Map(ordered.map(i => [i.id, i.quantity]));
  const consume = (quantity: number, matches: (i: QualityInspection) => boolean) => {
    let outstanding = quantity;
    for (const i of ordered.filter(matches)) {
      const used = Math.min(outstanding, remaining.get(i.id) ?? 0);
      remaining.set(i.id, (remaining.get(i.id) ?? 0) - used);
      outstanding -= used;
      if (!outstanding) break;
    }
    return outstanding;
  };
  for (const receipt of data.receipts) {
    const slots = receipt.lines.flatMap<{ line: typeof receipt.lines[number]; index: number; serialNumber: string | undefined; quantity: number }>((line, index) => {
      const serials = [...new Set(line.serialNumbers ?? [])].sort();
      return serials.length && serials.length === line.quantity ? serials.map(serialNumber => ({ line, index, serialNumber, quantity: 1 }))
        : [{ line, index, serialNumber: undefined, quantity: line.quantity }];
    });
    // Exact identifiers get first claim on custody. Legacy rows can consume
    // repeated equivalent lines, but never choose among distinct identities.
    for (const inspection of ordered.filter(i => i.sourceType === 'receipt' && i.sourceId === receipt.id)) {
      const candidates = slots.filter(slot => slot.quantity > 0
        && slot.line.productId === inspection.productId
        && (!inspection.procurementPoLineId || slot.line.procurementLineId === inspection.procurementPoLineId)
        && (!inspection.serialNumber || slot.serialNumber === inspection.serialNumber)
        && (!inspection.binId || slot.line.binId === inspection.binId
          || (!slot.line.binId && Boolean(inspection.procurementPoLineId || inspection.serialNumber))));
      const identities = new Set(candidates.map(slot => JSON.stringify([
        slot.line.procurementLineId ?? null, slot.line.binId ?? null, slot.serialNumber ?? null,
      ])));
      if (identities.size !== 1) continue;
      for (const slot of candidates) {
        const used = Math.min(slot.quantity, remaining.get(inspection.id) ?? 0);
        slot.quantity -= used;
        remaining.set(inspection.id, (remaining.get(inspection.id) ?? 0) - used);
      }
    }
    for (const slot of slots) if (slot.quantity > 0) pending.push({
      id: `${receipt.id}-${slot.line.productId}-${slot.index}${slot.serialNumber ? `-${slot.serialNumber}` : ''}`,
      sourceType: 'receipt', sourceId: receipt.id, productId: slot.line.productId, quantity: slot.quantity,
      binId: slot.line.binId, serialNumber: slot.serialNumber,
      procurementPoLineId: slot.line.procurementLineId, recordedAt: receipt.createdAt,
    });
  }
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
