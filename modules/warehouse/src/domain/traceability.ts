import type { InventoryUnit, Movement } from './types';

function byCreatedAtAsc(a: Movement, b: Movement): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function byCreatedAtDesc(a: Movement, b: Movement): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Only explicit serial attribution establishes a unit's movement history. */
export function unitTimeline(
  movements: Movement[],
  serialNumber: string,
  productId?: string,
): Movement[] {
  return movements
    .filter((m) => m.serialNumber === serialNumber && (!productId || m.productId === productId))
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
