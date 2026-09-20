import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { LEARNING_CATALOG, simulationForRequirement } from "./catalog";
import { evaluateSimulationChoice, recordAuthorizedSimulationChoice } from "./simulationChoiceAuthority.server";
import { SCOPED_READINESS_CANDIDATES } from "./scopedReadinessCandidates";
import { SCOPED_READINESS_CANDIDATE_RULES } from "./scopedReadinessCandidateAuthority.server";
import { OPS_CUSTODY_CANDIDATES } from "./opsCustodyCandidates";

it("pins stable-ID content and complete server feedback for independent review", () => {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  expect(SCOPED_READINESS_CANDIDATES.map(hash)).toEqual([
    "03ac69bd9e0ecf09898af99ac706085ea17f1860b222c1b3fa36f98efed062c8",
    "901e4ee97aec872dd7efd4cc2d7975c59f15dfdedd8a29f986201d3072c6ac2b",
  ]);
  expect(hash(SCOPED_READINESS_CANDIDATE_RULES)).toBe("deeb1dff8e5fa2998e59655bb66511a78a20becb5e01f8fafaaa8fd631f65a98");
});

it("preserves every existing simulation and all default requirements and curricula", () => {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  // The separately tested seller addition must not rewrite the pinned catalog.
  expect(hash(LEARNING_CATALOG.simulations.filter(item => item.id !== "event-seller-custody-v1" && ![...SCOPED_READINESS_CANDIDATES, ...OPS_CUSTODY_CANDIDATES].some(candidate => candidate.id === item.id)))).toBe("c36ea6b318331e30c3ce63fdd0a0e7e5d452dfb2778f52742521b7449927892b");
  expect(hash({ requirements: LEARNING_CATALOG.requirements.filter(item => item.id !== "internal.role.events.seller.custody-practice.v1"), curricula: LEARNING_CATALOG.curricula, roleCurricula: LEARNING_CATALOG.roleCurricula.filter(item => item.id !== "internal.role.events.seller.v1"), capabilityCoverageCurricula: LEARNING_CATALOG.capabilityCoverageCurricula })).toBe("c8b459261b7c5017fd8c304042007e6fd3c27286b0b69e5bfd41da2f1e20cc21");
});

it.each(SCOPED_READINESS_CANDIDATES)("registers reviewed runtime content without assigning $id", async (simulation) => {
  expect(LEARNING_CATALOG.simulations.find((item) => item.id === simulation.id)).toEqual(simulation);
  expect(LEARNING_CATALOG.requirements.some((item) => item.simulationId === simulation.id)).toBe(false);
  for (const step of simulation.embeddedSteps ?? []) {
    const key = `${simulation.id}:${step.checkpointId}` as keyof typeof SCOPED_READINESS_CANDIDATE_RULES;
    const rule = SCOPED_READINESS_CANDIDATE_RULES[key];
    expect(rule).toBeDefined();
    expect(step.choices?.map((choice) => choice.id).sort()).toEqual([rule.acceptedChoiceId, ...Object.keys(rule.rejectedFeedback)].sort());
    expect(Object.values(rule.rejectedFeedback).every((feedback) => feedback.length > 0)).toBe(true);
    for (const choice of step.choices ?? []) {
      const record = vi.fn().mockResolvedValue(undefined);
      const result = await recordAuthorizedSimulationChoice({ simulationId: simulation.id, checkpointId: step.checkpointId, choiceId: choice.id }, record);
      expect(result.accepted).toBe(choice.id === rule.acceptedChoiceId);
      expect(record).toHaveBeenCalledTimes(choice.id === rule.acceptedChoiceId ? 1 : 0);
      if (!result.accepted) expect(result.feedback).toBe(rule.rejectedFeedback[choice.id as keyof typeof rule.rejectedFeedback]);
    }
    expect(() => evaluateSimulationChoice({ simulationId: simulation.id, checkpointId: step.checkpointId, choiceId: "forged" })).toThrow("not part");
  }
  expect(simulation.audience).toBe("internal");
  const requirement = { id: "controlled-test-assignment", version: 1, audience: "internal" as const, kind: "scenario" as const, title: simulation.title, mandatory: true, prerequisiteIds: [], capabilityOutcomes: simulation.capabilityOutcomes, simulationId: simulation.id };
  expect(simulationForRequirement(requirement)).toEqual(simulation);
  expect(simulationForRequirement({ ...requirement, audience: "vendor" })).toBeUndefined();
  expect(simulationForRequirement({ ...requirement, kind: "attestation" })).toBeUndefined();
  expect(() => evaluateSimulationChoice({ simulationId: simulation.id, checkpointId: "forged", choiceId: "forged" })).toThrow("not published");
});
