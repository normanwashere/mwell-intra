import type { Lot, Movement, Product, Supplier } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Landed cost for a product: average unit cost across its received lots,
 * falling back to the product's master unit cost when no lots exist.
 */
export function landedCost(product: Product, lots: Lot[]): number {
  const productLots = lots.filter((l) => l.productId === product.id);
  if (productLots.length === 0) return product.unitCost;
  const total = productLots.reduce((sum, l) => sum + l.unitCost, 0);
  return total / productLots.length;
}

export interface SupplierCostRow {
  supplierId?: string;
  supplierName: string;
  unitCost: number;
}

/**
 * One row per lot of a product showing its unit cost and resolved supplier
 * name (or 'Unknown' when the supplier is missing/unresolved).
 */
export function costVarianceBySupplier(
  lots: Lot[],
  suppliers: Supplier[],
  productId: string,
): SupplierCostRow[] {
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
  return lots
    .filter((l) => l.productId === productId)
    .map<SupplierCostRow>((l) => ({
      supplierId: l.supplierId,
      supplierName:
        (l.supplierId && nameById.get(l.supplierId)) || 'Unknown',
      unitCost: l.unitCost,
    }));
}

/**
 * Inventory turnover for a product over a trailing window: total issued in the
 * last `windowDays` divided by on-hand units, rounded to two decimals.
 */
export function inventoryTurnover(
  movements: Movement[],
  onHandUnits: number,
  productId: string,
  windowDays: number,
): number {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const issued = movements
    .filter(
      (m) =>
        m.type === 'issue' &&
        m.productId === productId &&
        new Date(m.createdAt).getTime() >= cutoff,
    )
    .reduce((sum, m) => sum + m.quantity, 0);
  return Math.round((issued / Math.max(onHandUnits, 1)) * 100) / 100;
}
