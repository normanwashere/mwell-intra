/**
 * Framework-agnostic mutation pipeline + optimistic overlay engine.
 *
 * ------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (the React decoupling seam)
 * ------------------------------------------------------------------------
 * In the source app (`mwell-intra-warehouse/src/app/store.tsx`) the mutation
 * pipeline lived *inside* the `WarehouseProvider` React component as a
 * `useCallback`. It reached React state directly (`setData`), the toast context
 * (`useToast`), and the module-level `outbox` helpers.
 *
 * For `@intra/data-kit` (spec §12 step 2 — the data layer must be
 * runtime-agnostic so the warehouse module can run on Next.js) that pipeline is
 * extracted here as PURE functions that take their side effects as injected
 * dependencies:
 *
 *   - React state writes  -> `ctx.applyOptimistic(overlay)` callback
 *                            (the store implements it as
 *                             `setData(prev => prev ? applyOverlay(prev, overlay) : prev)`)
 *   - toast notifications -> `ctx.notifyQueuedOffline` / `ctx.notifyError`
 *   - data refresh        -> `ctx.refresh` / `ctx.refreshPending`
 *   - queue persistence   -> `ctx.enqueue` (defaults to the IndexedDB outbox)
 *
 * The React binding (the `WarehouseProvider` wrappers, `useCallback`, `useState`)
 * will live in the warehouse module and simply call `runAction(ctx, ...)`.
 * `applyOverlay` and every overlay builder are exported so that React layer can
 * reuse them verbatim. Nothing in this file imports React.
 */

import {
  enqueue as outboxEnqueue,
  markConflict as outboxMarkConflict,
  removeEntry as outboxRemove,
  type OutboxEntry,
  type QueueableMethod,
  type WarehousePatch,
} from './outbox';
import { toStockState, type WarehouseData, type WarehouseRepository } from './repository';
import type {
  AdjustStockInput,
  CycleCountInput,
  IssueInput,
  ReceiveStockInput,
  RelocateInput,
  ReturnInput,
  TransferInput,
} from './repository';
import { stockByBin } from './domain/storage';
import { returnClosesAllocation } from './domain/allocations';
// Type-only import (erased under verbatimModuleSyntax — no runtime dependency
// on the repository factory, so no import cycle).
import type { DataSource } from './createRepository';

/** Floor-op mutations eligible for offline queuing. */
export const QUEUEABLE: ReadonlySet<QueueableMethod> = new Set<QueueableMethod>([
  'receiveStock',
  'recordCycleCount',
  'recordReturn',
  'issue',
  'transfer',
  'adjustStock',
  'relocate',
]);

/** Heuristic: a thrown error looks like a network/offline failure. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('err_http') ||
    msg.includes('timeout')
  );
}

/** Apply an optimistic patch to a deep-cloned snapshot (immutably enough for React). */
export function applyOverlay(
  base: WarehouseData,
  patch: WarehousePatch | undefined,
): WarehouseData {
  if (!patch) return base;
  const next: WarehouseData = {
    ...base,
    stockLevels: [...base.stockLevels],
    movements: [...base.movements],
    units: [...base.units],
    lots: [...base.lots],
    receipts: [...base.receipts],
    returns: [...base.returns],
    cycleCounts: [...base.cycleCounts],
    allocations: base.allocations.map((a) => ({ ...a })),
  };
  for (const d of patch.stockDeltas ?? []) {
    const i = next.stockLevels.findIndex(
      (s) =>
        s.productId === d.productId &&
        s.locationId === d.locationId &&
        (s.lotId ?? undefined) === (d.lotId ?? undefined) &&
        (s.binId ?? undefined) === (d.binId ?? undefined),
    );
    if (i >= 0) {
      const existing = next.stockLevels[i]!;
      next.stockLevels[i] = {
        ...existing,
        quantity: Math.max(0, existing.quantity + d.delta),
      };
    } else if (d.delta > 0) {
      next.stockLevels.push({
        productId: d.productId,
        locationId: d.locationId,
        lotId: d.lotId,
        binId: d.binId,
        quantity: d.delta,
      });
    }
  }
  if (patch.appendMovements) next.movements.push(...(patch.appendMovements as never[]));
  if (patch.appendUnits) next.units.push(...(patch.appendUnits as never[]));
  if (patch.appendLots) next.lots.push(...(patch.appendLots as never[]));
  if (patch.appendReceipts) next.receipts.push(...(patch.appendReceipts as never[]));
  if (patch.appendReturns) next.returns.push(...(patch.appendReturns as never[]));
  if (patch.appendCycleCounts)
    next.cycleCounts.push(...(patch.appendCycleCounts as never[]));
  for (const s of patch.setAllocationStatus ?? []) {
    const i = next.allocations.findIndex((a) => a.id === s.allocationId);
    if (i >= 0) next.allocations[i]!.status = s.status as never;
  }
  return next;
}

