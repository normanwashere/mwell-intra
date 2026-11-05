import { expect, type Page } from "@playwright/test";
import { scoreServerAssessment } from "../../../../modules/learning/src/assessmentAuthority.server";

// Preview scoring is deliberately unavailable on a production server. Exercise
// the browser flow with the same evaluator in the test process, not client keys.
export async function installMemoryAssessmentScoring(page: Page) {
  const scores: number[] = [];
  await page.route("**/api/learning/assessment-preview", async (route) => {
    const request = route.request();
    expect(["localhost", "127.0.0.1"]).toContain(new URL(request.url()).hostname);
    expect(request.method()).toBe("POST");
    const command = request.postDataJSON();
    expect(Object.keys(command).sort()).toEqual([
      "answers", "assignmentRequirementId", "attemptId", "idempotencyKey", "requirementId",
    ]);
    expect(command.assignmentRequirementId).toEqual(expect.any(String));
    expect(command.attemptId).toEqual(expect.any(String));
    expect(command.idempotencyKey).toEqual(expect.any(String));
    const result = scoreServerAssessment(command);
    scores.push(result.score);
    await route.fulfill({ json: result, headers: { "cache-control": "no-store" } });
  });
  return scores;
}
