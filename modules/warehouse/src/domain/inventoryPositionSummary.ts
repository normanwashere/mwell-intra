import type { DataSource, InventoryPosition } from '@intra/data-kit';

interface ProductPositionSummary {
  available: number | null;
  unscopedCommitted: number | null;
  /** A valid wire summary may explicitly report unknown product availability. */
  valid: boolean;
}

const quantity = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const legacy = (row: InventoryPosition) => row.productAvailable === undefined
  && row.unscopedCommitted === undefined && row.availabilityVerified === undefined;

export function positionAvailable(row: InventoryPosition, source: DataSource): number | null {
  const verified = quantity(row.productAvailable) && row.availabilityVerified === true && row.unscopedCommitted === 0;
  return (verified || (source === 'memory' && legacy(row))) && quantity(row.available) ? row.available : null;
}

export function productPositionSummaries(rows: InventoryPosition[], source: DataSource): Map<string, ProductPositionSummary> {
  const groups = new Map<string, InventoryPosition[]>();
  for (const row of rows) {
    const group = groups.get(row.productId);
    if (group) group.push(row);
    else groups.set(row.productId, [row]);
  }
  return new Map([...groups].map(([productId, positions]) => {
    if (source === 'memory' && positions.every(legacy)) {
      return [productId, { available: positions.every(row => quantity(row.available))
        ? positions.reduce((total, row) => total + row.available, 0) : null, unscopedCommitted: 0,
        valid: positions.every(row => quantity(row.available)) }];
    }
    const first = positions[0]!;
    // Conflicting repeats can indicate a changed snapshot between cursor pages.
    const consistent = positions.every(row => (quantity(row.productAvailable)
      || (row.productAvailable === null && row.availabilityVerified === false && row.available === 0 && row.putawayAvailable === 0))
      && quantity(row.unscopedCommitted)
      && typeof row.availabilityVerified === 'boolean'
      && row.productAvailable === first.productAvailable && row.unscopedCommitted === first.unscopedCommitted);
    return [productId, { available: consistent ? first.productAvailable ?? null : null,
      unscopedCommitted: consistent ? first.unscopedCommitted! : null, valid: consistent }];
  }));
}