/**
 * Injected side effects for {@link runAction}. Everything React-specific is a
 * callback so this module stays runtime-agnostic (see file header).
 */
export interface RunActionContext {
  /** Active data source; offline queuing only happens in `'supabase'` mode. */
  source: DataSource;
  /**
   * Apply an optimistic overlay to the cached read model. React seam:
   * `setData(prev => prev ? applyOverlay(prev, overlay) : prev)`.
   */
  applyOptimistic: (overlay: WarehousePatch | undefined) => void;
  /** Re-pull the read model after every action (success or failure). */
  refresh: () => Promise<void>;
  /** Refresh the pending/conflict counters. */
  refreshPending: () => Promise<void>;
  /** Persist a queued intent. Defaults to the IndexedDB outbox `enqueue`. */
  enqueue?: (
    method: QueueableMethod,
    input: Record<string, unknown>,
    overlay?: WarehousePatch,
  ) => Promise<OutboxEntry>;
  /** Notify the user their change was saved offline (e.g. an info toast). */
  notifyQueuedOffline?: (message: string) => void;
  /** Notify the user of a hard failure (e.g. an error toast). */
  notifyError?: (message: string) => void;
  /** Override the queueable predicate (defaults to the standard floor ops). */
  isQueueable?: (method: QueueableMethod | 'other') => boolean;
  /** Override the network-error heuristic (defaults to {@link isNetworkError}). */
  isNetworkError?: (e: unknown) => boolean;
}

/**
 * Runs a mutation. For queueable floor ops that fail with a network error while
 * in Supabase mode, the intent is enqueued and an optimistic overlay is applied
 * to the cached read model — the call resolves `true` so the user's success UI
 * runs and they see their change immediately. Other failures notify an error
 * and resolve `false`.
 *
 * Behaviour is identical to the source `store.tsx#runAction`; only the side
 * effects are injected instead of closed-over React state.
 */
export async function runAction(
  ctx: RunActionContext,
  method: QueueableMethod | 'other',
  fn: () => Promise<unknown>,
  overlay?: WarehousePatch,
  queueInput?: Record<string, unknown>,
): Promise<boolean> {
  const enqueue = ctx.enqueue ?? outboxEnqueue;
  const queueable = ctx.isQueueable ?? ((m) => QUEUEABLE.has(m as QueueableMethod));
  const networkError = ctx.isNetworkError ?? isNetworkError;

  let ok = true;
  try {
    await fn();
  } catch (e) {
    ok = false;
    if (
      ctx.source === 'supabase' &&
      queueable(method) &&
      networkError(e) &&
      queueInput
    ) {
      await enqueue(method as QueueableMethod, queueInput, overlay);
      ctx.notifyQueuedOffline?.('Saved offline — will sync when you reconnect.');
      // Optimistically reflect the change on the cached snapshot.
      ctx.applyOptimistic(overlay);
      ok = true;
    } else {
      ctx.notifyError?.(e instanceof Error ? e.message : 'Action failed.');
    }
  } finally {
    await ctx.refresh();
    await ctx.refreshPending();
  }
  return ok;
}

