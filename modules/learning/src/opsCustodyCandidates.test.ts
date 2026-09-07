import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { LEARNING_CATALOG, simulationForRequirement } from "./catalog";
import { evaluateSimulationChoice, recordAuthorizedSimulationChoice } from "./simulationChoiceAuthority.server";
import { OPS_CUSTODY_CANDIDATES } from "./opsCustodyCandidates";
import { OPS_CUSTODY_CANDIDATE_RULES } from "./opsCustodyCandidateAuthority.server";

it("pins the exact approved content and feedback", () => {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  expect(OPS_CUSTODY_CANDIDATES.map(hash)).toEqual([
    "444e9c98a0f18cd5099076a5b476b1d93d5fdf23c351dfad481c7d0674a5ba76",
    "d46411fbf73f14c9ef20cc8814e5733bd5fb6cddd65fb2c53c520993a5f31470",
  ]);
  expect(hash(OPS_CUSTODY_CANDIDATE_RULES)).toBe("0353e6083a2f33d426a5078833451dfec6ec804546c022a62d70c605eda4e87f");
});

it.each(OPS_CUSTODY_CANDIDATES)("registers $id without assigning it and evaluates every decision", async (candidate) => {
  expect(candidate.audience).toBe("internal");
  expect(LEARNING_CATALOG.simulations.find((item) => item.id === candidate.id)).toEqual(candidate);
  expect(LEARNING_CATALOG.requirements.some((item) => item.simulationId === candidate.id)).toBe(false);
  expect(candidate.embeddedSteps).toHaveLength(3);
  for (const step of candidate.embeddedSteps ?? []) {
    const rule = OPS_CUSTODY_CANDIDATE_RULES[`${candidate.id}:${step.checkpointId}` as keyof typeof OPS_CUSTODY_CANDIDATE_RULES];
    expect(rule).toBeDefined();
    expect(step.choices).toHaveLength(3);
    expect(step.choices?.filter((choice) => choice.id === rule.acceptedChoiceId)).toHaveLength(1);
    expect(Object.keys(rule.rejectedFeedback).sort()).toEqual(step.choices?.filter((choice) => choice.id !== rule.acceptedChoiceId).map((choice) => choice.id).sort());
    for (const choice of step.choices ?? []) {
      const record = vi.fn().mockResolvedValue(undefined);
      const result = await recordAuthorizedSimulationChoice({ simulationId: candidate.id, checkpointId: step.checkpointId, choiceId: choice.id }, record);
      expect(result.accepted).toBe(choice.id === rule.acceptedChoiceId);
      expect(record).toHaveBeenCalledTimes(choice.id === rule.acceptedChoiceId ? 1 : 0);
      if (!result.accepted) expect(result.feedback).toBe(rule.rejectedFeedback[choice.id as keyof typeof rule.rejectedFeedback]);
    }
    expect(() => evaluateSimulationChoice({ simulationId: candidate.id, checkpointId: step.checkpointId, choiceId: "forged" })).toThrow("not part");
  }
  const requirement = { id: "controlled-ops-test", version: 1, audience: "internal" as const, kind: "scenario" as const, title: candidate.title, mandatory: true, prerequisiteIds: [], capabilityOutcomes: candidate.capabilityOutcomes, simulationId: candidate.id };
  expect(simulationForRequirement(requirement)).toEqual(candidate);
  expect(simulationForRequirement({ ...requirement, audience: "vendor" })).toBeUndefined();
  expect(simulationForRequirement({ ...requirement, kind: "attestation" })).toBeUndefined();
  expect(() => evaluateSimulationChoice({ simulationId: candidate.id, checkpointId: "forged", choiceId: "verify" })).toThrow("not published");
});
