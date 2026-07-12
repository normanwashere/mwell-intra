import { describe, expect, it } from "vitest";
import type {
  KnowledgeContent,
  KnowledgeDecisionNode,
  KnowledgeTerminalNode,
} from "./types";
import { validateKnowledgeContent } from "./validate";

const valid = (): KnowledgeContent => ({
  roles: [
    {
      id: "owner",
      label: "Owner",
      module: "core",
      availability: "live",
      purpose: "Acts",
      authority: {
        capabilities: ["flow.manage"],
        accessibleRoutes: ["/"],
        canDo: ["Manage the flow"],
        cannotDo: ["Bypass the flow"],
        decisions: ["Approve the flow"],
        upstreamRoleIds: [],
        downstreamRoleIds: [],
        escalation: "Contact the platform administrator.",
      },
    },
  ],
  features: [
    {
      id: "flow-management",
      title: "Flow management",
      module: "core",
      availability: "live",
      routes: ["/"],
      roleIds: ["owner"],
      capabilityIds: ["flow.manage"],
      purpose: "Manage the flow.",
      controls: [
        {
          name: "Governed branch",
          behavior: "Records each branch.",
          validation: "Requires a decision label.",
          result: "The flow reaches a terminal state.",
        },
      ],
      reads: ["flow"],
      writes: ["flow"],
      statuses: ["active"],
      exceptions: [],
      owner: "Platform",
      reviewedAt: "2026-07-11",
    },
  ],
  articles: [],
  glossary: [],
  futureFeatures: [],
  evidence: [
    {
      id: "ev-start",
      nodeId: "start",
      desktopSrc: "/knowledge/screenshots/start.png",
      route: "/",
      roleId: "owner",
      capturedAt: "2026-07-11",
      reviewedAt: "2026-07-11",
      provenance: "production",
      alt: "Start screen",
      expectedLandmark: "Start",
      sensitiveDataReviewed: true,
      hotspots: [
        {
          id: "open",
          number: 1,
          x: 0.5,
          y: 0.5,
          label: "Open",
          instruction: "Open the record.",
        },
      ],
    },
  ],
  flows: [
    {
      id: "flow",
      title: "Flow",
      summary: "Summary",
      roles: ["owner"],
      startNodeId: "start",
      nodes: [
        {
          id: "start",
          type: "decision",
          title: "Valid?",
          ownerRoleIds: ["owner"],
          body: "Decide",
          evidenceId: "ev-start",
          authorityRoleId: "owner",
          policyBasis: "Flow policy.",
        },
        {
          id: "yes",
          type: "terminal",
          title: "Done",
          ownerRoleIds: ["owner"],
          body: "Complete",
          terminalOutcome: "complete",
        },
        {
          id: "no",
          type: "terminal",
          title: "Stopped",
          ownerRoleIds: ["owner"],
          body: "Stopped",
          terminalOutcome: "rejected",
        },
      ],
      edges: [
        { from: "start", to: "yes", label: "Yes", outcome: "success" },
        { from: "start", to: "no", label: "No", outcome: "exception" },
      ],
    },
  ],
});

