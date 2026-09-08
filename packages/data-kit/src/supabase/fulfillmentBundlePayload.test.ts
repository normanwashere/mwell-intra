import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./SupabaseRepository";

type WirePayload = { source: string; event_id: string; lines: Array<{ productId: string; quantity: number; bundleSetCodes?: string[] }> };

describe("fulfillment bundle wire payload", () => {
  it.each([undefined, []])("omits optional bundle metadata for ordinary event demand (%j)", async (bundleSetCodes) => {
    const rpc = vi.fn(async (_name: string, { payload }: { payload: WirePayload }) => ({
      data: { id: "event-order", source: "event", external_reference: "EVENT-ORDINARY", lines: payload.lines, status: "received" }, error: null,
    }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    await repo.createFulfillmentOrder({ source: "event", externalReference: "EVENT-ORDINARY", eventId: "event-1", sourceLocationId: "warehouse-1", lines: [{ productId: "otg-bag-large", quantity: 10, bundleSetCodes }], actor: "operator" });
    const payload = rpc.mock.calls[0]![1].payload;
    expect(payload.source).toBe("event");
    expect(payload.event_id).toBe("event-1");
    expect(payload.lines[0]).toMatchObject({ productId: "otg-bag-large", quantity: 10 });
    expect(payload.lines[0]).not.toHaveProperty("bundleSetCodes");
  });

  it("preserves explicit bundle codes so server count validation is not bypassed", async () => {
    const rpc = vi.fn(async (_name: string, { payload }: { payload: WirePayload }) => ({
      data: { id: "bundle-order", source: "event", external_reference: "EVENT-BUNDLE", lines: payload.lines, status: "received" }, error: null,
    }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    await repo.createFulfillmentOrder({ source: "event", externalReference: "EVENT-BUNDLE", eventId: "event-1", lines: [{ productId: "ring", quantity: 2, bundleSetCodes: ["SET-1"] }], actor: "operator" });
    expect(rpc.mock.calls[0]![1].payload.lines[0]!.bundleSetCodes).toEqual(["SET-1"]);
  });
});
