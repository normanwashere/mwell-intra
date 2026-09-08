import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./SupabaseRepository";

describe("governed receipt delivery date wire contract", () => {
  it("sends actual date and reads it back independently of created_at", async () => {
    const rpc = vi.fn(async (_name: string, { payload }: { payload: Record<string, unknown> }) => ({ data: { receipt: {
      id: "receipt-1", location_id: "warehouse", actual_delivery_date: payload.actual_delivery_date,
      created_at: "2026-09-08T00:00:00Z", lines: [], actor: "receiver",
    } }, error: null }));
    const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const result = await repo.receiveProcurementPO({ mode: "legacy", idempotencyKey: "date-test", poId: "po-1", locationId: "warehouse", actualDeliveryDate: "2026-08-27", lines: [] });
    expect(rpc.mock.calls[0]![1].payload.actual_delivery_date).toBe("2026-08-27");
    expect(result.actualDeliveryDate).toBe("2026-08-27");
    expect(result.createdAt).toBe("2026-09-08T00:00:00Z");
    await expect(repo.receiveProcurementPO({ mode: "legacy", idempotencyKey: "bad-date", poId: "po-1", locationId: "warehouse", actualDeliveryDate: "2999-01-01", lines: [] })).rejects.toThrow("Actual delivery date");
    expect(rpc).toHaveBeenCalledOnce();
  });
});
