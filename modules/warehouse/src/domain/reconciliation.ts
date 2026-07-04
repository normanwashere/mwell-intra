import type { CycleCount, Movement, Product } from './types';

export interface ReconciliationRow {
  productId: string;
  sku: string;
  name: string;
  expected: number;
  counted: number;
  variance: number;
  countedAt: string;
  locationId: string;
  /** Storage area the count was scoped to (undefined = location-wide). */
  binId?: string;
}

/**
 * Variance rows drawn from the most recent cycle count per product. Only lines
 * with a non-zero variance are returned, newest count first.
 *
 * When `movements` is supplied, a variance is considered *resolved* (and dropped
 * from the list) once an `adjustment` movement for that product has been posted
 * after the count — this backs the Finance "Post adjustment" workflow.
 */
export function reconciliationRows(
  cycleCounts: CycleCount[],
  products: Product[],
  movements: Movement[] = [],
): ReconciliationRow[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  // Most recent count per (product, location, bin) — a SKU counted in two bins
  // yields two independent variance rows so neither is silently dropped.
  const latest = new Map<
    string,
    {
      productId: string;
      expected: number;
      counted: number;
      countedAt: string;
      locationId: string;
      binId?: string;
    }
  >();

  const scopeKey = (productId: string, locationId: string, binId?: string) =>
    `${productId}|${locationId}|${binId ?? ''}`;

  for (const count of cycleCounts) {
    for (const line of count.lines) {
      const key = scopeKey(line.productId, count.locationId, count.binId);
      const existing = latest.get(key);
      if (!existing || count.createdAt > existing.countedAt) {
        latest.set(key, {
          productId: line.productId,
          expected: line.expected,
          counted: line.counted,
          countedAt: count.createdAt,
          locationId: count.locationId,
          binId: count.binId,
        });
      }
    }
  }

  // A variance is resolved once an adjustment for the SAME scope
  // (product + location + bin) is posted after the count.
  const isResolved = (
    productId: string,
    locationId: string,
    binId: string | undefined,
    countedAt: string,
  ): boolean =>
    movements.some(
      (m) =>
        m.type === 'adjustment' &&
        m.productId === productId &&
        m.createdAt > countedAt &&
        (m.toLocationId === undefined || m.toLocationId === locationId) &&
        (m.toBinId ?? undefined) === (binId ?? undefined),
    );

  return [...latest.values()]
    .map(({ productId, expected, counted, countedAt, locationId, binId }) => {
      const product = productById.get(productId);
      return {
        productId,
        sku: product?.sku ?? productId,
        name: product?.name ?? productId,
        expected,
        counted,
        variance: counted - expected,
        countedAt,
        locationId,
        binId,
      };
    })
    .filter(
      (row) =>
        row.variance !== 0 &&
        !isResolved(row.productId, row.locationId, row.binId, row.countedAt),
    )
    .sort((a, b) => b.countedAt.localeCompare(a.countedAt));
}
