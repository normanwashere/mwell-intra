import { describe, expect, it, vi } from "vitest";
import { requestSimulationChoiceEvaluation } from "./simulationChoiceClient";

describe("simulation choice client", () => {
  it("sends identifiers only and accepts a sanitized rejection", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: false,
          feedback: "Use the governed source record.",
          recorded: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      requestSimulationChoiceEvaluation(
        {
          assignmentRequirementId: "assignment-1",
          attemptId: "attempt-1",
          simulationId: "employee-request-handoff-v1",
          checkpointId: "draft-source-request",
          choiceId: "submit-now",
          idempotencyKey: "00000000-0000-4000-8000-000000000001",
        },
        fetcher,
      ),
    ).resolves.toEqual({
      evaluation: {
        accepted: false,
        feedback: "Use the governed source record.",
      },
      recorded: false,
    });

    const requestBody = JSON.parse(
      String((fetcher.mock.calls[0]![1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(Object.keys(requestBody).sort()).toEqual([
      "assignmentRequirementId",
      "attemptId",
      "checkpointId",
      "choiceId",
      "idempotencyKey",
      "simulationId",
    ]);
    expect(JSON.stringify(requestBody)).not.toMatch(/correct|answer.?key|feedback/i);
  });

  it("rejects authority-bearing or malformed server payloads", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accepted: true,
          recorded: true,
          correct: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      requestSimulationChoiceEvaluation(
        {
          assignmentRequirementId: "assignment-1",
          attemptId: "attempt-1",
          simulationId: "employee-request-handoff-v1",
          checkpointId: "draft-source-request",
          choiceId: "complete-request",
          idempotencyKey: "00000000-0000-4000-8000-000000000001",
        },
        fetcher,
      ),
    ).rejects.toThrow("invalid choice evaluation");
  });
});