/**
 * Injected side effects for {@link replayEntry} / {@link syncNow}. Kept
 * framework-agnostic so the offline replay guarantee (spec §12 step 4) lives in
 * data-kit rather than the React store.
 */
export interface ReplayContext {
  repo: WarehouseRepository;
  /** Actor stamped onto the replayed mutation (the signed-in user). */
  actor: string;
  isNetworkError?: (e: unknown) => boolean;
  markConflict?: (id: string, error: string) => Promise<void>;
  removeEntry?: (id: string) => Promise<void>;
}

/** Replay one outbox entry against the live repo. Returns true on success. */
export async function replayEntry(
  ctx: ReplayContext,
  entry: OutboxEntry,
): Promise<boolean> {
  const networkError = ctx.isNetworkError ?? isNetworkError;
  const markConflict = ctx.markConflict ?? outboxMarkConflict;
  const removeEntry = ctx.removeEntry ?? outboxRemove;
  const input = { ...entry.input, actor: ctx.actor } as never;
  try {
    switch (entry.method) {
      case 'receiveStock':
        await ctx.repo.receiveStock(input);
        break;
      case 'recordCycleCount':
        await ctx.repo.recordCycleCount(input);
        break;
      case 'recordReturn':
        await ctx.repo.recordReturn(input);
        break;
      case 'issue':
        await ctx.repo.issue(input);
        break;
      case 'transfer':
        await ctx.repo.transfer(input);
        break;
      case 'adjustStock':
        await ctx.repo.adjustStock(input);
        break;
      case 'relocate':
        await ctx.repo.relocate(input);
        break;
    }
    await removeEntry(entry.id);
    return true;
  } catch (e) {
    // A genuine conflict (e.g. allocation already issued) → flag for the user.
    // A transient network error → leave the entry PENDING so it retries
    // automatically on the next reconnect instead of being permanently marked
    // as a conflict.
    const msg = e instanceof Error ? e.message : 'Replay failed.';
    if (!networkError(e)) {
      await markConflict(entry.id, msg);
    }
    return false;
  }
}

/**
 * Replay all pending entries in FIFO order, then refresh. Stops on the first
 * genuine conflict; remaining entries stay queued.
 */
export async function syncNow(
  ctx: ReplayContext & {
    pending: OutboxEntry[];
    refresh: () => Promise<void>;
    refreshPending: () => Promise<void>;
  },
): Promise<void> {
  if (ctx.pending.length === 0) return;
  for (const entry of ctx.pending) {
    const okOne = await replayEntry(ctx, entry);
    if (!okOne) break; // stop on the first conflict; remaining stay queued
  }
  await ctx.refresh();
  await ctx.refreshPending();
}

// --- optimistic overlay builders (kept pure + side-effect free) ---
// These approximate the server-side effect so the UI updates instantly when a
// floor op is queued offline. They are intentionally best-effort; the replayed
// RPC commit is the source of truth and a `refresh()` corrects any drift once
// back online. Exported so the React store wrappers can build overlays without
// re-implementing them.

let mvSeq = 0;
function tmpId(prefix: string): string {
  return `${prefix}-pending-${Date.now()}-${mvSeq++}`;
}

export function receiveOverlay(
  input: Omit<ReceiveStockInput, 'actor'>,
  actor: string,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  const receiptId = tmpId('rcpt');
  const stockDeltas: NonNullable<WarehousePatch['stockDeltas']> = [];
  const appendMovements: Record<string, unknown>[] = [];
  for (const line of input.lines) {
    stockDeltas.push({
      productId: line.productId,
      locationId: input.locationId,
      binId: line.binId,
      delta: line.quantity,
    });
    appendMovements.push({
      id: tmpId('mv'),
      type: 'receipt',
      productId: line.productId,
      quantity: line.quantity,
      toLocationId: input.locationId,
      toBinId: line.binId,
      reference: receiptId,
      evidenceUrls: input.evidenceUrls ?? [],
      actor,
      createdAt,
    });
  }
  return {
    stockDeltas,
    appendMovements,
    appendReceipts: [
      {
        id: receiptId,
        supplierId: input.supplierId ?? null,
        locationId: input.locationId,
        lines: input.lines,
        evidenceUrls: input.evidenceUrls ?? [],
        actor,
        createdAt,
      },
    ],
  };
}

