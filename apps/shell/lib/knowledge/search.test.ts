import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { searchKnowledge } from "./search";

describe("knowledge search taxonomy", () => {
  it("keeps a specific multi-word task focused on results that match every term", () => {
    const results = searchKnowledge(KNOWLEDGE_CONTENT, "reset password");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toMatch(/password reset/i);
    expect(results.map((result) => result.title)).not.toContain("Invite vendor");
    expect(results.map((result) => result.title)).not.toContain(
      "Warehouse receiving",
    );
  });

  it("labels workflow nodes by their actual semantic type", () => {
    const results = searchKnowledge(KNOWLEDGE_CONTENT, "complete");
    const nodeTypes = new Set(
      results
        .filter((result) => result.destinationContext.includes(" / "))
        .map((result) => result.type),
    );
    expect(nodeTypes.has("decision")).toBe(true);
    expect(nodeTypes.has("outcome")).toBe(true);
    expect([...nodeTypes]).not.toContain("task");
  });

  it("does not mark terminal outcomes as executable live tasks", () => {
    const outcomes = searchKnowledge(KNOWLEDGE_CONTENT, "complete").filter(
      (result) => result.type === "outcome",
    );
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((result) => result.availability === "limited")).toBe(
      true,
    );
  });
});
