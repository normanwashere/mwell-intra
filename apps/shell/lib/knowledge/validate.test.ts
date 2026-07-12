import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import type { KnowledgeContent, KnowledgeDecisionNode, KnowledgeTerminalNode } from "./types";
import { KNOWLEDGE_CONTENT } from "./content";
import { validateKnowledgeContent, validateKnowledgeEvidenceArtifacts, validateKnowledgeBase } from "./validate";

const APP_COMMIT = "11e1fec866c6537ed340111550b9a1ce341a0a58";

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const valid = (): KnowledgeContent => ({
  roles: [
    {
      id: "owner",
      label: "Owner",
      module: "core",
      availability: "live",
      purpose: "Acts",
      dailyTasks: ["Manage the governed flow."],
      responsibilityStages: [
        {
          title: "Manage",
          responsibility: "Review and decide the flow.",
          outcome: "The flow reaches a governed outcome.",
        },
      ],
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
      policyBasis: ["Flow policy."],
      relatedFlowIds: ["flow"],
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
      mobileSrc: "/knowledge/screenshots/start-mobile.png",
      route: "/",
      roleId: "owner",
      state: "Authenticated owner can open the governed record.",
      capturedAt: "2026-07-11",
      reviewedAt: "2026-07-11",
      appCommit: APP_COMMIT,
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
          mobileX: 0.5,
          mobileY: 0.5,
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
  it("rejects missing role operating data and invalid feature relationships", () => {
    const content = valid();
    content.roles[0]!.dailyTasks = [];
    content.roles[0]!.responsibilityStages = [];
    content.features[0]!.policyBasis = [];
    content.features[0]!.relatedFlowIds = ["missing-flow"];

    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        `role ${content.roles[0]!.id} has no daily tasks`,
        `role ${content.roles[0]!.id} has no responsibility stages`,
        `feature ${content.features[0]!.id} has no policy basis`,
        `feature ${content.features[0]!.id} references unknown flow missing-flow`,
      ]),
    );
  });
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

  it("keeps principal-flow evidence and decision governance strict", () => {
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
      availability: "live",
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
        "flow flow:start has no authority",
        "flow flow:start has no policy basis",
        "flow flow:yes has invalid terminal outcome",
      ]),
    );
  });

  it("does not bypass evidence route ownership for public routes", () => {
    const content = valid();
    content.roles[0]!.authority.accessibleRoutes = ["/owned"];
    content.evidence[0]!.route = "/login";

    expect(validateKnowledgeContent(content)).toContain("ev-start route /login is not accessible to role owner");
  });

  it("makes the aggregate validator enforce the complete content contract", () => {
    const content = valid();
    Object.assign(content.flows[0]!.nodes[0]!, {
      type: "action",
      evidenceId: undefined,
    });

    expect(validateKnowledgeBase(content)).toContain("flow flow:start requires screenshot evidence");
  });

  it("does not treat generated article control descriptions as executable flow steps", () => {
    const content = valid();
    content.articles.push({
      id: "article",
      slug: "procedures/article",
      title: "Article",
      summary: "Summary",
      module: "core",
      availability: "live",
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

    expect(validateKnowledgeContent(content)).toEqual([]);
  });

  it("rejects unlabeled decision branches", () => {
    const content = valid();
    content.flows[0]!.edges[0]!.label = undefined;
    expect(validateKnowledgeContent(content)).toContain("flow:start decision edge to yes requires a label");
  });

  it("rejects a decision with fewer than two outcomes", () => {
    const content = valid();
    content.flows[0]!.edges.pop();
    expect(validateKnowledgeContent(content)).toContain("flow flow:start decision requires at least two outcomes");
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
      justification: "Both labels record distinct policy findings before the shared completion step.",
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
      validateKnowledgeContent(content).filter((error) => error.includes("cannot reach a terminal outcome")),
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
      expect.arrayContaining(["flow has duplicate node id start", "flow:start references missing evidence missing"]),
    );
  });

  it("rejects duplicate stable edge choice ids", () => {
    const content = valid();
    content.flows[0]!.edges[0]!.id = "same-choice";
    content.flows[0]!.edges[1]!.id = "same-choice";

    expect(validateKnowledgeContent(content)).toContain("flow has duplicate edge choice id flow~same-choice");
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

  it("requires a reviewed mobile pair, capture state, and valid app commit provenance", () => {
    const content = valid();
    const evidence = content.evidence[0]! as (typeof content.evidence)[number] & {
      appCommit?: string;
      state?: string;
    };
    delete (evidence as { mobileSrc?: string }).mobileSrc;
    evidence.capturedAt = "2026/07/13";
    evidence.reviewedAt = "";
    evidence.appCommit = "working-tree";
    evidence.state = "";
    evidence.sensitiveDataReviewed = false;

    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "ev-start requires a mobile screenshot",
        "ev-start has invalid evidence date",
        "ev-start has invalid app commit provenance",
        "ev-start has no deterministic capture state",
        "ev-start has not completed sensitive-data review",
      ]),
    );
  });

  it("requires evidence role and route to match its executable flow node", () => {
    const content = valid();
    content.roles.push({
      ...content.roles[0]!,
      id: "other",
      authority: {
        ...content.roles[0]!.authority,
        accessibleRoutes: ["/other"],
      },
    });
    content.evidence[0]!.roleId = "other";
    content.evidence[0]!.route = "/unowned";

    expect(validateKnowledgeContent(content)).toEqual(
      expect.arrayContaining([
        "ev-start role other does not own flow:start",
        "ev-start route /unowned is not accessible to role other",
      ]),
    );
  });

  it("accepts versioned capture report metadata for every evidence id", () => {
    const errors = validateKnowledgeEvidenceArtifacts(KNOWLEDGE_CONTENT, {
      publicRoot: path.resolve(process.cwd(), "public"),
      repositoryRoot: path.resolve(process.cwd(), "../.."),
      reportPath: path.resolve(process.cwd(), "../../.superpowers/sdd/task-8-report.json"),
    } as Parameters<typeof validateKnowledgeEvidenceArtifacts>[1]);

    expect(errors).toEqual([]);
  });

  it("rejects report hash, dimensions, provenance, and semantic mismatches", () => {
    const root = mkdtempSync(path.join(tmpdir(), "knowledge-evidence-"));
    try {
      const publicRoot = path.join(root, "public");
      const screenshotRoot = path.join(publicRoot, "knowledge", "screenshots");
      const desktop = path.join(screenshotRoot, "start.png");
      const mobile = path.join(screenshotRoot, "start-mobile.png");
      const sourceRoot = path.resolve(process.cwd(), "public/knowledge/screenshots");
      mkdirSync(screenshotRoot, { recursive: true });
      copyFileSync(path.join(sourceRoot, "task8-access-start-desktop.png"), desktop);
      copyFileSync(path.join(sourceRoot, "task8-access-start-mobile.png"), mobile);
      const reportPath = path.join(root, "report.json");
      writeFileSync(
        reportPath,
        JSON.stringify({
          schemaVersion: 1,
          sourceCommit: "0000000000000000000000000000000000000000",
          capturedAt: "2026-07-11",
          reviewedAt: "2026-07-11",
          evidenceCount: 1,
          evidence: {
            "ev-start": {
              route: "/wrong",
              roleId: "wrong",
              state: "wrong",
              control: { id: "wrong", label: "wrong", instruction: "wrong" },
              desktop: {
                file: "/knowledge/screenshots/start.png",
                sha256: "0".repeat(64),
                width: 1,
                height: 1,
                controlBounds: { x: 1, y: 1, width: 1, height: 1 },
                hotspot: { x: 0.1, y: 0.1 },
              },
              mobile: {
                file: "/knowledge/screenshots/start-mobile.png",
                sha256: sha256(mobile),
                width: 390,
                height: 844,
                controlBounds: { x: 0, y: 0, width: 10, height: 10 },
                hotspot: { x: 0.5, y: 0.5 },
              },
            },
          },
        }),
      );

      const errors = validateKnowledgeEvidenceArtifacts(valid(), {
        publicRoot,
        repositoryRoot: path.resolve(process.cwd(), "../.."),
        reportPath,
      } as Parameters<typeof validateKnowledgeEvidenceArtifacts>[1]);
      expect(errors).toEqual(
        expect.arrayContaining([
          "capture report sourceCommit does not match evidence source commit",
          "ev-start capture report route mismatch",
          "ev-start capture report role mismatch",
          "ev-start capture report state mismatch",
          "ev-start capture report control mismatch",
          "ev-start desktop SHA-256 mismatch",
          "ev-start desktop dimensions mismatch",
          "ev-start desktop hotspot mismatch",
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate image bytes without an explicit semantically identical sharing group", () => {
    const root = mkdtempSync(path.join(tmpdir(), "knowledge-duplicates-"));
    try {
      const publicRoot = path.join(root, "public");
      const screenshotRoot = path.join(publicRoot, "knowledge", "screenshots");
      const sourceRoot = path.resolve(process.cwd(), "public/knowledge/screenshots");
      mkdirSync(screenshotRoot, { recursive: true });
      for (const name of ["start.png", "copy.png"])
        copyFileSync(path.join(sourceRoot, "task8-access-start-desktop.png"), path.join(screenshotRoot, name));
      for (const name of ["start-mobile.png", "copy-mobile.png"])
        copyFileSync(path.join(sourceRoot, "task8-access-start-mobile.png"), path.join(screenshotRoot, name));
      const content = valid();
      content.evidence.push({
        ...content.evidence[0]!,
        id: "ev-copy",
        desktopSrc: "/knowledge/screenshots/copy.png",
        mobileSrc: "/knowledge/screenshots/copy-mobile.png",
      });
      const artifact = (file: string, width: number, height: number) => ({
        file: `/knowledge/screenshots/${path.basename(file)}`,
        sha256: sha256(path.join(screenshotRoot, path.basename(file))),
        width,
        height,
        controlBounds: {
          x: (width - 100) / 2,
          y: (height - 40) / 2,
          width: 100,
          height: 40,
        },
        hotspot: { x: 0.5, y: 0.5 },
      });
      const entry = (desktopFile: string, mobileFile: string) => ({
        route: "/",
        roleId: "owner",
        state: content.evidence[0]!.state,
        control: {
          id: "open",
          label: "Open",
          instruction: "Open the record.",
        },
        desktop: artifact(desktopFile, 1440, 900),
        mobile: artifact(mobileFile, 390, 844),
      });
      const reportPath = path.join(root, "report.json");
      writeFileSync(
        reportPath,
        JSON.stringify({
          schemaVersion: 1,
          sourceCommit: APP_COMMIT,
          capturedAt: "2026-07-11",
          reviewedAt: "2026-07-11",
          evidenceCount: 2,
          evidence: {
            "ev-start": entry("start.png", "start-mobile.png"),
            "ev-copy": entry("copy.png", "copy-mobile.png"),
          },
        }),
      );
      const options = {
        publicRoot,
        repositoryRoot: path.resolve(process.cwd(), "../.."),
        reportPath,
      } as Parameters<typeof validateKnowledgeEvidenceArtifacts>[1];

      expect(validateKnowledgeEvidenceArtifacts(content, options)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("duplicate desktop bytes"),
          expect.stringContaining("duplicate mobile bytes"),
        ]),
      );

      content.evidence[0]!.sharedEvidenceGroup = "same-control";
      content.evidence[1]!.sharedEvidenceGroup = "same-control";
      expect(validateKnowledgeEvidenceArtifacts(content, options)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
