import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  _resetMemoryQueue,
  allPending,
  allConflicts,
  enqueue,
  pendingCount,
  type OutboxEntry,
} from "./outbox";
import {
  applyOverlay,
  runAction,
  replayEntry,
  syncNow,
  transferOverlay,
  receiveOverlay,
  QUEUEABLE,
  type RunActionContext,
} from "./runAction";
import { InMemoryRepository } from "./inMemoryRepository";
import type { WarehouseData } from "./repository";

function emptyData(): WarehouseData {
  return {
    products: [
      {
        id: "shirt",
        sku: "SHIRT",
        name: "Shirt",
        category: "merchandise",
        serialized: false,
        attributes: {},
        unitCost: 10,
        reorderPoint: 1,
      },
    ],
    locations: [{ id: "loc-wh", name: "WH", type: "warehouse" }],
    storageAreas: [],
    suppliers: [],
    lots: [],
    units: [],
    stockLevels: [{ productId: "shirt", locationId: "loc-wh", quantity: 10 }],
    movements: [],
    allocations: [],
    events: [],
    returns: [],
    cycleCounts: [],
    receipts: [],
    purchaseOrders: [],
    fulfillmentOrders: [],
    fulfillmentReservations: [],
    departmentRequestOptions: [],
    departmentStockRequests: [],
    customerReturnCases: [],
    kitDefinitions: [],
    reKitWorkOrders: [],
  };
}

beforeEach(() => {
  _resetMemoryQueue();
});

describe("applyOverlay", () => {
  it("applies stock deltas and appends movements without mutating the base", () => {
    const base = emptyData();
    const next = applyOverlay(base, {
      stockDeltas: [{ productId: "shirt", locationId: "loc-wh", delta: -4 }],
      appendMovements: [{ id: "mv-x", type: "adjustment", productId: "shirt" }],
    });
    expect(next.stockLevels[0]!.quantity).toBe(6);
    expect(next.movements).toHaveLength(1);
    // base untouched (immutable-enough for React)
    expect(base.stockLevels[0]!.quantity).toBe(10);
    expect(base.movements).toHaveLength(0);
  });

  it("never drives an aggregate stock level negative", () => {
    const next = applyOverlay(emptyData(), {
      stockDeltas: [{ productId: "shirt", locationId: "loc-wh", delta: -999 }],
    });
    expect(next.stockLevels[0]!.quantity).toBe(0);
  });

  it("creates a new stock row only for positive deltas", () => {
    const next = applyOverlay(emptyData(), {
      stockDeltas: [
        { productId: "shirt", locationId: "loc-new", delta: 5 },
        { productId: "ghost", locationId: "loc-x", delta: -3 },
      ],
    });
    expect(
      next.stockLevels.find((s) => s.locationId === "loc-new")?.quantity,
    ).toBe(5);
    expect(next.stockLevels.some((s) => s.productId === "ghost")).toBe(false);
  });

  it("flips allocation status", () => {
    const base = emptyData();
    base.allocations.push({
      id: "a1",
      eventId: "e1",
      productId: "shirt",
      quantity: 1,
      status: "issued",
      createdAt: "now",
    });
    const next = applyOverlay(base, {
      setAllocationStatus: [{ allocationId: "a1", status: "returned" }],
    });
    expect(next.allocations[0]!.status).toBe("returned");
    expect(base.allocations[0]!.status).toBe("issued");
  });
});

