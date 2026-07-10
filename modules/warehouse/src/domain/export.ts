import { availableForProduct, type StockState } from './stock';
import type {
  Allocation,
  Movement,
  Product,
  WarehouseEvent,
} from './types';

type CsvValue = string | number;
export type CsvRow = Record<string, CsvValue>;
export type WarehouseExportKind = 'inventory' | 'movements' | 'allocations';

export function governedExportFilename(
  kind: WarehouseExportKind,
  createdAt = new Date(),
): string {
  const stamp = createdAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `mwell-intra-${kind}-${stamp}.csv`;
}

function escapeCell(value: CsvValue): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize rows to CSV. The header is taken from the keys of the first row.
 * Cells containing commas, quotes or newlines are double-quote escaped.
 * Returns '' for empty input.
 */
export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

export function movementsToCsv(
  movements: Movement[],
  products: Product[],
): string {
  const skuById = new Map(products.map((p) => [p.id, p.sku]));
  const rows: CsvRow[] = movements.map((m) => ({
    createdAt: m.createdAt,
    type: m.type,
    sku: skuById.get(m.productId) ?? m.productId,
    quantity: m.quantity,
    fromLocationId: m.fromLocationId ?? '',
    toLocationId: m.toLocationId ?? '',
    serialNumber: m.serialNumber ?? '',
    reference: m.reference ?? '',
    actor: m.actor,
  }));
  return toCsv(rows);
}

export function inventoryToCsv(state: StockState): string {
  const rows: CsvRow[] = state.products.map((p) => {
    const available = availableForProduct(state, p.id);
    return {
      sku: p.sku,
      name: p.name,
      category: p.category,
      available,
      unitCost: p.unitCost,
      value: available * p.unitCost,
    };
  });
  return toCsv(rows);
}

export function allocationsToCsv(
  allocations: Allocation[],
  products: Product[],
  events: WarehouseEvent[],
): string {
  const skuById = new Map(products.map((p) => [p.id, p.sku]));
  const eventNameById = new Map(events.map((e) => [e.id, e.name]));
  const rows: CsvRow[] = allocations.map((a) => ({
    event: eventNameById.get(a.eventId) ?? a.eventId,
    sku: skuById.get(a.productId) ?? a.productId,
    quantity: a.quantity,
    status: a.status,
    promotional: a.promotional ? 'yes' : 'no',
    createdAt: a.createdAt,
  }));
  return toCsv(rows);
}
