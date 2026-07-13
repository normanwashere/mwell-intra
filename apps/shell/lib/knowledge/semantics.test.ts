import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import {
  nodePresentation,
  resolveSelectedWorkflowNode,
  workflowRoleAlignmentErrors,
} from "./semantics";

describe("knowledge workflow semantics", () => {
  it("opens every workflow at its declared start node", () => {
    for (const flow of KNOWLEDGE_CONTENT.flows) {
      expect(
        resolveSelectedWorkflowNode(flow, {
          requestedStepId: null,
          hasBranch: false,
          branchNodeId: flow.nodes.at(-1)!.id,
        }).id,
      ).toBe(flow.startNodeId);
    }
  });

  it("gives every node an honest presentation instead of a generic placeholder", () => {
    const evidenceByNode = new Map(
      KNOWLEDGE_CONTENT.evidence.map((item) => [item.nodeId, item]),
    );
    for (const flow of KNOWLEDGE_CONTENT.flows) {
      for (const node of flow.nodes) {
        const presentation = nodePresentation(node, evidenceByNode.get(node.id));
        expect(presentation.kind).not.toBe("placeholder");
        expect(presentation.title.length).toBeGreaterThan(0);
        expect(presentation.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps documented workflow owners aligned with live RBAC", () => {
    expect(workflowRoleAlignmentErrors(KNOWLEDGE_CONTENT)).toEqual([]);
  });

  it("uses ordered markers when a screenshot requires more than one interaction", () => {
    const addBin = KNOWLEDGE_CONTENT.evidence.find(
      (item) => item.nodeId === "setup-bin",
    );
    expect(addBin?.hotspots.map((item) => item.label)).toEqual([
      "Scannable bin code",
      "Add bin",
    ]);
    expect(addBin?.hotspots.map((item) => item.number)).toEqual([1, 2]);
  });
});