describe("runAction offline queuing (supabase mode)", () => {
  const networkError = () => true;

  function ctx(overrides: Partial<RunActionContext> = {}): RunActionContext {
    return {
      source: "supabase",
      applyOptimistic: vi.fn(),
      refresh: vi.fn(async () => {}),
      refreshPending: vi.fn(async () => {}),
      isNetworkError: networkError,
      ...overrides,
    };
  }

  it("queues a failed floor op without committed stock or success", async () => {
    const applyOptimistic = vi.fn();
    const notifyQueuedOffline = vi.fn();
    const overlay = transferOverlay(
      {
        productId: "shirt",
        fromLocationId: "loc-wh",
        toLocationId: "loc-cebu",
        quantity: 4,
      },
      "actor@mwell",
    );
    const ok = await runAction(
      ctx({ applyOptimistic, notifyQueuedOffline }),
      "transfer",
      async () => {
        throw new Error("Failed to fetch");
      },
      overlay,
      {
        productId: "shirt",
        fromLocationId: "loc-wh",
        toLocationId: "loc-cebu",
        quantity: 4,
      },
    );
    expect(ok).toBe(false);
    expect(applyOptimistic).not.toHaveBeenCalled();
    expect(notifyQueuedOffline).toHaveBeenCalledOnce();
    expect(await pendingCount()).toBe(1);
    const pending = await allPending();
    expect(pending[0]!.method).toBe("transfer");
    expect(pending[0]!.overlay).toBe(overlay);
  });

  it("does NOT queue a non-network (business) failure — resolves false + notifies error", async () => {
    const notifyError = vi.fn();
    const ok = await runAction(
      ctx({ notifyError, isNetworkError: () => false }),
      "transfer",
      async () => {
        throw new Error("Insufficient stock in the selected source bin.");
      },
      undefined,
      { productId: "shirt", quantity: 1 },
    );
    expect(ok).toBe(false);
    expect(notifyError).toHaveBeenCalledWith(
      "Insufficient stock in the selected source bin.",
    );
    expect(await pendingCount()).toBe(0);
  });

  it("does NOT queue in memory mode even on a network error", async () => {
    const ok = await runAction(
      ctx({ source: "memory" }),
      "transfer",
      async () => {
        throw new Error("network down");
      },
      undefined,
      { productId: "shirt", quantity: 1 },
    );
    expect(ok).toBe(false);
    expect(await pendingCount()).toBe(0);
  });

  it("does NOT queue a non-queueable method", async () => {
    const ok = await runAction(
      ctx(),
      "other",
      async () => {
        throw new Error("Failed to fetch");
      },
      undefined,
      { any: "thing" },
    );
    expect(ok).toBe(false);
    expect(await pendingCount()).toBe(0);
  });

  it("always refreshes the read model + counters", async () => {
    const refresh = vi.fn(async () => {});
    const refreshPending = vi.fn(async () => {});
    await runAction(
      ctx({ refresh, refreshPending }),
      "transfer",
      async () => {},
      undefined,
      undefined,
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshPending).toHaveBeenCalledOnce();
  });

  it("retains the same queued intent across resubmit and successful replay", async () => {
    const input = { productId: "shirt", quantity: 1, actor: "operator" };
    const send = vi.fn(async () => { throw new Error("Failed to fetch"); });
    expect(await runAction(ctx(), "receiveStock", send, undefined, input)).toBe(false);
    expect(await runAction(ctx(), "receiveStock", send, undefined, { ...input })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    const entries = await allPending();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.input.idempotencyKey).toBeTruthy();
    const receiveStock = vi.fn(async () => ({}));
    await replayEntry({ repo: { receiveStock } as never, actor: "operator" }, entries[0]!);
    expect(await pendingCount()).toBe(0);
    expect(await runAction(ctx(), "receiveStock", send, undefined, { ...input })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(receiveStock.mock.calls[0]).toEqual([entries[0]!.input]);
    expect(await runAction(ctx(), "receiveStock", send, undefined, { ...input, idempotencyKey: 'new-intent-key-0001' })).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await pendingCount()).toBe(1);
  });

  it("does not turn a commit into failure when refresh or counters fail", async () => {
    const notifyError = vi.fn();
    const refreshPending = vi.fn(async () => { throw new Error("counter failure"); });
    expect(await runAction(ctx({
      notifyError, refreshPending,
      refresh: async () => { throw new Error("Failed to fetch"); },
    }), "other", async () => {})).toBe(true);
    expect(refreshPending).toHaveBeenCalledOnce();
    expect(notifyError).not.toHaveBeenCalled();
    expect(await pendingCount()).toBe(0);
  });

  it("persists the command before sending and coalesces simultaneous submits", async () => {
    let finish!: () => void;
    const send = vi.fn(async (command) => {
      expect((await allPending())[0]!.input.idempotencyKey).toBe(command!.idempotencyKey);
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const input = { actor: 'operator', quantity: 9 };
    const first = runAction(ctx(), 'transfer', send, undefined, input);
    const second = runAction(ctx(), 'transfer', send, undefined, { ...input });
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send when persistence fails, and reports failed status", async () => {
    const send = vi.fn();
    const onStatus = vi.fn();
    expect(await runAction(ctx({ onStatus, enqueue: async () => { throw new Error('Storage unavailable'); } }),
      'receiveStock', send, undefined, { quantity: 2 })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('failed');
  });

  it("reports queued status and refuses replay under a different actor", async () => {
    const onStatus = vi.fn();
    await runAction(ctx({ onStatus }), 'receiveStock', async () => { throw new Error('offline'); },
      undefined, { actor: 'first', quantity: 2 });
    expect(onStatus).toHaveBeenCalledWith('queued');
    const receiveStock = vi.fn();
    expect(await replayEntry({ repo: { receiveStock } as never, actor: 'second' }, (await allPending())[0]!)).toBe(false);
    expect(receiveStock).not.toHaveBeenCalled();
    expect(await pendingCount()).toBe(1);
  });
});

describe("replay + sync", () => {
  it.each([{}, { actor: 'current' }, { idempotencyKey: 'legacy-command-0001' }])('holds legacy unowned/unkeyed intents for reconciliation: %j', async (identity) => {
    const transfer = vi.fn();
    const payload = { productId: 'shirt', quantity: 2, fromLocationId: 'loc-wh', toLocationId: 'loc-cebu', ...identity };
    const entry = await enqueue('transfer', payload);
    expect(await replayEntry({ repo: { transfer } as never, actor: 'current' }, entry)).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
    expect(await allPending()).toHaveLength(0);
    expect(await allConflicts()).toEqual([expect.objectContaining({ id: entry.id, input: payload, error: expect.stringContaining('reconcile') })]);
  });
  it("replays a queued entry against the repo and removes it on success", async () => {
    const repo = new InMemoryRepository(emptyData());
    const entry: OutboxEntry = {
      id: "oq-1",
      method: "transfer",
      input: {
        actor: 'actor@mwell', idempotencyKey: 'replay-transfer-1',
        productId: "shirt",
        fromLocationId: "loc-wh",
        toLocationId: "loc-cebu",
        quantity: 3,
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    // Seed the memory queue via enqueue-shaped push using runAction's default outbox.
    const removeEntry = vi.fn(async () => {});
    const ok = await replayEntry(
      { repo, actor: "actor@mwell", removeEntry },
      entry,
    );
    expect(ok).toBe(true);
    expect(removeEntry).toHaveBeenCalledWith("oq-1");
    const state = await repo.getStockState();
    // 10 - 3 transferred out of loc-wh
    const wh = state.stockLevels.find((s) => s.locationId === "loc-wh")!;
    expect(wh.quantity).toBe(7);
  });

  it("marks a genuine (non-network) conflict and keeps the entry", async () => {
    const repo = new InMemoryRepository(emptyData());
    const markConflict = vi.fn(async () => {});
    const removeEntry = vi.fn(async () => {});
    const entry: OutboxEntry = {
      id: "oq-2",
      method: "transfer",
      input: {
        actor: 'actor@mwell', idempotencyKey: 'replay-transfer-2',
        productId: "shirt",
        fromLocationId: "loc-wh",
        toLocationId: "loc-cebu",
        quantity: 999,
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    const ok = await replayEntry(
      {
        repo,
        actor: "actor@mwell",
        markConflict,
        removeEntry,
        isNetworkError: () => false,
      },
      entry,
    );
    expect(ok).toBe(false);
    expect(markConflict).toHaveBeenCalledOnce();
    expect(removeEntry).not.toHaveBeenCalled();
  });

  it("leaves a transient network failure PENDING (no conflict, retries later)", async () => {
    const repo = {
      transfer: vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    } as unknown as InMemoryRepository;
    const markConflict = vi.fn(async () => {});
    const removeEntry = vi.fn(async () => {});
    const entry: OutboxEntry = {
      id: "oq-3",
      method: "transfer",
      input: { actor: 'actor@mwell', idempotencyKey: 'replay-transfer-3' },
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    const ok = await replayEntry(
      {
        repo,
        actor: "actor@mwell",
        markConflict,
        removeEntry,
        isNetworkError: () => true,
      },
      entry,
    );
    expect(ok).toBe(false);
    expect(markConflict).not.toHaveBeenCalled();
    expect(removeEntry).not.toHaveBeenCalled();
  });

  it("syncNow replays FIFO and stops on the first conflict", async () => {
    const repo = new InMemoryRepository(emptyData());
    const order: string[] = [];
    const removeEntry = vi.fn(
      async (id: string) => void order.push(`removed:${id}`),
    );
    const markConflict = vi.fn(
      async (id: string) => void order.push(`conflict:${id}`),
    );
    const pending: OutboxEntry[] = [
      {
        id: "oq-a",
        method: "transfer",
        input: {
          actor: 'actor@mwell', idempotencyKey: 'replay-transfer-a',
          productId: "shirt",
          fromLocationId: "loc-wh",
          toLocationId: "loc-cebu",
          quantity: 2,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "pending",
      },
      {
        id: "oq-b",
        method: "transfer",
        input: {
          actor: 'actor@mwell', idempotencyKey: 'replay-transfer-b',
          productId: "shirt",
          fromLocationId: "loc-wh",
          toLocationId: "loc-cebu",
          quantity: 999,
        },
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "pending",
      },
      {
        id: "oq-c",
        method: "transfer",
        input: {
          actor: 'actor@mwell', idempotencyKey: 'replay-transfer-c',
          productId: "shirt",
          fromLocationId: "loc-wh",
          toLocationId: "loc-cebu",
          quantity: 1,
        },
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "pending",
      },
    ];
    const refresh = vi.fn(async () => {});
    const refreshPending = vi.fn(async () => {});
    await syncNow({
      repo,
      actor: "actor@mwell",
      isNetworkError: () => false,
      markConflict,
      removeEntry,
      pending,
      refresh,
      refreshPending,
    });
    // oq-a committed, oq-b conflicts, oq-c never attempted.
    expect(order).toEqual(["removed:oq-a", "conflict:oq-b"]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("outbox queue lifecycle (memory fallback)", () => {
  it("receiveOverlay produces a positive stock delta + receipt row", () => {
    const overlay = receiveOverlay(
      { locationId: "loc-wh", lines: [{ productId: "shirt", quantity: 5 }] },
      "actor@mwell",
    );
    expect(overlay.stockDeltas?.[0]).toMatchObject({
      productId: "shirt",
      delta: 5,
    });
    expect(overlay.appendReceipts).toHaveLength(1);
    const applied = applyOverlay(emptyData(), overlay);
    expect(applied.stockLevels[0]!.quantity).toBe(15);
    expect(applied.receipts).toHaveLength(1);
  });

  it("does not queue the retired direct stock adjustment mutation", () => {
    expect(QUEUEABLE.has("adjustStock" as never)).toBe(false);
  });
});
