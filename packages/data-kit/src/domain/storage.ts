import type { StockState } from './stock';
import type { InventoryUnit, Location, StorageArea } from './types';

export interface BinQuantity {
  /** undefined = general / unassigned area within the location. */
  binId?: string;
  quantity: number;
}

function isSerialized(state: StockState, productId: string): boolean {
  return state.products.find((p) => p.id === productId)?.serialized ?? false;
}

/**
 * Per-bin stock breakdown for a product at a location (the "stored in" view).
 * Serialized: counts in_stock units per bin. Non-serialized: sums stock levels
 * per bin. Bins with zero on-hand are omitted. `binId` undefined = general area.
 */
export function stockByBin(
  state: StockState,
  productId: string,
  locationId: string,
): BinQuantity[] {
  const totals = new Map<string, number>();
  const key = (binId?: string) => binId ?? '';
  if (isSerialized(state, productId)) {
    for (const u of state.units) {
      if (
        u.productId !== productId ||
        u.status !== 'in_stock' ||
        u.locationId !== locationId
      )
        continue;
      totals.set(key(u.binId), (totals.get(key(u.binId)) ?? 0) + 1);
    }
  } else {
    for (const s of state.stockLevels) {
      if (s.productId !== productId || s.locationId !== locationId) continue;
      totals.set(key(s.binId), (totals.get(key(s.binId)) ?? 0) + s.quantity);
    }
  }
  return [...totals.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([k, quantity]) => ({ binId: k === '' ? undefined : k, quantity }));
}

export interface BinContentLine {
  productId: string;
  productName: string;
  sku: string;
  serialized: boolean;
  quantity: number;
}

/**
 * Everything currently stored in one bin — the result of scanning a shelf.
 * Aggregates serialized units and non-serialized stock for that bin.
 */
export function binContents(
  state: StockState,
  binId: string,
): BinContentLine[] {
  const byProduct = new Map<string, number>();
  for (const u of state.units) {
    if (u.binId === binId && u.status === 'in_stock') {
      byProduct.set(u.productId, (byProduct.get(u.productId) ?? 0) + 1);
    }
  }
  for (const s of state.stockLevels) {
    if (s.binId === binId && s.quantity > 0) {
      byProduct.set(s.productId, (byProduct.get(s.productId) ?? 0) + s.quantity);
    }
  }
  return [...byProduct.entries()]
    .map(([productId, quantity]) => {
      const product = state.products.find((p) => p.id === productId);
      return {
        productId,
        productName: product?.name ?? productId,
        sku: product?.sku ?? productId,
        serialized: product?.serialized ?? false,
        quantity,
      };
    })
    .filter((l) => l.quantity > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Serialized units physically located in a given bin (in_stock only). */
export function unitsInBin(
  units: InventoryUnit[],
  binId: string,
): InventoryUnit[] {
  return units.filter((u) => u.binId === binId && u.status === 'in_stock');
}

/** Storage areas belonging to a warehouse, active first then by code. */
export function binsForLocation(
  areas: StorageArea[],
  locationId: string,
): StorageArea[] {
  return areas
    .filter((a) => a.locationId === locationId)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Suggests a scannable bin code from a warehouse + a short label. e.g.
 * "Pasig Main Warehouse" + "A-12" -> "PASIG-A-12". Falls back to a random
 * suffix when no label is given.
 */
export function suggestBinCode(location: Location | undefined, label: string): string {
  const prefix = ((location?.name ?? 'WH')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')[0] ?? 'WH')
    .toUpperCase()
    .slice(0, 6);
  const suffix =
    label
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase() || Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}
