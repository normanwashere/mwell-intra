import { describe, expect, it } from "vitest";
import { EXPERIENCE_ARTICLE_IDS, EXPERIENCE_BASELINE, validateExperienceEvent } from "./experienceEvents";
import { KNOWLEDGE_GUIDE_CONTENT } from "./guideContent";

const valid = { eventId: "11111111-1111-4111-8111-111111111111", name: "guide_opened", articleId: "feature-knowledge-library", viewport: "desktop" };
describe("minimal experience contract", () => {
  it("allows only reviewed real catalog IDs and categorical events", () => {
    for (const articleId of EXPERIENCE_ARTICLE_IDS) {
      expect(KNOWLEDGE_GUIDE_CONTENT.articles.some(article => article.id === articleId)).toBe(true);
      expect(validateExperienceEvent({ ...valid, articleId }).ok).toBe(true);
    }
    expect(validateExperienceEvent({ eventId: valid.eventId, name: "search_outcome", result: "empty", viewport: "mobile" }).ok).toBe(true);
    expect(validateExperienceEvent({ ...valid, name: "guide_feedback", result: "outdated" }).ok).toBe(true);
  });
  it("rejects text, identities, nested payloads, unsupported task/step IDs and record-like strings", () => {
    for (const field of ["actor", "actorId", "actor_ref", "audience", "received_at", "query", "password", "payload", "taskId", "stepId"])
      expect(validateExperienceEvent({ ...valid, [field]: "forged" }).ok).toBe(false);
    for (const row of [null, [], { ...valid, articleId: "serial-123" }, { ...valid, eventId: "email@example.com" },
      { ...valid, name: "task_selected" }, { ...valid, name: "step_viewed" }, { ...valid, result: "helpful" },
      { ...valid, name: "guide_feedback", result: "free text" }, { ...valid, name: "search_outcome", result: "found" }])
      expect(validateExperienceEvent(row).ok).toBe(false);
  });
  it("does not claim collection, business success or live evidence publication", () => {
    expect(EXPERIENCE_BASELINE.collection).toBe("disabled_pending_approval");
    expect(EXPERIENCE_BASELINE.retentionDays).toBe(90);
    expect(EXPERIENCE_BASELINE.vendorEvidencePublication).toMatch(/^blocked_/);
    expect(EXPERIENCE_BASELINE.businessCompletion).toMatch(/^unavailable_/);
  });
});
