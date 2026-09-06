import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { searchKnowledge } from "./search";

describe("knowledge search taxonomy", () => {
  it("preserves task, role and feature filter behavior without mutating query context", () => {
    const filters = Object.freeze({ type: "task" as const, audience: "internal" as const, userRoles: { procurement: ["requester"] } });
    const results = searchKnowledge(KNOWLEDGE_CONTENT, "buy something", filters);
    expect(results[0]?.taskId).toBe("create-purchase-request");
    expect(results[0]?.href).toBe("/knowledge?article=feature-procurement-request-create");
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "buy something", { ...filters, type: "role" }).every(result => result.type === "role")).toBe(true);
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "purchase", { ...filters, type: "feature" }).every(result => result.type === "feature")).toBe(true);
    expect(filters.type).toBe("task");
  });

  it("returns each stable task once even when source references are duplicated", () => {
    const content = { ...KNOWLEDGE_CONTENT, features: [...KNOWLEDGE_CONTENT.features, ...KNOWLEDGE_CONTENT.features] };
    const results = searchKnowledge(content, "buy something");
    expect(results.filter(result => result.taskId === "create-purchase-request")).toHaveLength(1);
    expect(new Set(results.map(result => result.type + ":" + result.href + ":" + result.title)).size).toBe(results.length);
  });
  it("indexes stable task IDs and prefers literal task guidance", () => {
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "request-stock")[0]?.id).toBe("request-stock");
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "buy something")[0]?.id).toBe("create-purchase-request");
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "zxqv nonexistent astrophysics")).toEqual([]);
  });

  it("requires explicit roadmap intent for coming-soon flows and their nodes", () => {
    const flow = KNOWLEDGE_CONTENT.flows[0]!;
    const content = { ...KNOWLEDGE_CONTENT, flows: [{ ...flow, availability: "coming_soon" as const }] };
    const normal = searchKnowledge(content, "");
    expect(normal.some(result => result.id === flow.id || result.id.startsWith(flow.id + "-"))).toBe(false);
    const roadmap = searchKnowledge(content, "roadmap").filter(result => result.id === flow.id || result.id.startsWith(flow.id + "-"));
    expect(roadmap.length).toBeGreaterThan(0);
    expect(roadmap.every(result => result.availability === "coming_soon")).toBe(true);
  });
  it("recovers from common spelling mistakes and plain-language aliases", () => {
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "recieving")[0]?.title).toMatch(
      /receiv/i,
    );
    expect(
      searchKnowledge(KNOWLEDGE_CONTENT, "accreditaion")[0]?.title,
    ).toMatch(/accredit/i);
    expect(searchKnowledge(KNOWLEDGE_CONTENT, "log in")[0]?.title).toMatch(
      /sign in|access/i,
    );
  });

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
