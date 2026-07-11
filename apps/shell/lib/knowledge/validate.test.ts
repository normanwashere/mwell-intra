import { describe, expect, it } from "vitest";
import type { KnowledgeContent } from "./types";
import { validateKnowledgeContent } from "./validate";

const valid = (): KnowledgeContent => ({
  roles: [{ id: "owner", label: "Owner", module: "core", purpose: "Acts" }],
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
        },
        {
          id: "yes",
          type: "terminal",
          title: "Done",
          ownerRoleIds: ["owner"],
          body: "Complete",
        },
        {
          id: "no",
          type: "terminal",
          title: "Stopped",
          ownerRoleIds: ["owner"],
          body: "Stopped",
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
  it("accepts an explicit governed branch", () => {
    expect(validateKnowledgeContent(valid())).toEqual([]);
  });

  it("rejects unlabeled decision branches", () => {
    const content = valid();
    content.flows[0]!.edges[0]!.label = undefined;
    expect(validateKnowledgeContent(content)).toContain(
      "flow:start decision edge to yes requires a label",
    );
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
});
