import { describe, expect, it } from "vitest";
import { canEnterCapabilityTraining } from "./authorization";

describe("canEnterCapabilityTraining", () => {
  const roleCapabilities = { warehouse: ["receive_stock"] } as const;

  it("opens only the exact simulation for a role-authorized user", () => {
    expect(
      canEnterCapabilityTraining({
        capability: "receive_stock",
        requiredSimulationId: "warehouse-receiving-v1",
        roleCapabilities,
        trainingId: "warehouse-receiving-v1",
      }),
    ).toBe(true);
  });

  it("does not turn a different or missing simulation into route authority", () => {
    for (const trainingId of [
      null,
      "warehouse-receiving-v2",
      "receive_stock",
    ]) {
      expect(
        canEnterCapabilityTraining({
          capability: "receive_stock",
          requiredSimulationId: "warehouse-receiving-v1",
          roleCapabilities,
          trainingId,
        }),
      ).toBe(false);
    }
  });

  it("does not admit a user whose role lacks the governed capability", () => {
    expect(
      canEnterCapabilityTraining({
        capability: "receive_stock",
        requiredSimulationId: "warehouse-receiving-v1",
        roleCapabilities: { warehouse: ["view_inventory"] },
        trainingId: "warehouse-receiving-v1",
      }),
    ).toBe(false);
  });
});
