import { describe, expect, it } from "vitest";

import {
  requirementsShareCompletion,
  sharedCompletionKey,
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
  it("shares one guided simulation across role variants for the same persona", () => {
    const supervisor = scenario(
      "internal.role.warehouse.warehouse_supervisor.capability-practice.v1",
      "internal.operations_lead.guided-practice.v1",
    );
    const logistics = scenario(
      "internal.role.warehouse.logistics_supervisor.capability-practice.v1",
      "internal.operations_lead.guided-practice.v1",
    );

    expect(sharedCompletionKey(supervisor)).toBe(
      "internal:scenario:internal.operations_lead.guided-practice.v1",
    );
    expect(requirementsShareCompletion(supervisor, logistics)).toBe(true);
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
