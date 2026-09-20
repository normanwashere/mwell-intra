import { describe, expect, it, vi } from "vitest";
import {
  LEARNING_CATALOG,
  roleCurriculumFor,
  simulationForRequirement,
} from "./catalog";
import { resolveEffectiveCurriculum } from "./resolver";
import {
  evaluateSimulationChoice,
  recordAuthorizedSimulationChoice,
} from "./simulationChoiceAuthority.server";

const requirementId = "internal.role.events.seller.custody-practice.v1";
describe("event seller learning", () => {
  it("assigns a dedicated mandatory challenge without certifying or widening the seller role", () => {
    const curriculum = roleCurriculumFor("events", "seller");
    expect(curriculum).toBeDefined();
    expect(curriculum?.requirementIds).toEqual([
      "internal.general_employee.orientation.v1",
      requirementId,
    ]);
    const result = resolveEffectiveCurriculum({
      requirements: LEARNING_CATALOG.requirements,
      roleCurricula: [
        {
          sourceRoleAssignmentId: "named-seller-role",
          departmentId: "event-ops",
          curriculum: curriculum!,
        },
      ],
      departmentAssignments: [],
      userAssignments: [],
      activeCertifications: [],
    });
    expect(result.capabilities).toEqual([
      {
        sourceRoleAssignmentId: "named-seller-role",
        departmentId: "event-ops",
        module: "events",
        role: "seller",
        capability: { module: "events", capability: "record_event_outcome" },
        state: "locked",
        requirementIds: [requirementId],
      },
    ]);
    const requirement = result.requirements.find(
      (item) => item.id === requirementId,
    )!;
    expect(requirement.mandatory).toBe(true);
    expect(requirement.maxAttempts).toBe(3);
    expect(simulationForRequirement(requirement)?.checkpointIds).toEqual([
      "verify-assignment",
      "verify-custody",
      "record-outcome",
      "retry-intent",
      "reverse-correction",
      "handoff-finance",
    ]);
  });
  it.each([
    ["verify-assignment", "confirm-own-event", "share-account"],
    ["verify-custody", "select-eligible", "use-returned"],
    ["record-outcome", "record-actual", "rename-sale"],
    ["retry-intent", "readback-retry", "new-reference"],
    ["reverse-correction", "reverse-own", "overwrite-entry"],
    ["handoff-finance", "reconcile-handoff", "close-anyway"],
  ])(
    "requires a supported explicit decision for %s",
    (checkpointId, accepted, rejected) => {
      expect(
        evaluateSimulationChoice({
          simulationId: "event-seller-custody-v1",
          checkpointId,
          choiceId: accepted,
        }),
      ).toEqual({ accepted: true });
      expect(
        evaluateSimulationChoice({
          simulationId: "event-seller-custody-v1",
          checkpointId,
          choiceId: rejected,
        }).accepted,
      ).toBe(false);
      expect(() =>
        evaluateSimulationChoice({
          simulationId: "event-seller-custody-v1",
          checkpointId,
          choiceId: "",
        }),
      ).toThrow("Choice is not part");
    },
  );
  it("does not record evidence for a rejected or missing decision", async () => {
    const record = vi.fn();
    const input = {
      simulationId: "event-seller-custody-v1",
      checkpointId: "verify-assignment",
      choiceId: "share-account",
    };
    await expect(
      recordAuthorizedSimulationChoice(input, record),
    ).resolves.toMatchObject({ accepted: false });
    await expect(
      recordAuthorizedSimulationChoice({ ...input, choiceId: "" }, record),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
    await recordAuthorizedSimulationChoice(
      { ...input, choiceId: "confirm-own-event" },
      record,
    );
    expect(record).toHaveBeenCalledTimes(1);
  });
  it("does not reuse the challenge for another requirement, version, audience, or capability", () => {
    const requirement = LEARNING_CATALOG.requirements.find(
      (item) => item.id === requirementId,
    )!;
    expect(requirement).toBeDefined();
    for (const changes of [
      { id: "other" },
      { version: 2 },
      { audience: "vendor" as const },
      { kind: "attestation" as const },
      {
        capabilityOutcomes: [
          { module: "events" as const, capability: "manage_events" },
        ],
      },
    ]) {
      expect(
        simulationForRequirement({ ...requirement, ...changes }),
      ).toBeUndefined();
    }
  });
  it("does not attach seller credit to buyer, inspector, or event-manager curricula", () => {
    for (const curriculum of LEARNING_CATALOG.roleCurricula.filter(
      (item) => !(item.module === "events" && item.role === "seller"),
    )) {
      expect(curriculum.requirementIds).not.toContain(requirementId);
    }
  });
});