describe("validateKnowledgeContent", () => {
  it("rejects incomplete live content contracts", () => {
    const invalid = {
      roles: [
        {
          id: "procurement_requester",
          label: "Procurement requester",
          module: "procurement",
          availability: "live",
          purpose: "Create governed requests.",
          authority: {
            capabilities: [],
            accessibleRoutes: ["/procurement/requests/new"],
            canDo: ["Create a request"],
            cannotDo: ["Approve a request"],
            decisions: [],
            upstreamRoleIds: [],
            downstreamRoleIds: [],
            escalation: "Contact Procurement.",
          },
        },
      ],
      articles: [
        {
          id: "purchase-request",
          slug: "procedures/purchase-request",
          title: "Create a purchase request",
          summary: "Create a governed purchase request.",
          module: "procurement",
          roles: ["procurement_requester"],
          keywords: [],
          sections: [],
          relatedArticleIds: [],
          flowIds: ["p2p"],
          liveRoutes: ["/procurement/requests/new"],
          owner: "Procurement",
          reviewedAt: "2026-07-11",
        },
      ],
      features: [
        {
          id: "purchase-request",
          title: "Purchase request",
          module: "procurement",
          availability: "coming_soon",
          routes: ["/procurement/requests/new"],
          roleIds: ["procurement_requester"],
          capabilityIds: ["request.create"],
          purpose: "Create requests.",
          controls: [
            {
              name: "Required evidence",
              behavior: "Requires evidence before submission.",
              validation: "Rejects missing evidence.",
              result: "The request remains a draft.",
            },
          ],
          reads: ["purchase requests"],
          writes: ["purchase requests"],
          statuses: ["draft"],
          exceptions: [],
          owner: "Procurement",
          reviewedAt: "2026-07-11",
        },
      ],
      glossary: [],
      futureFeatures: [],
      evidence: [],
      flows: [
        {
          id: "p2p",
          title: "Procure to pay",
          summary: "Request and approve procurement.",
          roles: ["procurement_requester"],
          startNodeId: "create-request",
          nodes: [
            {
              id: "create-request",
              type: "action",
              title: "Create request",
              ownerRoleIds: ["procurement_requester"],
              body: "Create the governed request.",
            },
            {
              id: "threshold-decision",
              type: "decision",
              title: "Is approval required?",
              ownerRoleIds: ["procurement_requester"],
              body: "Determine the approval route.",
              policyBasis: "Procurement policy threshold.",
            },
            {
              id: "complete",
              type: "terminal",
              title: "Request complete",
              ownerRoleIds: ["procurement_requester"],
              body: "The request is complete.",
              terminalOutcome: "complete",
            },
          ],
          edges: [
            { from: "create-request", to: "threshold-decision" },
            {
              from: "threshold-decision",
              to: "complete",
              label: "Yes",
              outcome: "success",
            },
          ],
        },
      ],
    } as unknown as KnowledgeContent;

    expect(validateKnowledgeContent(invalid)).toEqual(
      expect.arrayContaining([
        "role procurement_requester has no capability profile",
        "flow p2p:threshold-decision has no authority",
        "flow p2p:create-request requires screenshot evidence",
        "feature purchase-request is coming soon but covers live route /procurement/requests/new",
      ]),
    );
  });

  it("accepts an explicit governed branch", () => {
    expect(validateKnowledgeContent(valid())).toEqual([]);
  });

  it("keeps strict evidence and decision governance as the default while allowing staged aggregate validation", () => {
    const content = valid();
    const flow = content.flows[0]!;
    const decision = flow.nodes[0]! as KnowledgeDecisionNode;
    const terminal = flow.nodes[1]! as KnowledgeTerminalNode;
    Object.assign(decision, {
      authorityRoleId: undefined,
      policyBasis: undefined,
    });
    Object.assign(terminal, { terminalOutcome: undefined });
    content.articles.push({
      id: "article",
      slug: "procedures/article",
      title: "Article",
      summary: "Summary",
      module: "core",
      roles: ["owner"],
      keywords: [],
      sections: [
        {
          id: "procedure",
          title: "Procedure",
          body: "Follow the governed procedure.",
          steps: [
            {
              title: "Complete action",
              ownerRoleIds: ["owner"],
              instruction: "Complete the action.",
              expectedOutcome: "The action is complete.",
            },
          ],
        },
      ],
      relatedArticleIds: [],
      flowIds: ["flow"],
      liveRoutes: ["/"],
      owner: "Platform",
      reviewedAt: "2026-07-11",
    });

    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "article:Complete action requires screenshot evidence",
        "flow flow:start has no authority",
        "flow flow:start has no policy basis",
        "flow flow:yes has invalid terminal outcome",
      ]),
    );
    expect(
      validateKnowledgeContent(content, {
        enforceEvidence: false,
        enforceDecisionGovernance: false,
      }),
    ).toEqual([]);
  });

  it("requires screenshot evidence for every executable article step", () => {
    const content = valid();
    content.articles.push({
      id: "article",
      slug: "procedures/article",
      title: "Article",
      summary: "Summary",
      module: "core",
      roles: ["owner"],
      keywords: [],
      sections: [
        {
          id: "procedure",
          title: "Procedure",
          body: "Follow the governed procedure.",
          steps: [
            {
              title: "Complete action",
              ownerRoleIds: ["owner"],
              instruction: "Complete the action.",
              expectedOutcome: "The action is complete.",
            },
          ],
        },
      ],
      relatedArticleIds: [],
      flowIds: ["flow"],
      liveRoutes: ["/"],
      owner: "Platform",
      reviewedAt: "2026-07-11",
    });

    expect(validateKnowledgeContent(content)).toContain(
      "article:Complete action requires screenshot evidence",
    );

    content.articles[0]!.sections[0]!.steps![0]!.evidenceId = "ev-start";
    expect(validateKnowledgeContent(content)).toEqual([]);
  });

  it("rejects unlabeled decision branches", () => {
    const content = valid();
    content.flows[0]!.edges[0]!.label = undefined;
    expect(validateKnowledgeContent(content)).toContain(
      "flow:start decision edge to yes requires a label",
    );
  });

  it("rejects a decision with fewer than two outcomes", () => {
    const content = valid();
    content.flows[0]!.edges.pop();
    expect(validateKnowledgeContent(content)).toContain(
      "flow flow:start decision requires at least two outcomes",
    );
  });

  it("rejects duplicate normalized decision labels", () => {
    const content = valid();
    content.flows[0]!.edges[0]!.label = " Proceed ";
    content.flows[0]!.edges[1]!.label = "proceed";
    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "flow flow:start decision requires at least two unique outcome labels",
        'flow flow:start decision has duplicate outcome label "proceed"',
      ]),
    );
  });

  it("rejects duplicate decision destinations without a merge contract", () => {
    const content = valid();
    content.flows[0]!.edges[1]!.to = "yes";
    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "flow flow:start decision requires at least two distinct destinations",
        "flow flow:start decision has duplicate destination yes without a merge contract",
      ]),
    );
  });

  it("accepts duplicate destinations declared by a justified merge contract", () => {
    const content = valid();
    const flow = content.flows[0]!;
    const decision = flow.nodes[0]! as KnowledgeDecisionNode;
    flow.nodes = [flow.nodes[0]!, flow.nodes[1]!];
    flow.edges[1]!.to = "yes";
    decision.mergeContract = {
      destinationNodeId: "yes",
      justification:
        "Both labels record distinct policy findings before the shared completion step.",
    };

    expect(validateKnowledgeContent(content)).toEqual([]);
  });

  it("reports every reachable node in a closed cycle that cannot reach a terminal", () => {
    const content = valid();
    content.flows[0] = {
      id: "cycle",
      title: "Closed cycle",
      summary: "A reachable cycle disconnected from its declared terminal.",
      roles: ["owner"],
      startNodeId: "cycle-start",
      nodes: [
        {
          id: "cycle-start",
          type: "decision",
          title: "Choose loop",
          ownerRoleIds: ["owner"],
          body: "Choose one of two loop entries.",
          authorityRoleId: "owner",
          policyBasis: "Cycle policy.",
        },
        {
          id: "cycle-a",
          type: "system",
          title: "Cycle A",
          ownerRoleIds: ["owner"],
          body: "Continue to cycle B.",
        },
        {
          id: "cycle-b",
          type: "system",
          title: "Cycle B",
          ownerRoleIds: ["owner"],
          body: "Continue to cycle A.",
        },
        {
          id: "cycle-terminal",
          type: "terminal",
          title: "Disconnected terminal",
          ownerRoleIds: ["owner"],
          body: "This terminal is not connected.",
          terminalOutcome: "complete",
        },
      ],
      edges: [
        {
          from: "cycle-start",
          to: "cycle-a",
          label: "Enter A",
          outcome: "neutral",
        },
        {
          from: "cycle-start",
          to: "cycle-b",
          label: "Enter B",
          outcome: "neutral",
        },
        { from: "cycle-a", to: "cycle-b" },
        { from: "cycle-b", to: "cycle-a" },
      ],
    };

    expect(
      validateKnowledgeContent(content, { enforceEvidence: false }).filter(
        (error) => error.includes("cannot reach a terminal outcome"),
      ),
    ).toEqual([
      "cycle:cycle-start cannot reach a terminal outcome",
      "cycle:cycle-a cannot reach a terminal outcome",
      "cycle:cycle-b cannot reach a terminal outcome",
    ]);
  });

  it("rejects unreachable nodes and non-terminal dead ends", () => {
    const content = valid();
    content.flows[0]!.edges = [];
    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "flow:start is a non-terminal dead end",
        "flow:yes is unreachable from start",
        "flow:no is unreachable from start",
      ]),
    );
  });

  it("rejects duplicate nodes and missing evidence", () => {
    const content = valid();
    content.flows[0]!.nodes.push({ ...content.flows[0]!.nodes[0]! });
    content.flows[0]!.nodes[0]!.evidenceId = "missing";
    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "flow has duplicate node id start",
        "flow:start references missing evidence missing",
      ]),
    );
  });

  it("rejects invalid and duplicate hotspots", () => {
    const content = valid();
    content.evidence[0]!.hotspots.push({
      ...content.evidence[0]!.hotspots[0]!,
      id: "outside",
      x: 1.2,
    });
    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "ev-start has duplicate hotspot number 1",
        "ev-start:outside hotspot coordinates must be between 0 and 1",
      ]),
    );
  });

  it("rejects invalid mobile hotspot coordinates", () => {
    const content = valid();
    content.evidence[0]!.hotspots[0]!.mobileY = 1.2;
    expect(validateKnowledgeContent(content)).toContain(
      "ev-start:open mobile hotspot coordinates must be between 0 and 1",
    );
  });
});
