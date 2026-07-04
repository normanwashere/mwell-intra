import { availableForProduct, type StockState } from './stock';
import type { ValidationResult } from './allocations';

export interface LocationQuantity {
  locationId: string;
  quantity: number;
}

function isSerialized(state: StockState, productId: string): boolean {
  return state.products.find((p) => p.id === productId)?.serialized ?? false;
}

/**
 * Stock on hand per location for a product.
 * Serialized: count of `in_stock` units per location.
 * Non-serialized: summed stock levels per location.
 */
export function stockByLocation(
  state: StockState,
  productId: string,
): LocationQuantity[] {
  const totals = new Map<string, number>();
  if (isSerialized(state, productId)) {
    for (const u of state.units) {
      if (u.productId !== productId || u.status !== 'in_stock') continue;
      totals.set(u.locationId, (totals.get(u.locationId) ?? 0) + 1);
    }
  } else {
    for (const s of state.stockLevels) {
      if (s.productId !== productId) continue;
      totals.set(s.locationId, (totals.get(s.locationId) ?? 0) + s.quantity);
    }
  }
  return [...totals.entries()].map(([locationId, quantity]) => ({
    locationId,
    quantity,
  }));
}

/**
 * Location currently holding the most stock for a product (used as the default
 * source when issuing or restocking). Returns undefined if none on hand.
 */
export function primaryStockLocation(
  state: StockState,
  productId: string,
): string | undefined {
  const byLoc = stockByLocation(state, productId)
    .filter((l) => l.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  return byLoc[0]?.locationId;
}

/** Validate a stock transfer between two locations. */
export function validateTransfer(
  state: StockState,
  productId: string,
  fromLocationId: string,
  toLocationId: string,
  quantity: number,
): ValidationResult {
  if (quantity <= 0) {
    return { ok: false, error: 'Quantity must be greater than zero.' };
  }
  if (fromLocationId === toLocationId) {
    return { ok: false, error: 'Source and destination must differ.' };
  }
  const available = availableForProduct(state, productId, fromLocationId);
  if (quantity > available) {
    return {
      ok: false,
      error: `Cannot transfer ${quantity} — only ${available} available at source.`,
    };
  }
  return { ok: true };
}
