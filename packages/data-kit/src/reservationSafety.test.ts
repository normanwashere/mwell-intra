import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryRepository } from "./inMemoryRepository";
import { SupabaseRepository } from "./supabase/SupabaseRepository";
import { buildSeed } from "./seed";
import type { ReserveBatchInput } from "./repository";

const input: ReserveBatchInput = {
  idempotencyKey: "reservation-batch-0001",
  actor: "operator",
  eventId: "evt-makati",
  lines: [
    { productId: "shirt-l", quantity: 2, promotional: false },
    { productId: "doctor-token", quantity: 3, promotional: true },
  ],
};

describe("atomic reservation safety", () => {
  it("replays one complete batch and rejects changed payloads", async () => {
    const repo = new InMemoryRepository(buildSeed());
    const before = await repo.getData();
    const first = await repo.reserveBatch(input);
    expect(first.status).toBe("committed");
    expect((await repo.getData()).allocations).toHaveLength(
      before.allocations.length + 2,
    );
    expect(await repo.reserveBatch(input)).toEqual(first);
    await expect(
      repo.reserveBatch({ ...input, lines: [input.lines[0]!] }),
    ).rejects.toThrow(/different payload/i);
    expect((await repo.getData()).allocations).toHaveLength(
      before.allocations.length + 2,
    );
  });

  it.each([
    { quantity: 1000000 },
    { quantity: 0 },
    { quantity: 1.5 },
    { productId: "missing" },
  ])(
    "rejects an invalid later line with no partial allocations: %j",
    async (patch) => {
      const repo = new InMemoryRepository(buildSeed());
      const before = await repo.getData();
      const result = await repo.reserveBatch({
        ...input,
        lines: [input.lines[0]!, { ...input.lines[1]!, ...patch }],
      });
      expect(result.status).toBe("rejected");
      expect(await repo.getData()).toEqual(before);
    },
  );

  it("aggregates duplicate product lines and serializes competing intents", async () => {
    const seed = buildSeed();
    seed.allocations = [];
    seed.stockLevels = [
      { productId: "shirt-l", locationId: "loc-wh", quantity: 3 },
    ];
    const repo = new InMemoryRepository(seed);
    expect(
      (
        await repo.reserveBatch({
          ...input,
          lines: [input.lines[0]!, { ...input.lines[0]!, promotional: true }],
        })
      ).status,
    ).toBe("rejected");
    const results = await Promise.all(
      ["competing-batch-001", "competing-batch-002"].map((idempotencyKey) =>
        repo.reserveBatch({
          ...input,
          idempotencyKey,
          lines: [input.lines[0]!],
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      "committed",
      "rejected",
    ]);
  });

  it("sends stable server commands without mutable inventory prechecks", async () => {
    const rpc = vi.fn(async () => ({
      data: { status: "committed", allocations: input.lines.map((line, index) => ({
        id: `allocation-${index}`, event_id: input.eventId, product_id: line.productId,
        quantity: line.quantity, promotional: line.promotional, status: "reserved",
      })) },
      error: null,
    }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const read = vi.spyOn(repo, "getData");
    await repo.reserveBatch(input);
    await repo.reserveBatch(input);
    expect(read).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("reserve_batch", {
      payload: {
        idempotency_key: input.idempotencyKey,
        event_id: input.eventId,
        lines: input.lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
          promotional: line.promotional,
        })),
      },
    });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });

  it.each([[], [null], [{ id: "partial-result" }]].map((allocations) => [allocations]))("does not confirm an incomplete reservation response: %j", async (allocations) => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "committed", allocations }, error: null });
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.reserveBatch(input)).rejects.toThrow(/response unavailable/i);
  });

  it("rejects invalid promotional values without partially reserving", async () => {
    const repo = new InMemoryRepository(buildSeed());
    const before = await repo.getData();
    expect((await repo.reserveBatch({ ...input, lines: [input.lines[0]!, {
      ...input.lines[1]!, promotional: "true" as unknown as boolean,
    }] })).status).toBe("rejected");
    expect(await repo.getData()).toEqual(before);
  });

  it("replays across repository reloads with actor isolation", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    };
    const repo = new InMemoryRepository(buildSeed(), { storage });
    const first = await repo.reserveBatch(input);
    const after = await repo.getData();
    const reloaded = new InMemoryRepository(undefined, { storage });
    expect(await reloaded.reserveBatch(input)).toEqual(first);
    expect(await reloaded.getData()).toEqual(after);
    expect(
      await reloaded.reserveBatch({ ...input, actor: "another-operator" }),
    ).not.toEqual(first);
  });

  it("does not confirm reservation success until inventory and replay are durable", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    };
    storage.setItem.mockImplementationOnce(() => { throw new Error("Storage full"); });
    const repo = new InMemoryRepository(buildSeed(), { storage });
    await expect(repo.reserveBatch(input)).rejects.toThrow("Storage full");
    const after = await repo.getData();
    const result = await repo.reserveBatch(input);
    expect(await repo.getData()).toEqual(after);
    expect(await new InMemoryRepository(undefined, { storage }).reserveBatch(input)).toEqual(result);
  });
});
