import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { LEARNING_CATALOG } from "./catalog";
import { evaluateSimulationChoice, recordAuthorizedSimulationChoice } from "./simulationChoiceAuthority.server";
import { SCOPED_READINESS_DRAFTS, SCOPED_READINESS_DRAFT_KEYS } from "./scopedReadinessDrafts.server";

it("pins the exact pending-review content and proposed answer keys", () => {
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  expect(SCOPED_READINESS_DRAFTS.map(hash)).toEqual([
    "0bfe99fbc8c3f3294783def56af07f52d7231bc50eb3e0cad3d1d9986a00e612",
    "05cd99bcea0e44b4b76c7d4ffe9a8db2e08f29cce5fc755176362e446ad3773a",
  ]);
  expect(hash(SCOPED_READINESS_DRAFT_KEYS)).toBe("0caac9b8e28f7253613dbab5ae1892c5781a8de3dac76fd142bbb0bb06be5966");
});

it.each(SCOPED_READINESS_DRAFTS)("keeps $id unregistered and requires review before any completion", async (draft) => {
  expect(LEARNING_CATALOG.simulations.some((item) => item.id === draft.id)).toBe(false);
  expect(LEARNING_CATALOG.requirements.some((item) => item.simulationId === draft.id)).toBe(false);
  expect(draft.embeddedSteps?.map((step) => step.checkpointId)).toEqual(draft.checkpointIds);
  let recorded = false;
  for (const step of draft.embeddedSteps ?? []) {
    const key = SCOPED_READINESS_DRAFT_KEYS[step.checkpointId];
    expect(step.choices?.filter((choice) => choice.id === key)).toHaveLength(1);
    expect(step.choices?.filter((choice) => choice.id !== key)).toHaveLength(2);
    for (const choice of step.choices ?? []) {
      await expect(recordAuthorizedSimulationChoice({ simulationId: draft.id, checkpointId: step.checkpointId, choiceId: choice.id }, async () => { recorded = true; })).rejects.toThrow("not published");
    }
  }
  expect(recorded).toBe(false);
});

it("proves the existing Finance scenario covers mismatch and corrected review, not separate release authority", () => {
  expect(evaluateSimulationChoice({ simulationId: "finance-independent-review-v1", checkpointId: "reconcile-source-evidence", choiceId: "hold-mismatch" }).accepted).toBe(true);
  expect(evaluateSimulationChoice({ simulationId: "finance-independent-review-v1", checkpointId: "reconcile-source-evidence", choiceId: "edit-receipt" }).accepted).toBe(false);
  expect(evaluateSimulationChoice({ simulationId: "finance-independent-review-v1", checkpointId: "record-finance-decision", choiceId: "approve-nine" }).accepted).toBe(true);
  expect(evaluateSimulationChoice({ simulationId: "finance-independent-review-v1", checkpointId: "record-finance-decision", choiceId: "delete-hold" }).accepted).toBe(false);
});
