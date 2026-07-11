import { describe, expect, it } from "vitest";
import { layoutFlow, outgoingEdges } from "./graph";
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
    },
    {
      id: "yes",
      type: "terminal",
      title: "Yes",
      ownerRoleIds: ["owner"],
      body: "Yes",
    },
    {
      id: "no",
      type: "terminal",
      title: "No",
      ownerRoleIds: ["owner"],
      body: "No",
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
