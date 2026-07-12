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
    "p2p-rfq-quotes",
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
    "$id gives every decision distinct labelled outcomes and destinations or an explicit merge contract",
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
        const labels = branches.map((edge) =>
          edge.label!.trim().replace(/\s+/g, " ").toLowerCase(),
        );
        expect(new Set(labels).size, decision.id).toBe(branches.length);

        const destinations = branches.map((edge) => edge.to);
        const duplicateDestinations = [...new Set(destinations)].filter(
          (destination) =>
            destinations.filter((candidate) => candidate === destination)
              .length > 1,
        );
        if (decision.mergeContract) {
          expect(
            decision.mergeContract.justification.trim(),
            decision.id,
          ).toBeTruthy();
          expect(duplicateDestinations, decision.id).toEqual([
            decision.mergeContract.destinationNodeId,
          ]);
        } else {
          expect(new Set(destinations).size, decision.id).toBe(branches.length);
          expect(
            new Set(destinations).size,
            decision.id,
          ).toBeGreaterThanOrEqual(2);
        }
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

  it("routes below-threshold RFQ and at-or-above-threshold RFP work separately before vendor eligibility", () => {
    const procurement = KNOWLEDGE_FLOWS.find(
      (item) => item.id === "procure-to-pay",
    )!;

    expect(outgoingEdges(procurement, "p2p-threshold")).toEqual([
      expect.objectContaining({
        label: "Below PHP 1,000,000",
        to: "p2p-rfq-evidence",
      }),
      expect.objectContaining({
        label: "PHP 1,000,000 or above",
        to: "p2p-rfp-evidence",
      }),
    ]);
    expect(outgoingEdges(procurement, "p2p-rfq-evidence")).toEqual([
      expect.objectContaining({ to: "p2p-rfq-quotes" }),
    ]);
    expect(outgoingEdges(procurement, "p2p-rfp-evidence")).toEqual([
      expect.objectContaining({ to: "p2p-bids" }),
    ]);
    expect(outgoingEdges(procurement, "p2p-rfq-quotes")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Comparable quotations complete",
          to: "p2p-accreditation",
        }),
      ]),
    );
    expect(outgoingEdges(procurement, "p2p-bids")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Competitive bid pack complete",
          to: "p2p-accreditation",
        }),
      ]),
    );

    expect(
      procurement.nodes.find((item) => item.id === "p2p-rfq-evidence")?.body,
    ).toMatch(/comparable quotations/i);
    expect(
      procurement.nodes.find((item) => item.id === "p2p-rfp-evidence")?.body,
    ).toMatch(/award recommendation.*vendor proposals/i);
  });
});
