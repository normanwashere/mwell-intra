import { describe, expect, it } from "vitest";
import { LEARNING_CATALOG, roleCurriculumFor } from "./catalog";
import { assessmentQuestionsFor } from "./content";
import { requirementsShareCompletion } from "./requirementIdentity";
import { scoreServerAssessment } from "./assessmentAuthority.server";

const id = "internal.warehouse.marketing-reservation-assessment.v1";
const practiceId = "internal.role.warehouse.marketing.capability-practice.v1";

describe("Marketing reservation training", () => {
  it("requires a separately scored reservation assessment, not the old event practice", () => {
    const assessment = LEARNING_CATALOG.requirements.find((item) => item.id === id);
    const practice = LEARNING_CATALOG.requirements.find((item) => item.id === practiceId)!;
    expect(assessment).toMatchObject({
      kind: "assessment", mandatory: true, passingScore: 100, maxAttempts: 3,
      prerequisiteIds: [practiceId],
      capabilityOutcomes: [{ module: "warehouse", capability: "reserve_allocate" }],
    });
    expect(practice.capabilityOutcomes).toEqual([{ module: "warehouse", capability: "request_stock" }]);
    expect(requirementsShareCompletion(practice, assessment!)).toBe(false);
    expect(roleCurriculumFor("warehouse", "marketing")?.requirementIds).toContain(id);
    expect(roleCurriculumFor("warehouse", "warehouse_operator")?.requirementIds).not.toContain(id);
  });

  it("serves five reservation-specific questions without client-side scoring keys", () => {
    const questions = assessmentQuestionsFor(id);
    expect(questions).toHaveLength(5);
    expect(questions?.map((question) => question.id)).toEqual([
      "reservation-availability", "reservation-custody", "reservation-details",
      "reservation-authority", "reservation-uncertain-response",
    ]);
    for (const question of questions ?? []) {
      expect(question.options).toHaveLength(3);
      expect(question.prompt).toBeTruthy();
      expect(question.explanation).toBeTruthy();
    }
    expect(JSON.stringify(questions)).not.toMatch(/"(?:correct|answerKey|score)"\s*:/);
  });

  it("requires every reservation answer to be correct in the local server scorer", () => {
    const answers = [
      { questionId: "reservation-availability", answerId: "respect-availability" },
      { questionId: "reservation-custody", answerId: "hold-not-issue" },
      { questionId: "reservation-details", answerId: "event-product-purpose" },
      { questionId: "reservation-authority", answerId: "reservation-only" },
      { questionId: "reservation-uncertain-response", answerId: "reconcile-before-retry" },
    ];
    expect(scoreServerAssessment({ requirementId: id, answers })).toEqual({ score: 100 });
    expect(scoreServerAssessment({ requirementId: id, answers: [
      { questionId: "reservation-availability", answerId: "use-on-hand" }, ...answers.slice(1),
    ] })).toEqual({ score: 80 });
    expect(() => scoreServerAssessment({ requirementId: id, answers: answers.slice(1) })).toThrow("complete published question set");
  });
});
