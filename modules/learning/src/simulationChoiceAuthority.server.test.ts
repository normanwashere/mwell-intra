import { describe, expect, it, vi } from "vitest";
import {
  evaluateSimulationChoice,
  recordAuthorizedSimulationChoice,
} from "./simulationChoiceAuthority.server";
import { LEARNING_CATALOG } from "./catalog";

describe("server-authoritative simulation choices", () => {
  it("rejects an unsafe choice with feedback and accepts only the governed choice", () => {
    expect(
      evaluateSimulationChoice({
        simulationId: "employee-request-handoff-v1",
        checkpointId: "draft-source-request",
        choiceId: "submit-now",
      }),
    ).toEqual({
      accepted: false,
      feedback:
        "Chat is not the authoritative request record and leaves the handoff incomplete.",
    });

    expect(
      evaluateSimulationChoice({
        simulationId: "employee-request-handoff-v1",
        checkpointId: "draft-source-request",
        choiceId: "complete-request",
      }),
    ).toEqual({ accepted: true });
  });

  it("does not accept unpublished simulation, checkpoint, or choice identifiers", () => {
    expect(() =>
      evaluateSimulationChoice({
        simulationId: "employee-request-handoff-v1",
        checkpointId: "draft-source-request",
        choiceId: "forged-choice",
      }),
    ).toThrow("Choice is not part of the published simulation checkpoint.");
  });

  it("never records progress for a rejected choice", async () => {
    const recordCheckpoint = vi.fn().mockResolvedValue(undefined);

    await expect(
      recordAuthorizedSimulationChoice(
        {
          simulationId: "employee-request-handoff-v1",
          checkpointId: "draft-source-request",
          choiceId: "submit-now",
        },
        recordCheckpoint,
      ),
    ).resolves.toMatchObject({ accepted: false });
    expect(recordCheckpoint).not.toHaveBeenCalled();

    await expect(
      recordAuthorizedSimulationChoice(
        {
          simulationId: "employee-request-handoff-v1",
          checkpointId: "draft-source-request",
          choiceId: "complete-request",
        },
        recordCheckpoint,
      ),
    ).resolves.toEqual({ accepted: true });
    expect(recordCheckpoint).toHaveBeenCalledOnce();
  });

  it("covers every published guided choice with exactly one accepted option", () => {
    for (const practice of LEARNING_CATALOG.rolePractices) {
      for (const step of practice.simulation.embeddedSteps ?? []) {
        const results = (step.choices ?? []).map((choice) =>
          evaluateSimulationChoice({
            simulationId: practice.simulation.id,
            checkpointId: step.checkpointId,
            choiceId: choice.id,
          }),
        );
        expect(
          results.filter((result) => result.accepted),
          `${practice.personaId}:${step.checkpointId}`,
        ).toHaveLength(1);
      }
    }
  });
});
