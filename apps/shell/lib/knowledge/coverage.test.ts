import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KNOWLEDGE_CONTENT } from "./content";
import { validateTaskCoverage } from "./coverage";

describe("task coverage evidence boundary", () => {
  it("keeps the reviewed machine-readable documentation snapshot exact", () => {
    const doc = readFileSync(new URL("../../../../docs/audits/task-first-coverage.md", import.meta.url), "utf8");
    const snapshot = JSON.parse(doc.match(/```json\r?\n([\s\S]*?)\r?\n```/)![1]!);
    const result = validateTaskCoverage(KNOWLEDGE_CONTENT);
    expect(snapshot.counts).toEqual(result.counts);
    expect(snapshot.controls).toEqual(result.inventory.map((row) => ({
      key: row.key, referenceId: row.referenceId, availability: row.availability,
      flowIds: row.flowIds, evidenceIds: row.evidenceIds, unverified: row.unverified,
    })));
  });
  it("counts the exact inventory without claiming screenshots are accepted", () => {
    const result = validateTaskCoverage(KNOWLEDGE_CONTENT);
    expect(result.counts).toEqual({
      features: 68, controls: 293, liveFeatures: 59, limitedFeatures: 0,
      comingSoonFeatures: 9, flows: 26, decisions: 58, policyReferences: 14,
      evidenceRecords: 53, controlEvidenceMatches: 0,
    });
    expect(result.unmappedLiveControls).toEqual([]);
    expect(result.unresolvedTargets).toEqual([]);
    expect(result.invalidDecisionBranches).toEqual([]);
    expect(result.missingActionEvidence).toHaveLength(287);
    expect(result.missingActionEvidence.filter(key => key.startsWith("vendor-application-submission:"))).toEqual([
      "vendor-application-submission:vendor-self-case",
      "vendor-application-submission:vendor-self-prepare",
      "vendor-application-submission:vendor-self-recover",
      "vendor-application-submission:vendor-self-submit",
      "vendor-application-submission:vendor-self-legal",
    ]);
    expect(result.counts.features).toBe(KNOWLEDGE_CONTENT.features.length);
    expect(result.counts.controls).toBe(KNOWLEDGE_CONTENT.features.reduce((n, f) => n + f.controls.length, 0));
    expect(result.inventory).toHaveLength(result.counts.controls);
    expect(result.unverified).toBe(true);
    expect(result.inventory.every((row) => row.unverified)).toBe(true);
  });

  it("reports missing control instructions and missing exact control screenshots separately", () => {
    const content = structuredClone(KNOWLEDGE_CONTENT);
    const feature = content.features.find((f) => f.availability === "live")!;
    feature.controls[0]!.validation = "";
    content.evidence = [];
    const result = validateTaskCoverage(content);
    expect(result.unmappedLiveControls).toContain(`${feature.id}:${feature.controls[0]!.name}`);
    expect(result.missingActionEvidence).toContain(`${feature.id}:${feature.controls[0]!.name}`);
  });

  it("rejects dangling and coming-soon flow targets without mutating content", () => {
    const content = structuredClone(KNOWLEDGE_CONTENT);
    content.features[0]!.relatedFlowIds = ["missing", content.flows[0]!.id];
    content.flows[0]!.availability = "coming_soon";
    const before = JSON.stringify(content);
    const result = validateTaskCoverage(content);
    expect(result.unresolvedTargets).toContain(`${content.features[0]!.id}:missing`);
    expect(result.unresolvedTargets).toContain(`${content.features[0]!.id}:${content.flows[0]!.id}:coming_soon`);
    expect(JSON.stringify(content)).toBe(before);
  });

  it("retains existing graph checks for orphan edges and closed cycles", () => {
    const content = structuredClone(KNOWLEDGE_CONTENT);
    const flow = content.flows[0]!;
    flow.edges.push({ from: flow.startNodeId, to: "missing" });
    flow.edges = flow.edges.filter((e) => !flow.nodes.some((n) => n.id === e.to && n.type === "terminal"));
    expect(validateTaskCoverage(content).invalidDecisionBranches.length).toBeGreaterThan(0);
  });

  it("does not promote a matching hotspot to accepted release evidence", () => {
    const content = structuredClone(KNOWLEDGE_CONTENT);
    const feature = content.features.find((item) => item.availability === "live")!;
    const evidence = content.evidence[0]!;
    evidence.featureId = feature.id;
    evidence.hotspots[0]!.label = feature.controls[0]!.name;
    const row = validateTaskCoverage(content).inventory.find((item) => item.key === `${feature.id}:${feature.controls[0]!.name}`)!;
    expect(row.evidenceIds).toContain(evidence.id);
    expect(row.unverified).toBe(true);
  });

  it("rejects unknown decision owners and ambiguous branches", () => {
    const content = structuredClone(KNOWLEDGE_CONTENT);
    const flow = content.flows.find((item) => item.nodes.some((node) => node.type === "decision"))!;
    const decision = flow.nodes.find((node) => node.type === "decision")!;
    decision.authorityRoleId = "unknown";
    for (const edge of flow.edges.filter((item) => item.from === decision.id)) edge.label = "Same outcome";
    const errors = validateTaskCoverage(content).invalidDecisionBranches;
    expect(errors).toContain(`${flow.id}:${decision.id}:decision authority/policy`);
    expect(errors).toContain(`${flow.id}:${decision.id}:decision labels`);
  });
});
