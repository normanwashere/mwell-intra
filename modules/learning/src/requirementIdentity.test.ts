import { describe, expect, it } from "vitest";

import {
  requirementsShareCompletion,
  sharedCompletionKey,
  requirementProgress,
} from "./requirementIdentity";
import type { RequirementDefinition } from "./types";

const scenario = (id: string, simulationId: string): RequirementDefinition => ({
  id,
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: id,
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [],
  simulationId,
});

describe("shared completion identity", () => {
  it("does not transfer credit across role variants sharing a simulation", () => {
    const supervisor = scenario(
      "internal.role.warehouse.warehouse_supervisor.capability-practice.v1",
      "internal.operations_lead.guided-practice.v1",
    );
    const logistics = scenario(
      "internal.role.warehouse.logistics_supervisor.capability-practice.v1",
      "internal.operations_lead.guided-practice.v1",
    );

    expect(sharedCompletionKey(supervisor)).not.toBe(
      sharedCompletionKey(logistics),
    );
    expect(requirementsShareCompletion(supervisor, logistics)).toBe(false);
  });

  it("retains version, audience and capability authority boundaries", () => {
    const base = scenario("shared", "simulation");
    expect(requirementsShareCompletion(base, { ...base })).toBe(true);
    for (const other of [
      { ...base, version: 2 },
      { ...base, audience: "vendor" as const },
      {
        ...base,
        capabilityOutcomes: [
          { module: "warehouse" as const, capability: "receive_stock" },
        ],
      },
      { ...base, id: "other", title: base.title, kind: "orientation" as const },
    ]) {
      expect(requirementsShareCompletion(base, other)).toBe(false);
    }
  });

  it("ignores old-version credit and does not hide pending assignments", () => {
    const base = scenario("shared", "simulation");
    const completed = {
      assignmentRequirementId: "a",
      requirementId: base.id,
      requirementVersion: 1,
      state: "passed" as const,
      attemptCount: 1,
      allowsSharedCompletion: false,
      updatedAt: "2026-09-06",
    };
    expect(
      requirementProgress({ ...base, version: 2 }, [completed]),
    ).toBeUndefined();
    expect(
      requirementProgress(base, [
        completed,
        { ...completed, assignmentRequirementId: "b", state: "not_started" },
      ])?.state,
    ).toBe("not_started");
  });

  it("keeps different simulations independent", () => {
    expect(
      requirementsShareCompletion(
        scenario("operations", "operations-practice"),
        scenario("procurement", "procurement-practice"),
      ),
    ).toBe(false);
  });
});
