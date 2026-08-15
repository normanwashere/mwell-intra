import { describe, expect, it } from "vitest";
import { scoreServerAssessment } from "./assessmentAuthority.server";

describe("server-authoritative assessment scoring", () => {
  it("scores submitted answer identifiers without returning the answer key", () => {
    expect(
      scoreServerAssessment({
        requirementId: "internal.warehouse.receiving-controls-assessment.v1",
        answers: [
          {
            questionId: "receiving-identifiers",
            answerId: "capture-identifiers",
          },
          {
            questionId: "receiving-exception",
            answerId: "available-stock",
          },
        ],
      }),
    ).toEqual({ score: 50 });
  });

  it("rejects incomplete, duplicate, or unpublished answer sets", () => {
    expect(() =>
      scoreServerAssessment({
        requirementId: "internal.warehouse.receiving-controls-assessment.v1",
        answers: [
          {
            questionId: "receiving-identifiers",
            answerId: "capture-identifiers",
          },
        ],
      }),
    ).toThrow("complete published question set");
    expect(() =>
      scoreServerAssessment({
        requirementId: "internal.warehouse.receiving-controls-assessment.v1",
        answers: [
          { questionId: "receiving-identifiers", answerId: "quantity-only" },
          { questionId: "receiving-identifiers", answerId: "quantity-only" },
        ],
      }),
    ).toThrow("Duplicate assessment answer");
  });
});
