import type {
  InventoryUnit,
  ItemCategory,
  Product,
  StockLevel,
} from './types';

/** A minimal read-model of inventory used by pure stock calculations. */
export interface StockState {
  products: Product[];
  units: InventoryUnit[];
  stockLevels: StockLevel[];
}

export interface LowStockEntry {
  product: Product;
  available: number;
}

function isSerialized(state: StockState, productId: string): boolean {
  return state.products.find((p) => p.id === productId)?.serialized ?? false;
}

/**
 * Quantity available to allocate/issue right now.
 * Serialized: units currently `in_stock`. Non-serialized: summed stock levels.
 */
export function availableForProduct(
  state: StockState,
  productId: string,
  locationId?: string,
  binId?: string,
): number {
  if (isSerialized(state, productId)) {
    return state.units.filter(
      (u) =>
        u.productId === productId &&
        u.status === 'in_stock' &&
        (locationId === undefined || u.locationId === locationId) &&
        (binId === undefined || u.binId === binId),
    ).length;
  }
  return state.stockLevels
    .filter(
      (s) =>
        s.productId === productId &&
        (locationId === undefined || s.locationId === locationId) &&
        (binId === undefined || s.binId === binId),
    )
    .reduce((sum, s) => sum + s.quantity, 0);
}

/**
 * Physical units present (not lost). For serialized items this counts every
 * non-lost unit; for non-serialized it equals available quantity.
 */
export function onHand(
  state: StockState,
  productId: string,
  locationId?: string,
): number {
  if (isSerialized(state, productId)) {
    return state.units.filter(
      (u) =>
        u.productId === productId &&
        u.status !== 'lost' &&
        (locationId === undefined || u.locationId === locationId),
    ).length;
  }
  return availableForProduct(state, productId, locationId);
}

export function isBelowReorder(product: Product, available: number): boolean {
  return available <= product.reorderPoint;
}

export function lowStockProducts(state: StockState): LowStockEntry[] {
  return state.products
    .map((product) => ({
      product,
      available: availableForProduct(state, product.id),
    }))
    .filter(({ product, available }) => isBelowReorder(product, available));
}

export function inventoryValuation(
  state: StockState,
  category?: ItemCategory,
): number {
  return state.products
    .filter((p) => category === undefined || p.category === category)
    .reduce((sum, p) => sum + onHand(state, p.id) * p.unitCost, 0);
}
