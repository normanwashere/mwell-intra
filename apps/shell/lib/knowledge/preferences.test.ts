// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  knowledgePreferenceKey,
  readKnowledgePreferences,
  updateKnowledgePreferences,
} from "./preferences";

describe("knowledge preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps saved items and the ten most recent unique guides", () => {
    const userId = "employee-1";
    updateKnowledgePreferences(userId, (current) => ({
      ...current,
      savedIds: ["flow:receive-to-issue"],
      recent: Array.from({ length: 12 }, (_, index) => ({
        id: `article:${index}`,
        title: `Guide ${index}`,
        href: `/knowledge?article=${index}`,
        context: "Procedure",
        viewedAt: `2026-08-${String(index + 1).padStart(2, "0")}`,
      })),
    }));

    const stored = readKnowledgePreferences(userId);
    expect(stored.savedIds).toEqual(["flow:receive-to-issue"]);
    expect(stored.recent).toHaveLength(10);
    expect(window.localStorage.getItem(knowledgePreferenceKey(userId))).toBeTruthy();
  });

  it("recovers safely from invalid browser storage", () => {
    window.localStorage.setItem(knowledgePreferenceKey("employee-2"), "broken");
    expect(readKnowledgePreferences("employee-2")).toMatchObject({
      onboardingComplete: false,
      savedIds: [],
      recent: [],
      feedback: {},
    });
  });
});
