import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { knowledgeContentForAudience } from "./audience";
import { VENDOR_APPLICATION_FLOW as flow, VENDOR_APPLICATION_FLOW_SOURCES } from "./vendorApplicationFlow";
import { validateKnowledgeBase } from "./validate";
import { evidenceRequirements, validateEvidenceRequirements } from "./evidenceContract";
import { LEGAL_ROUTE_BY_ID } from "../../../../modules/legal/src/routes";
import { applicationEditState } from "../../../../modules/legal/src/vendorCaseWorkflow";

it("matches actual vendor-mounted routes and source edit-state boundaries", () => {
  expect(flow.nodes.find(node => node.id === "vendor-self-readonly")).toMatchObject({
    terminalOutcome: "complete", title: "Read-only case view complete",
  });
  expect(flow.nodes.find(node => node.id === "vendor-self-readonly")?.body).toContain("does not change that status");
  for (const [featureId, routeId] of [["vendor-case-detail", "case-detail"], ["vendor-application", "application"]] as const) {
    expect(KNOWLEDGE_CONTENT.features.find(item => item.id === featureId)?.routes).toContain("/vendor" + LEGAL_ROUTE_BY_ID[routeId].path);
  }
  expect(applicationEditState("draft").editable).toBe(true);
  expect(applicationEditState("correction_requested").editable).toBe(false);
  expect(applicationEditState("correction_requested", { requestedAt: "2026-09-07", note: "Correct the entity details", sourceVersion: 2, revision: 3 }).editable).toBe(true);
  for (const status of ["submitted", "under_review", "approved", "rejected"] as const) {
    expect(applicationEditState(status).editable).toBe(false);
  }
});

it("traces source files without claiming human review or published evidence", () => {
  for (const source of VENDOR_APPLICATION_FLOW_SOURCES) expect(existsSync(path.resolve("../..", source)), source).toBe(true);
  expect(flow.availability).toBe("limited");
  expect(flow.nodes.every(node => !node.evidenceId)).toBe(true);
  expect(flow).not.toHaveProperty("reviewedAt");
  expect(flow).not.toHaveProperty("approvedBy");
});

it("does not allow promotion to live without reviewed executable-step evidence", () => {
  const content = { ...KNOWLEDGE_CONTENT, flows: KNOWLEDGE_CONTENT.flows.map(item => item.id === flow.id ? { ...item, availability: "live" as const } : item) };
  expect(validateKnowledgeBase(content).filter(message => message.includes("requires screenshot evidence"))).toHaveLength(5);
  expect(validateKnowledgeBase(KNOWLEDGE_CONTENT)).toEqual([]);
});

it("preserves all 39 preexisting executable-node captures and 53 total requirements", () => {
  const previous = { ...KNOWLEDGE_CONTENT, flows: KNOWLEDGE_CONTENT.flows.filter(item => item.id !== flow.id) };
  const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
  expect(requirements).toEqual(evidenceRequirements(previous));
  expect(requirements).toHaveLength(53);
  const executable = previous.flows.filter(item => (item.availability ?? "live") === "live")
    .flatMap(item => item.nodes.filter(node => ["start", "action", "handoff"].includes(node.type)));
  expect(executable).toHaveLength(39);
  expect(requirements.filter(item => item.nodeId).map(item => item.nodeId).sort()).toEqual(executable.map(node => node.id).sort());
  expect(validateEvidenceRequirements(requirements)).toEqual([]);
});

it("treats omitted availability as live for capture requirements and validation", () => {
  const implicit = { ...KNOWLEDGE_CONTENT, flows: KNOWLEDGE_CONTENT.flows.map(item =>
    item.availability === "live" ? { ...item, availability: undefined } : item) };
  expect(evidenceRequirements(implicit)).toEqual(evidenceRequirements(KNOWLEDGE_CONTENT));
  const uncertified = { ...implicit, flows: implicit.flows.map(item =>
    item.id === flow.id ? { ...item, availability: undefined } : item) };
  expect(() => evidenceRequirements(uncertified)).toThrow("has no evidenceId");
  expect(validateKnowledgeBase(uncertified).filter(message => message.includes("requires screenshot evidence"))).toHaveLength(5);
});

it("retains only the vendor-owned flow and scoped feature/article links", () => {
  const scoped = knowledgeContentForAudience(KNOWLEDGE_CONTENT, "vendor");
  expect(scoped.flows.map(item => item.id)).toEqual([flow.id]);
  for (const id of ["vendor-cases", "vendor-application", "vendor-case-detail"]) {
    expect(scoped.features.find(item => item.id === id)?.relatedFlowIds).toEqual([flow.id]);
    expect(scoped.articles.find(item => item.id === "feature-" + id)?.flowIds).toContain(flow.id);
  }
  expect(knowledgeContentForAudience(scoped, "vendor")).toEqual(scoped);
  expect(knowledgeContentForAudience({ ...KNOWLEDGE_CONTENT, flows: [] }, "vendor").flows).toEqual([]);
  const unsafe = { ...flow, roles: ["vendor_portal", "legal_reviewer"] };
  expect(knowledgeContentForAudience({ ...KNOWLEDGE_CONTENT, flows: [unsafe] }, "vendor").flows).toEqual([]);
});

it("keeps every node reachable with valid references and negative decision recovery", () => {
  const ids = new Set(flow.nodes.map(node => node.id));
  const reached = new Set([flow.startNodeId]);
  for (let i = 0; i < flow.nodes.length; i++) {
    for (const edge of flow.edges) {
      expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
      if (reached.has(edge.from)) reached.add(edge.to);
    }
  }
  expect(reached.size).toBe(ids.size);
  for (const node of flow.nodes) {
    expect(node.ownerRoleIds).toEqual(["vendor_portal"]);
    expect(KNOWLEDGE_CONTENT.articles.some(article => article.id === node.articleId)).toBe(true);
    if (node.type === "decision") {
      expect(node.authorityRoleId).toBe("vendor_portal");
      expect(flow.edges.filter(edge => edge.from === node.id).map(edge => edge.outcome)).toEqual(expect.arrayContaining(["success", "exception"]));
    }
  }
});

it("separates version recovery and Legal authority from vendor submission success", () => {
  const text = JSON.stringify(flow);
  expect(text).toMatch(/read-only/);
  expect(text).toMatch(/expected version/);
  expect(text).toMatch(/fresh signature/);
  expect(text).toMatch(/core.submit_documents/);
  expect(text).toMatch(/not approved/);
  expect(flow.edges).toContainEqual(expect.objectContaining({ from: "vendor-self-accepted", to: "vendor-self-recover", outcome: "exception" }));
  expect(flow.nodes.find(node => node.id === "vendor-self-legal")?.body).toMatch(/remain with Legal, not the vendor/);
});