export function issueOverlay(
  input: Omit<IssueInput, 'actor'>,
  data: WarehouseData | null,
): WarehousePatch {
  const alloc = data?.allocations.find((a) => a.id === input.allocationId);
  if (!alloc || !data) return {};
  const createdAt = new Date().toISOString();
  const product = data.products.find((p) => p.id === alloc.productId);
  // Serialized units are tracked individually (no stock_levels row), so an
  // optimistic quantity decrement would create a phantom negative aggregate.
  // Non-serialized issues can span multiple bins, so mirror the repo's drawdown
  // instead of decrementing a single bin.
  const stockDeltas: NonNullable<WarehousePatch['stockDeltas']> = [];
  if (!product?.serialized) {
    const loc = input.sourceLocationId ?? '';
    const bins = loc
      ? stockByBin(toStockState(data), alloc.productId, loc)
          .slice()
          .sort((a, b) => b.quantity - a.quantity)
      : [];
    // Prefer the explicitly chosen bin, then draw from the fullest bins.
    const chosen = input.sourceBinId
      ? bins.find((b) => (b.binId ?? undefined) === input.sourceBinId)
      : undefined;
    const order = chosen ? [chosen, ...bins.filter((b) => b !== chosen)] : bins;
    let remaining = alloc.quantity;
    for (const b of order) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.quantity);
      if (take > 0) {
        stockDeltas.push({
          productId: alloc.productId,
          locationId: loc,
          binId: b.binId,
          delta: -take,
        });
        remaining -= take;
      }
    }
    // No bin data (e.g. general area) — fall back to a single decrement.
    if (remaining > 0) {
      stockDeltas.push({
        productId: alloc.productId,
        locationId: loc,
        binId: input.sourceBinId,
        delta: -remaining,
      });
    }
  }
  return {
    setAllocationStatus: [{ allocationId: alloc.id, status: 'issued' }],
    stockDeltas,
    appendMovements: [
      {
        id: tmpId('mv'),
        type: 'issue',
        productId: alloc.productId,
        quantity: alloc.quantity,
        fromLocationId: input.sourceLocationId,
        fromBinId: input.sourceBinId,
        eventId: alloc.eventId,
        reference: alloc.id,
        evidenceUrls: input.evidenceUrls ?? [],
        actor: '',
        createdAt,
      },
    ],
  };
}

export function returnOverlay(
  input: Omit<ReturnInput, 'actor'>,
  actor: string,
  data: WarehouseData | null,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  const retId = tmpId('ret');
  const stockDeltas: NonNullable<WarehousePatch['stockDeltas']> = [];
  const appendMovements: Record<string, unknown>[] = [];
  for (const line of input.lines) {
    const product = data?.products.find((p) => p.id === line.productId);
    // Restocked serialized units re-enter as individual units (no aggregate
    // stock_levels row), so only add a quantity delta for non-serialized items.
    if (
      line.disposition === 'restock' &&
      line.locationId &&
      !product?.serialized
    ) {
      stockDeltas.push({
        productId: line.productId,
        locationId: line.locationId,
        binId: line.binId,
        delta: line.quantity,
      });
    }
    appendMovements.push({
      id: tmpId('mv'),
      type: 'return',
      productId: line.productId,
      quantity: line.quantity,
      toLocationId: line.locationId,
      toBinId: line.binId,
      eventId: input.eventId,
      serialNumber: line.serialNumber,
      reason: `${line.reason} (${line.disposition ?? 'restock'})`,
      reference: retId,
      evidenceUrls: input.evidenceUrls ?? [],
      actor,
      createdAt,
    });
  }
  // Only flip the allocation to returned when this return fully accounts for it
  // (mirrors the repository's partial-return lifecycle).
  let setAllocationStatus: WarehousePatch['setAllocationStatus'];
  if (input.allocationId && data) {
    const alloc = data.allocations.find((a) => a.id === input.allocationId);
    if (alloc && alloc.status === 'issued') {
      const product = data.products.find((p) => p.id === alloc.productId);
      if (returnClosesAllocation(alloc, product, input.lines, data.units)) {
        setAllocationStatus = [{ allocationId: alloc.id, status: 'returned' }];
      }
    }
  }
  return {
    stockDeltas,
    appendMovements,
    setAllocationStatus,
    appendReturns: [
      {
        id: retId,
        source: input.source,
        eventId: input.eventId,
        lines: input.lines,
        evidenceUrls: input.evidenceUrls ?? [],
        actor,
        createdAt,
      },
    ],
  };
}

