import type { InventoryUnit, Movement } from './types';

function byCreatedAtAsc(a: Movement, b: Movement): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function byCreatedAtDesc(a: Movement, b: Movement): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Chronological ledger for a single serialized unit.
 *
 * Serial-specific movements (e.g. returns, which carry a serial) are always
 * included. Receipt/issue/transfer/adjustment movements are recorded at the
 * aggregate product level without a serial number, so when a `productId` is
 * supplied we also fold in those product-level entries — otherwise a tapped
 * device would miss its core receive/issue/transfer history.
 */
const PRODUCT_LEVEL_TYPES: ReadonlySet<Movement['type']> = new Set([
  'receipt',
  'issue',
  'transfer',
  'adjustment',
]);

export function unitTimeline(
  movements: Movement[],
  serialNumber: string,
  productId?: string,
): Movement[] {
  return movements
    .filter((m) => {
      if (m.serialNumber === serialNumber) return true;
      if (!productId) return false;
      return (
        m.productId === productId &&
        !m.serialNumber &&
        PRODUCT_LEVEL_TYPES.has(m.type)
      );
    })
    .sort(byCreatedAtAsc);
}

export function findUnitBySerial(
  units: InventoryUnit[],
  serial: string,
): InventoryUnit | undefined {
  return units.find((u) => u.serialNumber === serial);
}

/** All movements for a product, most recent first. */
export function productMovementHistory(
  movements: Movement[],
  productId: string,
): Movement[] {
  return movements
    .filter((m) => m.productId === productId)
    .sort(byCreatedAtDesc);
}
