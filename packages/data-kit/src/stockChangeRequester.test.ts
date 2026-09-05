import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./supabase/SupabaseRepository";
import { InMemoryRepository } from "./inMemoryRepository";
import { buildProfiles, buildSeed } from "./seed";

const request = (id: string, actor: string) => ({
  id, requested_by: actor, source_type: "cycle_count", source_id: "count-old",
  product_id: "bulk", location_id: "main", quantity_delta: -1, unit_cost: 10,
  financial_impact: 10, reason: "Variance", status: "pending_supervisor",
  requested_at: "2026-09-05T00:00:00Z", can_decide: true,
});
function fixture(rows = [request("r-1", "actor-1"), request("r-2", "actor-2"), request("r-3", "actor-1")]) {
  const query = {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [{ id: "actor-1", full_name: "  Avery Counter  " }], error: null }),
  };
  const core = { from: vi.fn().mockReturnValue(query) };
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: { rows, total: 12, next_cursor: "page-2" }, error: null }),
    schema: vi.fn().mockReturnValue(core),
  };
  return { repo: new SupabaseRepository(client as unknown as SupabaseClient), client, core, query };
}

describe("stock change requester display", () => {
  it("enriches only distinct returned-page IDs under the caller profile RLS", async () => {
    const { repo, client, core, query } = fixture();
    const page = await repo.listStockChangeRequests({ limit: 3 });
    expect(client.schema).toHaveBeenCalledExactlyOnceWith("core");
    expect(core.from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id,full_name");
    expect(query.in).toHaveBeenCalledExactlyOnceWith("id", ["actor-1", "actor-2"]);
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(2);
    expect(page.rows.map((row) => row.requestedByDisplayName)).toEqual([
      "Avery Counter", "Name unavailable (actor-2)", "Avery Counter",
    ]);
    expect(page.rows[0]).toMatchObject({ requestedBy: "actor-1", canDecide: true, sourceId: "count-old" });
    expect(page).toMatchObject({ total: 12, nextCursor: "page-2" });
  });
  it.each(["hidden", "blank", "error", "network"])("uses explicit fallback for %s names without hiding requests", async (mode) => {
    const { repo, query } = fixture([request("r-1", "actor-1")]);
    if (mode === "network") query.limit.mockRejectedValueOnce(new Error("Failed to fetch"));
    else query.limit.mockResolvedValueOnce({
      data: mode === "blank" ? [{ id: "actor-1", full_name: " " }] : [],
      error: mode === "error" ? { message: "permission denied" } : null,
    } as never);
    expect((await repo.listStockChangeRequests({})).rows[0]).toMatchObject({
      requestedBy: "actor-1", requestedByDisplayName: "Name unavailable (actor-1)", canDecide: true,
    });
  });
  it("does not query profiles for an empty or denied queue", async () => {
    const { repo, client } = fixture([]);
    expect((await repo.listStockChangeRequests({})).rows).toEqual([]);
    expect(client.schema).not.toHaveBeenCalled();
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: "Not authorized" } } as never);
    await expect(repo.listStockChangeRequests({})).rejects.toThrow("Not authorized");
    expect(client.schema).not.toHaveBeenCalled();
  });
  it("memory resolves seeded identities and labels unknown IDs without changing authority", async () => {
    const seed = buildSeed();
    const profile = buildProfiles()[0]!;
    const repo = new InMemoryRepository(seed);
    for (const [index, actor] of [profile.id, profile.email, "unknown-requester"].entries()) {
      await repo.requestStockChange({
        idempotencyKey: `requester-label-${index}`, sourceType: "adjustment",
        productId: seed.products.find((product) => !product.serialized)!.id,
        locationId: seed.locations[0]!.id, quantityDelta: 1, reason: "Count evidence",
      }, { actor, capabilities: ["manage_inventory"], approvalGroups: [] });
    }
    const page = await repo.listStockChangeRequests({});
    for (const row of page.rows) {
      expect(row.requestedByDisplayName).toBe(row.requestedBy === "unknown-requester"
        ? "Name unavailable (unknown-requester)" : profile.name);
      expect(row.canDecide).toBe(false);
    }
    expect(page.rows).toHaveLength(3);
  });
});