export function cycleCountOverlay(
  input: Omit<CycleCountInput, 'actor'>,
  actor: string,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  const ccId = tmpId('cc');
  const stockDeltas: NonNullable<WarehousePatch['stockDeltas']> = [];
  const appendMovements: Record<string, unknown>[] = [];
  for (const line of input.lines) {
    const variance = line.counted - line.expected;
    if (variance === 0) continue;
    stockDeltas.push({
      productId: line.productId,
      locationId: input.locationId,
      binId: input.binId,
      delta: variance,
    });
    appendMovements.push({
      id: tmpId('mv'),
      type: 'cycle_count',
      productId: line.productId,
      quantity: variance,
      toLocationId: input.locationId,
      toBinId: input.binId,
      reference: ccId,
      reason: 'cycle count adjustment',
      actor,
      createdAt,
    });
  }
  return {
    stockDeltas,
    appendMovements,
    appendCycleCounts: [
      {
        id: ccId,
        locationId: input.locationId,
        binId: input.binId,
        category: input.category,
        lines: input.lines,
        actor,
        createdAt,
      },
    ],
  };
}

export function transferOverlay(
  input: Omit<TransferInput, 'actor'>,
  actor: string,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  return {
    stockDeltas: [
      {
        productId: input.productId,
        locationId: input.fromLocationId,
        binId: input.fromBinId,
        delta: -input.quantity,
      },
      {
        productId: input.productId,
        locationId: input.toLocationId,
        binId: input.toBinId,
        delta: input.quantity,
      },
    ],
    appendMovements: [
      {
        id: tmpId('mv'),
        type: 'transfer',
        productId: input.productId,
        quantity: input.quantity,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        fromBinId: input.fromBinId,
        toBinId: input.toBinId,
        actor,
        createdAt,
      },
    ],
  };
}

/** Bin-to-bin move within one location — decrement source bin, increment target. */
export function relocateOverlay(
  input: Omit<RelocateInput, 'actor'>,
  actor: string,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  return {
    stockDeltas: [
      {
        productId: input.productId,
        locationId: input.locationId,
        binId: input.fromBinId,
        delta: -input.quantity,
      },
      {
        productId: input.productId,
        locationId: input.locationId,
        binId: input.toBinId,
        delta: input.quantity,
      },
    ],
    appendMovements: [
      {
        id: tmpId('mv'),
        type: 'transfer',
        productId: input.productId,
        quantity: input.quantity,
        fromLocationId: input.locationId,
        toLocationId: input.locationId,
        fromBinId: input.fromBinId,
        toBinId: input.toBinId,
        reason: 'bin relocation',
        actor,
        createdAt,
      },
    ],
  };
}

export function adjustOverlay(
  input: Omit<AdjustStockInput, 'actor'>,
  actor: string,
): WarehousePatch {
  const createdAt = new Date().toISOString();
  return {
    stockDeltas: [
      {
        productId: input.productId,
        locationId: input.locationId,
        binId: input.binId,
        delta: input.quantityDelta,
      },
    ],
    appendMovements: [
      {
        id: tmpId('mv'),
        type: 'adjustment',
        productId: input.productId,
        quantity: input.quantityDelta,
        toLocationId: input.locationId,
        toBinId: input.binId,
        reason: input.reason,
        actor,
        createdAt,
      },
    ],
  };
}
