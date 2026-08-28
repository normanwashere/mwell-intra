import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryRepository } from "./inMemoryRepository";
import { SupabaseRepository } from "./supabase/SupabaseRepository";
import { buildSeed } from "./seed";
import type { ReturnInput } from "./repository";

const input: ReturnInput = {
  idempotencyKey: "return-safety-0001",
  source: "event",
  eventId: "evt-makati",
  actor: "receiver",
  lines: [
    {
      productId: "shirt-l",
      quantity: 2,
      reason: "unused",
      locationId: "loc-wh",
      binId: "bin-pasig-a1",
    },
    {
      productId: "ecg-ring-10",
      quantity: 1,
      serialNumber: "ECG-RING-10-SN0001",
      reason: "defective",
      locationId: "loc-wh",
      binId: "bin-pasig-a1",
    },
  ],
};

describe("return intake safety", () => {
  it.each(["P0001", "23514", "42501"])("preserves confirmed return transaction rejection %s at the RPC boundary", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: "Quarantine bin is inactive" } });
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.recordReturn(input)).rejects.toMatchObject({
      name: "ReturnRejectedError", outcome: "rejected", code, message: "Quarantine bin is inactive",
    });
  });

  it.each(["", "08006", "40003", "PGRST000"])("does not mark ambiguous return failure %s as a safe rejection", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: "Quarantine bin is inactive" } });
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const error = await repo.recordReturn(input).catch((failure) => failure);
    expect(error).not.toHaveProperty("outcome", "rejected");
  });

  it("does not classify a thrown transport failure by message or code", async () => {
    const rpc = vi.fn().mockRejectedValue(Object.assign(new Error("Quarantine bin is inactive"), { code: "P0001" }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const error = await repo.recordReturn(input).catch((failure) => failure);
    expect(error).not.toHaveProperty("outcome", "rejected");
  });

  it("sends the same command on retry without reading mutable inventory or building client rows", async () => {
    const rpc = vi.fn(async (_name, args) => ({
      data: { id: "server-return", ...args.payload.return },
      error: null,
    }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const read = vi.spyOn(repo, "getData").mockResolvedValue(buildSeed());
    await repo.recordReturn(input);
    await repo.recordReturn(input);
    expect(read).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0]![0]).toBe("record_return_v2");
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(rpc.mock.calls[0]![1].payload).toEqual({
      idempotency_key: input.idempotencyKey,
      allocation_id: null,
      return: {
        source: "event",
        event_id: "evt-makati",
        evidence_urls: [],
        lines: input.lines.map((line) => ({
          ...line,
          disposition: "quarantine",
        })),
      },
    });
  });

  it("replays the complete in-memory batch before checking changed serial state", async () => {
    const repo = new InMemoryRepository(buildSeed());
    const first = await repo.recordReturn(input);
    const after = await repo.getData();
    expect(await repo.recordReturn(input)).toEqual(first);
    expect(await repo.getData()).toEqual(after);
    await expect(
      repo.recordReturn({ ...input, lines: [input.lines[0]!] }),
    ).rejects.toThrow(/different payload/);
    expect(await repo.getData()).toEqual(after);
  });

  it.each([false, true])("replays returns across repository reloads (serialized=%s)", async (serialized) => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    };
    const command = { ...input, lines: serialized ? input.lines : [input.lines[0]!] };
    const repo = new InMemoryRepository(buildSeed(), { storage });
    const first = await repo.recordReturn(command);
    const after = await repo.getData();
    const reloaded = new InMemoryRepository(undefined, { storage });
    expect(await reloaded.recordReturn(command)).toEqual(first);
    expect(await reloaded.getData()).toEqual(after);
  });

  it("scopes return replay to its actor", async () => {
    const repo = new InMemoryRepository(buildSeed());
    const command = { ...input, lines: [input.lines[0]!] };
    const first = await repo.recordReturn(command);
    const second = await repo.recordReturn({ ...command, actor: "another-receiver" });
    expect(second.id).not.toBe(first.id);
    expect(second.actor).toBe("another-receiver");
  });

  it("keeps storage failure unknown and retries persistence without repeating a return", async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
    };
    storage.setItem.mockImplementationOnce(() => { throw new Error("Storage full"); });
    const repo = new InMemoryRepository(buildSeed(), { storage });
    await expect(repo.recordReturn(input)).rejects.toThrow("Storage full");
    const after = await repo.getData();
    const result = await repo.recordReturn(input);
    expect(await repo.getData()).toEqual(after);
    expect(await new InMemoryRepository(undefined, { storage }).recordReturn(input)).toEqual(result);
  });

  it.each([
    { productId: "missing" },
    { quantity: 0 },
    { quantity: 1.5 },
    { quantity: 2 },
    { serialNumber: "missing" },
    { serialNumber: undefined },
    { locationId: "missing" },
    { binId: "missing" },
    { disposition: "restock" },
  ])(
    "rolls back the whole batch for an invalid later line: %j",
    async (patch) => {
      const repo = new InMemoryRepository(buildSeed());
      const before = await repo.getData();
      await expect(
        repo.recordReturn({
          ...input,
          lines: [
            input.lines[0]!,
            { ...input.lines[1]!, ...patch } as ReturnInput["lines"][number],
          ],
        }),
      ).rejects.toMatchObject({ name: "ReturnRejectedError", outcome: "rejected", code: "RETURN_INPUT_INVALID" });
      expect(await repo.getData()).toEqual(before);
      await expect(repo.recordReturn(input)).resolves.toBeDefined();
    },
  );

  it("rejects duplicate normalized serials and inactive destinations", async () => {
    const seed = buildSeed();
    const repo = new InMemoryRepository(seed);
    await expect(
      repo.recordReturn({
        ...input,
        lines: [
          input.lines[1]!,
          { ...input.lines[1]!, serialNumber: "ecg-ring-10-sn0001" },
        ],
      }),
    ).rejects.toThrow(/already|duplicate/i);
    seed.locations.find((row) => row.id === "loc-wh")!.active = false;
    await expect(
      new InMemoryRepository(seed).recordReturn(input),
    ).rejects.toThrow(/active/i);
    seed.locations.find((row) => row.id === "loc-wh")!.active = true;
    seed.storageAreas.find((row) => row.id === "bin-pasig-a1")!.active = false;
    await expect(
      new InMemoryRepository(seed).recordReturn(input),
    ).rejects.toThrow(/active/i);
  });
});
