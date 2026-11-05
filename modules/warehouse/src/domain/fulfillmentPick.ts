import type { FulfillmentOrder, InventoryHold, InventoryPosition, StorageArea, WarehouseData } from '@intra/data-kit';
import { matchingUnitHolds } from './useProductHolds';

type PickStock = Pick<WarehouseData, 'products' | 'units' | 'stockLevels' | 'storageAreas' | 'fulfillmentReservations'>;

// This is a routing suggestion, not stock authority. The command still validates
// current custody, holds and reservations under the server's transaction locks.
export function fulfillmentPickBins(
  data: PickStock,
  order: FulfillmentOrder,
  productId: string,
  holds: InventoryHold[] = [],
  positions: InventoryPosition[] = [],
): { bin: StorageArea; available: number }[] {
  const product = data.products.find(row => row.id === productId);
  const units = data.units.filter(unit => unit.productId === productId && unit.status === 'in_stock'
    && (!order.sourceLocationId || unit.locationId === order.sourceLocationId));
  const levels = data.stockLevels.filter(level => level.productId === productId && level.quantity > 0
    && (!order.sourceLocationId || level.locationId === order.sourceLocationId));
  const binIds = order.sourceBinId ? [order.sourceBinId]
    : [...new Set((product?.serialized ? units : levels).map(row => row.binId))];
  const bins = binIds.flatMap(id => data.storageAreas.filter(bin => id && bin.id === id));
  return bins.filter(bin => bin.active !== false && (!order.sourceLocationId || bin.locationId === order.sourceLocationId)).map(bin => {
    const available = product?.serialized
      ? units.filter(unit => unit.binId === bin.id && unit.locationId === bin.locationId
        && matchingUnitHolds(holds, unit).length === 0).length
      : levels.filter(level => level.binId === bin.id && level.locationId === bin.locationId)
        .reduce((sum, level) => {
          const held = holds.filter(hold => hold.status === 'active' && hold.productId === productId
            && hold.locationId === level.locationId && (hold.binId ?? null) === (level.binId ?? null)
            && (hold.lotId ?? null) === (level.lotId ?? null))
            .reduce((total, hold) => total + hold.quantity, 0);
          return sum + Math.max(0, level.quantity - Math.max(level.unavailable ?? 0, held));
        }, 0);
    // Do not subtract this order's own reservation. Unscoped demand remains a
    // product-wide server check; it cannot be assigned to every candidate bin.
    const otherScoped = data.fulfillmentReservations.filter(reservation => reservation.status === 'active'
      && reservation.orderId !== order.id && reservation.productId === productId && reservation.binId === bin.id
      && (!reservation.locationId || reservation.locationId === bin.locationId))
      .reduce((sum, reservation) => sum + reservation.quantity, 0);
    const position = positions.find(row => row.productId === productId && row.locationId === bin.locationId && row.binId === bin.id);
    const positionAvailable = position && [position.onHand, position.held, position.unavailable].every(Number.isFinite)
      ? Math.max(0, position.onHand - position.held - position.unavailable) : available;
    return { bin, available: Math.max(0, Math.min(available, positionAvailable) - otherScoped) };
  });
}

export function recommendedFulfillmentBin(
  data: PickStock, order: FulfillmentOrder, productId: string, holds: InventoryHold[] = [], positions: InventoryPosition[] = [],
): StorageArea | undefined {
  const required = order.lines.find(line => line.productId === productId)?.quantity ?? 0;
  const bins = fulfillmentPickBins(data, order, productId, holds, positions);
  // Retain the existing single-bin/partial-stock path when no whole-line bin
  // exists. Never silently turn known binned stock into general-area custody.
  return (bins.find(candidate => candidate.available >= required) ?? bins[0])?.bin;
}
