import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InMemoryRepository } from "./inMemoryRepository";
import { SupabaseRepository } from "./supabase/SupabaseRepository";
import { rowToCycleCount } from "./supabase/mappers";
import { buildSeed } from "./seed";

const row = {
  id: "count-old", location_id: "loc-main", status: "approved",
  requested_by: "requester", submitted_at: "2020-01-02T00:00:00Z",
  actor: "counter", created_at: "2020-01-01T00:00:00Z",
  lines: [{ productId: "shirt-l", expected: 10, counted: 9 }],
};
function live(data: unknown, error: { message: string } | null = null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  const client = { from: vi.fn().mockReturnValue(query) };
  return { repo: new SupabaseRepository(client as unknown as SupabaseClient), client, query };
}

describe("getCycleCount", () => {
  it("reads one old source by ID with the user-bound client, without a snapshot", async () => {
    const { repo, client, query } = live(row);
    const snapshot = vi.spyOn(repo, "getData");
    expect(await repo.getCycleCount(row.id)).toEqual(rowToCycleCount(row));
    expect(client.from).toHaveBeenCalledExactlyOnceWith("cycle_counts");
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("id", row.id);
    expect(query.select).toHaveBeenCalledWith("id,location_id,bin_id,category,lines,status,requested_by,submitted_at,actor,created_at");
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it("returns null for missing or RLS-hidden records", async () => {
    expect(await live(null).repo.getCycleCount("hidden")).toBeNull();
  });
  it("does not misrepresent a read failure as a missing source", async () => {
    await expect(live(null, { message: "permission denied" }).repo.getCycleCount(row.id))
      .rejects.toThrow("cycle_counts: permission denied");
  });
  it("does not issue a broad query for an empty ID", async () => {
    const { repo, client } = live(null);
    expect(await repo.getCycleCount(" ")).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });
  it("memory returns a detached exact record and null when absent", async () => {
    const seed = buildSeed();
    seed.cycleCounts = [rowToCycleCount(row)];
    const repo = new InMemoryRepository(seed);
    const snapshot = vi.spyOn(repo, "getData");
    const found = await repo.getCycleCount(row.id);
    expect(found).toEqual(rowToCycleCount(row));
    found!.lines[0]!.counted = 100;
    expect((await repo.getCycleCount(row.id))!.lines[0]!.counted).toBe(9);
    expect(await repo.getCycleCount("missing")).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
  });
});
