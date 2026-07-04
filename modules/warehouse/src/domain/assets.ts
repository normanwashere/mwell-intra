import type { InventoryUnit, Product, UnitStatus } from './types';

export interface AssetRegisterRow {
  serialNumber: string;
  productId: string;
  productName: string;
  assignedTo?: string;
  eventId?: string;
  status: UnitStatus;
}

const OUT_IN_FIELD: UnitStatus[] = ['issued', 'allocated'];

/**
 * Register of serialized units currently out in the field (issued or
 * allocated), enriched with product names and sorted by product then serial.
 */
export function serializedAssetRegister(
  units: InventoryUnit[],
  products: Product[],
): AssetRegisterRow[] {
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return units
    .filter((u) => OUT_IN_FIELD.includes(u.status))
    .map<AssetRegisterRow>((u) => ({
      serialNumber: u.serialNumber,
      productId: u.productId,
      productName: nameById.get(u.productId) ?? u.productId,
      assignedTo: u.assignedTo,
      eventId: u.eventId,
      status: u.status,
    }))
    .sort(
      (a, b) =>
        a.productName.localeCompare(b.productName) ||
        a.serialNumber.localeCompare(b.serialNumber),
    );
}
