import { describe, expect, it } from "vitest";
import { layoutFlow, outgoingEdges } from "./graph";
import { KNOWLEDGE_FLOWS } from "./workflows";
import type { KnowledgeFlow } from "./types";

const flow: KnowledgeFlow = {
  id: "branch",
  title: "Branch",
  summary: "A branch",
  roles: ["owner"],
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      type: "decision",
      title: "Choose",
      ownerRoleIds: ["owner"],
      body: "Choose",
      authorityRoleId: "owner",
      policyBasis: "Branch policy.",
    },
    {
      id: "yes",
      type: "terminal",
      title: "Yes",
      ownerRoleIds: ["owner"],
      body: "Yes",
      terminalOutcome: "complete",
    },
    {
      id: "no",
      type: "terminal",
      title: "No",
      ownerRoleIds: ["owner"],
      body: "No",
      terminalOutcome: "rejected",
    },
  ],
  edges: [
    { from: "start", to: "yes", label: "Yes", outcome: "success" },
    { from: "start", to: "no", label: "No", outcome: "exception" },
  ],
};

describe("knowledge graph layout", () => {
  it("places alternate outcomes in separate lanes at the same depth", () => {
    const layout = layoutFlow(flow);
    expect(layout.nodes.get("yes")?.depth).toBe(1);
    expect(layout.nodes.get("no")?.depth).toBe(1);
    expect(layout.nodes.get("yes")?.lane).not.toBe(
      layout.nodes.get("no")?.lane,
    );
  });

  it("returns every named outgoing branch", () => {
    expect(outgoingEdges(flow, "start").map((edge) => edge.label)).toEqual([
      "Yes",
      "No",
    ]);
  });
});

const PRINCIPAL_DECISIONS: Record<string, string[]> = {
  "identity-and-access": ["access-authorized", "access-role-correct"],
  "procure-to-pay": [
    "p2p-threshold",
    "p2p-risk",
    "p2p-competition",
    "p2p-bids",
    "p2p-exception",
    "p2p-budget",
    "p2p-doa",
    "p2p-accreditation",
  ],
  "vendor-accreditation": [
    "vendor-evidence",
    "vendor-risk",
    "vendor-instruments",
    "vendor-disposition",
    "vendor-remediation",
    "vendor-renewal",
    "vendor-suspension",
  ],
  "receive-to-putaway": [
    "receive-po-eligible",
    "receive-traceability",
    "receive-bin-ready",
  ],
  "quality-disposition": ["quality-inspection", "quality-hold-review"],
  "event-fulfillment": [
    "event-demand-valid",
    "event-stock-ready",
    "event-reconciled",
  ],
  "returns-reconciliation": ["return-condition", "return-reconciled"],
  "cycle-count-adjustment": ["count-variance", "count-adjustment-approval"],
  administration: [
    "admin-user-access",
    "admin-department",
    "admin-doa",
    "admin-route",
  ],
};

function reachableNodeIds(flow: KnowledgeFlow): Set<string> {
  const reachable = new Set<string>();
  const queue = [flow.startNodeId];
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    queue.push(
      ...flow.edges
        .filter((edge) => edge.from === nodeId)
        .map((edge) => edge.to),
    );
  }
  return reachable;
}

function nodeIdsReachingTerminal(flow: KnowledgeFlow): Set<string> {
  const reachesTerminal = new Set(
    flow.nodes
      .filter((item) => item.type === "terminal")
      .map((item) => item.id),
  );
  const queue = [...reachesTerminal];
  while (queue.length) {
    const nodeId = queue.shift()!;
    for (const edge of flow.edges.filter((item) => item.to === nodeId)) {
      if (reachesTerminal.has(edge.from)) continue;
      reachesTerminal.add(edge.from);
      queue.push(edge.from);
    }
  }
  return reachesTerminal;
}

describe("principal workflow decision contracts", () => {
  it.each(Object.entries(PRINCIPAL_DECISIONS))(
    "%s models its required policy decisions",
    (flowId, decisionIds) => {
      const flow = KNOWLEDGE_FLOWS.find((item) => item.id === flowId);
      expect(flow, `missing principal flow ${flowId}`).toBeDefined();
      const actualDecisionIds = flow!.nodes
        .filter((item) => item.type === "decision")
        .map((item) => item.id);
      expect(actualDecisionIds).toEqual(expect.arrayContaining(decisionIds));
    },
  );

  it.each(KNOWLEDGE_FLOWS)(
    "$id gives every decision authority, policy, and at least two labelled outcomes",
    (flow) => {
      for (const decision of flow.nodes.filter(
        (item) => item.type === "decision",
      )) {
        expect(decision.authorityRoleId, decision.id).toBeTruthy();
        expect(decision.ownerRoleIds, decision.id).toContain(
          decision.authorityRoleId,
        );
        expect(decision.policyBasis, decision.id).toBeTruthy();
        const branches = outgoingEdges(flow, decision.id);
        expect(branches.length, decision.id).toBeGreaterThanOrEqual(2);
        expect(
          branches.every((edge) => Boolean(edge.label?.trim())),
          decision.id,
        ).toBe(true);
      }
    },
  );

  it.each(KNOWLEDGE_FLOWS)(
    "$id declares every terminal outcome and makes every node reachable and terminating",
    (flow) => {
      const terminals = flow.nodes.filter((item) => item.type === "terminal");
      expect(terminals.length).toBeGreaterThan(0);
      for (const terminal of terminals)
        expect(terminal.terminalOutcome, terminal.id).toBeTruthy();

      const reachable = reachableNodeIds(flow);
      const terminating = nodeIdsReachingTerminal(flow);
      expect([...reachable].sort()).toEqual(
        flow.nodes.map((item) => item.id).sort(),
      );
      expect([...terminating].sort()).toEqual(
        flow.nodes.map((item) => item.id).sort(),
      );
    },
  );
});
