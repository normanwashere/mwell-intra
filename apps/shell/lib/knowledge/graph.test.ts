import { describe, expect, it } from "vitest";
import {
  branchOptions,
  edgeChoiceId,
  exceptionNodes,
  layoutFlow,
  outgoingEdges,
  resolveBranch,
  roleNodes,
  traceBranch,
} from "./graph";
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

const mergingFlow: KnowledgeFlow = {
  id: "merge",
  title: "Merge",
  summary: "Branches merge before completion",
  roles: ["requester", "approver"],
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      type: "decision",
      title: "Choose route",
      ownerRoleIds: ["approver"],
      body: "Choose",
      authorityRoleId: "approver",
      policyBasis: "Routing policy.",
    },
    {
      id: "standard",
      type: "action",
      title: "Standard review",
      ownerRoleIds: ["requester"],
      body: "Review",
      evidenceId: "standard-pack",
    },
    {
      id: "exception",
      type: "exception",
      title: "Document exception",
      ownerRoleIds: ["approver"],
      body: "Document",
      exception: "Escalate an incomplete request.",
    },
    {
      id: "merge",
      type: "system",
      title: "Record decision",
      ownerRoleIds: ["approver"],
      body: "Record",
    },
    {
      id: "complete",
      type: "terminal",
      title: "Complete",
      ownerRoleIds: ["requester"],
      body: "Done",
      outcome: "Approval and evidence are recorded.",
      evidenceId: "completion-record",
      terminalOutcome: "complete",
    },
  ],
  edges: [
    {
      id: "standard-route",
      from: "start",
      to: "standard",
      label: "Standard",
      outcome: "success",
    },
    {
      id: "exception-route",
      from: "start",
      to: "exception",
      label: "Exception",
      outcome: "exception",
    },
    { from: "standard", to: "merge" },
    { from: "exception", to: "merge" },
    { from: "merge", to: "complete" },
  ],
};

const sameDestinationFlow: KnowledgeFlow = {
  ...mergingFlow,
  id: "same-destination",
  nodes: mergingFlow.nodes.filter((node) =>
    ["start", "merge", "complete"].includes(node.id),
  ),
  edges: [
    {
      id: "manual-approval",
      from: "start",
      to: "merge",
      label: "Manual approval",
    },
    {
      id: "delegated-approval",
      from: "start",
      to: "merge",
      label: "Delegated approval",
    },
    { id: "record-completion", from: "merge", to: "complete" },
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

  it("centers the root and each depth layer inside the canvas", () => {
    const layout = layoutFlow(mergingFlow);
    const root = layout.nodes.get("start")!;
    const branchCenters = ["standard", "exception"].map(
      (id) => layout.nodes.get(id)!.x + 100,
    );

    expect(root.x + 100).toBeCloseTo(layout.width / 2, 1);
    expect((Math.min(...branchCenters) + Math.max(...branchCenters)) / 2).toBeCloseTo(
      layout.width / 2,
      1,
    );
  });

  it("returns every named outgoing branch", () => {
    expect(outgoingEdges(flow, "start").map((edge) => edge.label)).toEqual([
      "Yes",
      "No",
    ]);
  });
});

describe("guided branch traversal", () => {
  it("selects a decision edge and follows its path through a merge", () => {
    expect(
      traceBranch(mergingFlow, [
        edgeChoiceId(mergingFlow, mergingFlow.edges[0]!),
      ]).map((node) => node.id),
    ).toEqual(["start", "standard", "merge", "complete"]);
  });

  it("restores the decision node when the latest choice is backtracked", () => {
    expect(
      traceBranch(mergingFlow, [
        edgeChoiceId(mergingFlow, mergingFlow.edges[1]!),
      ]).at(-1)?.id,
    ).toBe("complete");
    expect(traceBranch(mergingFlow, []).map((node) => node.id)).toEqual([
      "start",
    ]);
  });

  it("returns stable branch, role, and exception collections", () => {
    expect(branchOptions(mergingFlow, "start").map((edge) => edge.to)).toEqual([
      "standard",
      "exception",
    ]);
    expect(roleNodes(mergingFlow, "requester").map((node) => node.id)).toEqual([
      "standard",
      "complete",
    ]);
    expect(exceptionNodes(mergingFlow).map((node) => node.id)).toEqual([
      "exception",
    ]);
  });

  it("retains terminal completion evidence in the traced outcome", () => {
    const terminal = traceBranch(mergingFlow, [
      edgeChoiceId(mergingFlow, mergingFlow.edges[0]!),
    ]).at(-1);
    expect(terminal).toMatchObject({
      type: "terminal",
      terminalOutcome: "complete",
      evidenceId: "completion-record",
      outcome: "Approval and evidence are recorded.",
    });
  });

  it("preserves distinct same-destination edge identities and labels", () => {
    const [manual, delegated] = branchOptions(sameDestinationFlow, "start");
    const manualId = edgeChoiceId(sameDestinationFlow, manual!);
    const delegatedId = edgeChoiceId(sameDestinationFlow, delegated!);

    expect(manualId).not.toBe(delegatedId);
    expect(resolveBranch(sameDestinationFlow, [manualId])).toMatchObject({
      choiceIds: [manualId],
      chosenEdges: [expect.objectContaining({ label: "Manual approval" })],
      invalidChoiceIds: [],
    });
    expect(resolveBranch(sameDestinationFlow, [delegatedId])).toMatchObject({
      choiceIds: [delegatedId],
      chosenEdges: [expect.objectContaining({ label: "Delegated approval" })],
      invalidChoiceIds: [],
    });
  });

  it("truncates invalid choice sequences at the last valid decision", () => {
    const validId = edgeChoiceId(
      sameDestinationFlow,
      sameDestinationFlow.edges[0]!,
    );
    const resolution = resolveBranch(sameDestinationFlow, [
      validId,
      "other-flow:stale-choice",
    ]);

    expect(resolution.choiceIds).toEqual([validId]);
    expect(resolution.invalidChoiceIds).toEqual(["other-flow:stale-choice"]);
    expect(resolution.currentNode.id).toBe("complete");
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
