import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./SupabaseRepository";

describe("request-scoped actor names", () => {
  it("loads names only for returned request IDs and never queries profiles", async () => {
    const from = vi.fn((table: string) => {
      const result = { data: table === "department_stock_requests" ? [{ id: "request-1", requested_by: "actor-1" }] : [], error: null };
      const query = { ...result, order: () => query, limit: () => query };
      return { select: () => query };
    });
    const rpc = vi.fn().mockResolvedValue({ data: [{ request_id: "request-1", requested_by_name: " Marketing Lead ", approved_by_name: null }, { request_id: "unrelated", requested_by_name: "Other" }], error: null });
    const repo = new SupabaseRepository({ from, rpc } as unknown as SupabaseClient);
    const data = await repo.getData();
    expect(rpc).toHaveBeenCalledWith("department_request_actor_names", { p_request_ids: ["request-1"] });
    expect(data.departmentStockRequests).toHaveLength(1);
    expect(data.departmentStockRequests[0]).toMatchObject({ requestedBy: "actor-1", requestedByName: "Marketing Lead" });
    expect(data.departmentStockRequests[0]?.approvedByName).toBeUndefined();
    expect(from).not.toHaveBeenCalledWith("profiles");
  });

  it("does not request a directory for an empty request result", async () => {
    const query = { data: [], error: null, order: () => query, limit: () => query };
    const rpc = vi.fn();
    const repo = new SupabaseRepository({ from: () => ({ select: () => query }), rpc } as unknown as SupabaseClient);
    await repo.getData();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bounds name lookups to 200 IDs and does not silently accept lookup failure", async () => {
    const from = (table: string) => {
      const query = { data: table === "department_stock_requests" ? Array.from({ length: 201 }, (_, i) => ({ id: `request-${i}`, requested_by: "actor" })) : [], error: null, order: () => query, limit: () => query };
      return { select: () => query };
    };
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repo = new SupabaseRepository({ from, rpc } as unknown as SupabaseClient);
    const data = await repo.getData();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]![1].p_request_ids).toHaveLength(200);
    expect(rpc.mock.calls[1]![1].p_request_ids).toEqual(["request-200"]);
    expect(data.departmentStockRequests[0]?.requestedByName).toBeUndefined();
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(repo.getData()).rejects.toThrow("department_request_actor_names: denied");
  });
});
