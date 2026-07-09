import { availableForProduct, type StockState } from './stock';
import type { Allocation, AllocationStatus, InventoryUnit } from './types';

const COMMITTED_STATUSES: AllocationStatus[] = ['reserved', 'allocated'];

/** Quantity currently held by active (reserved/allocated) commitments. */
export function committedQuantity(
  allocations: Allocation[],
  productId: string,
): number {
  return allocations
    .filter(
      (a) => a.productId === productId && COMMITTED_STATUSES.includes(a.status),
    )
    .reduce((sum, a) => sum + a.quantity, 0);
}

/**
 * Physical availability minus active commitments (floored at 0).
 *
 * Commitments (reserved/allocated) are NOT location-scoped in the current
 * model, so this figure is intentionally computed across all locations — a
 * `locationId` cannot be honored correctly here and was therefore removed to
 * avoid subtracting all-location commitments from location-scoped physical.
 */
export function uncommittedAvailable(
  state: StockState,
  allocations: Allocation[],
  productId: string,
): number {
  const physical = availableForProduct(state, productId);
  const committed = committedQuantity(allocations, productId);
  return Math.max(0, physical - committed);
}

export function canReserve(
  state: StockState,
  allocations: Allocation[],
  productId: string,
  quantity: number,
): boolean {
  if (quantity <= 0) return false;
  return uncommittedAvailable(state, allocations, productId) >= quantity;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateReservation(
  state: StockState,
  allocations: Allocation[],
  productId: string,
  quantity: number,
): ValidationResult {
  if (quantity <= 0) {
    return { ok: false, error: 'Quantity must be greater than zero.' };
  }
  const available = uncommittedAvailable(state, allocations, productId);
  if (quantity > available) {
    return {
      ok: false,
      error: `Cannot reserve ${quantity} — only ${available} available.`,
    };
  }
  return { ok: true };
}

/**
 * Decide whether a return operation closes an issued allocation.
 *
 * For serialized products we track individual units, so an allocation only
 * flips to `returned` once no issued units remain for it — this makes partial
 * serialized returns keep the allocation `issued`. For non-serialized products
 * (no per-unit ledger) we close only when this return covers the full
 * allocation quantity, so a partial return does not prematurely close it.
 */
export function returnClosesAllocation(
  allocation: Allocation,
  product: { serialized: boolean } | undefined,
  lines: { productId: string; quantity: number; serialNumber?: string }[],
  units: InventoryUnit[],
): boolean {
  if (product?.serialized) {
    const issued = units.filter(
      (u) =>
        u.productId === allocation.productId &&
        u.status === 'issued' &&
        (allocation.eventId ? u.eventId === allocation.eventId : true),
    );
    const returningNow = new Set(
      lines
        .filter((l) => l.serialNumber)
        .map((l) => l.serialNumber as string),
    );
    const remaining = issued.filter((u) => !returningNow.has(u.serialNumber));
    return remaining.length === 0;
  }
  const returnedQty = lines
    .filter((l) => l.productId === allocation.productId)
    .reduce((sum, l) => sum + l.quantity, 0);
  return returnedQty >= allocation.quantity;
}

export type AllocationSummary = Record<AllocationStatus, number>;

export function eventAllocationSummary(
  allocations: Allocation[],
  eventId: string,
): AllocationSummary {
  const summary: AllocationSummary = {
    reserved: 0,
    allocated: 0,
    issued: 0,
    returned: 0,
    cancelled: 0,
  };
  for (const a of allocations) {
    if (a.eventId === eventId) summary[a.status] += a.quantity;
  }
  return summary;
}
