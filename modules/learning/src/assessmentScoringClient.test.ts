import { describe, expect, it, vi } from "vitest";
import { requestPreviewAssessmentScore } from "./assessmentScoringClient";

describe("preview assessment scoring client", () => {
  it("sends learner answers without answer authority and accepts only a score", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ score: 50 }), { status: 200 }),
      );
    const input = {
      requirementId: "internal.warehouse.receiving-controls-assessment.v1",
      assignmentRequirementId: "assessment-1",
      attemptId: "attempt-1",
      answers: [
        { questionId: "receiving-identifiers", answerId: "quantity-only" },
        {
          questionId: "receiving-exception",
          answerId: "controlled-quality",
        },
      ],
    };

    await expect(
      requestPreviewAssessmentScore(input, fetcher),
    ).resolves.toEqual({ score: 50 });
    const body = String((fetcher.mock.calls[0]![1] as RequestInit).body);
    expect(JSON.parse(body)).toEqual(input);
    expect(body).not.toMatch(/correct|expected|answer.?key|score/i);
  });

  it("rejects authority-bearing scoring responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ score: 100, answerKey: "capture-identifiers" }),
          { status: 200 },
        ),
      );

    await expect(
      requestPreviewAssessmentScore(
        {
          requirementId: "internal.warehouse.receiving-controls-assessment.v1",
          assignmentRequirementId: "assessment-1",
          attemptId: "attempt-1",
          answers: [],
        },
        fetcher,
      ),
    ).rejects.toThrow("invalid assessment score");
  });
});
