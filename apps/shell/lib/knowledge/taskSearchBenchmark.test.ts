import { expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { knowledgeContentForAudience } from "./audience";
import { taskCatalog, tasksForRoles } from "./taskCatalog";
import { searchKnowledge } from "./search";
import { TASK_SEARCH_BENCHMARK } from "./taskSearchBenchmark.fixture";

it("maintains five fixed intent categories for each of eleven personas", () => {
  expect(TASK_SEARCH_BENCHMARK).toHaveLength(55);
  const personas = new Set(TASK_SEARCH_BENCHMARK.map(row => row.persona));
  expect(personas.size).toBe(11);
  for (const persona of personas) {
    expect(TASK_SEARCH_BENCHMARK.filter(row => row.persona === persona).map(row => row.kind)).toEqual(["literal", "colloquial", "recovery", "handoff", "policy"]);
  }
});

it.each(TASK_SEARCH_BENCHMARK)("$persona / $kind: $query", row => {
    const audience = row.persona === "vendor" ? "vendor" : "internal";
    const content = knowledgeContentForAudience(KNOWLEDGE_CONTENT, audience === "vendor" ? "vendor" : "employee");
    const expected = taskCatalog(content, audience).find(task => task.id === row.expectedTaskId);
    expect(expected, row.query).toBeDefined();
    expect(expected?.roleIds, row.query).toContain(row.roleId);
    const results = searchKnowledge(content, row.query, { roleId: row.roleId });
    expect(results.slice(0, 3).map(result => result.id)).toContain(row.expectedTaskId);
    expect(results.every(result => result.availability !== "coming_soon")).toBe(true);
    for (const result of results.filter(result => result.taskId)) {
      const task = taskCatalog(content, audience).find(task => task.id === result.taskId);
      expect(task?.roleIds).toContain(row.roleId);
      expect(result.href).toBe(task?.guideHref);
      expect(content.features.some(feature => feature.availability === "live" && feature.routes.includes(result.actionHref ?? ""))).toBe(true);
      const target = new URL(result.href, "https://local.invalid").searchParams;
      expect(target.has("flow")
        ? content.flows.some(flow => flow.id === target.get("flow"))
        : content.articles.some(article => article.id === target.get("article"))).toBe(true);
    }
});

it("handles misspellings, old route labels, ambiguous terms and genuine zero results", () => {
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "recieving")[0]?.title).toMatch(/receiv/i);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "accreditaion")[0]?.title).toMatch(/accredit/i);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "/procurement/requests/new").slice(0, 3).map(r => r.id)).toContain("procurement-request-create");
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "stock").length).toBeGreaterThan(1);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "zxqv nonexistent astrophysics")).toEqual([]);
});

it("filters task eligibility using all actual Finance roles before returning results", () => {
  const userRoles = { warehouse: ["finance"], procurement: ["finance"], events: ["finance_reviewer"] };
  const eligible = tasksForRoles(KNOWLEDGE_CONTENT, userRoles, "internal");
  const results = searchKnowledge(KNOWLEDGE_CONTENT, "", { userRoles });
  expect(results.filter(r => r.taskId).map(r => r.id).sort()).toEqual(eligible.map(t => t.id).sort());
  expect(results.some(r => r.taskId === "author-purchase-order")).toBe(false);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "", { userRoles: {} }).some(r => r.taskId)).toBe(false);
});

it("never leaks internal results or counts through mixed vendor roles", () => {
  const scoped = knowledgeContentForAudience(KNOWLEDGE_CONTENT, "vendor");
  const mixed = { core: ["vendor_portal", "platform_admin"], procurement: ["admin"] };
  const actual = searchKnowledge(KNOWLEDGE_CONTENT, "", { userRoles: mixed });
  const expected = searchKnowledge(scoped, "", { userRoles: { core: ["vendor_portal"] } });
  expect(actual).toEqual(expected);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "", { userRoles: mixed, audience: "internal" })).toEqual(expected);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, "manage approved assignments", { userRoles: mixed })).toEqual([]);
});
