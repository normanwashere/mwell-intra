// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KnowledgeEvidence,
  KnowledgeFlow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { GuidedDecisionPath } from "./GuidedDecisionPath";
import { WorkflowNavigator } from "./WorkflowNavigator";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@intra/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Icon: ({ name }: { name: string }) => <span aria-hidden>{name}</span>,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@intra/auth", () => ({
  useSession: () => ({ userRoles: { procurement: ["approver"] } }),
}));

const flow: KnowledgeFlow = {
  id: "guided",
  title: "Guided approval",
  summary: "Choose a route",
  roles: ["approver"],
  startNodeId: "choose",
  nodes: [
    {
      id: "choose",
      type: "decision",
      title: "Choose route",
      ownerRoleIds: ["approver"],
      body: "Select the documented route.",
      authorityRoleId: "approver",
      policyBasis: "Approval policy.",
    },
    {
      id: "complete",
      type: "terminal",
      title: "Approval complete",
      ownerRoleIds: ["approver"],
      body: "The request is complete.",
      outcome: "The approval record is ready for audit.",
      evidenceId: "approval-record",
      terminalOutcome: "complete",
    },
    {
      id: "rejected",
      type: "terminal",
      title: "Request rejected",
      ownerRoleIds: ["approver"],
      body: "The request is rejected.",
      terminalOutcome: "rejected",
    },
  ],
  edges: [
    { from: "choose", to: "complete", label: "Approve", outcome: "success" },
    { from: "choose", to: "rejected", label: "Reject", outcome: "exception" },
  ],
};

const role: KnowledgeRole = {
  id: "approver",
  label: "Approver",
  module: "procurement",
  availability: "live",
  purpose: "Approve requests.",
  dailyTasks: [],
  responsibilityStages: [],
  authority: {
    capabilities: [],
    accessibleRoutes: [],
    canDo: [],
    cannotDo: [],
    decisions: [],
    upstreamRoleIds: [],
    downstreamRoleIds: [],
    escalation: "Escalate.",
  },
};

const evidence: KnowledgeEvidence[] = [
  {
    id: "approval-record",
    nodeId: "complete",
    desktopSrc: "/approval.png",
    mobileSrc: "/approval-mobile.png",
    route: "/approvals/1",
    roleId: "approver",
    state: "The approver is reviewing the completed approval.",
    capturedAt: "2026-01-01",
    reviewedAt: "2026-01-01",
    appCommit: "11e1fec866c6537ed340111550b9a1ce341a0a58",
    provenance: "documentation",
    alt: "Approval record",
    expectedLandmark: "Approval complete",
    sensitiveDataReviewed: true,
    hotspots: [],
  },
];

const sameDestinationFlow: KnowledgeFlow = {
  ...flow,
  id: "same-destination-guided",
  nodes: flow.nodes.filter((node) => node.id !== "rejected"),
  edges: [
    {
      id: "manual-approval",
      from: "choose",
      to: "complete",
      label: "Manual approval",
    },
    {
      id: "delegated-approval",
      from: "choose",
      to: "complete",
      label: "Delegated approval",
    },
  ],
};

function GuidedHarness() {
  const [choices, setChoices] = React.useState<string[]>([]);
  return (
    <GuidedDecisionPath
      flow={flow}
      choices={choices}
      evidence={evidence}
      rolesById={new Map([[role.id, role]])}
      onChoose={(destination) =>
        setChoices((current) => [...current, destination])
      }
      onBacktrack={() => setChoices((current) => current.slice(0, -1))}
    />
  );
}

function SameDestinationHarness() {
  const [choices, setChoices] = React.useState<string[]>([]);
  return (
    <GuidedDecisionPath
      flow={sameDestinationFlow}
      choices={choices}
      evidence={evidence}
      rolesById={new Map([[role.id, role]])}
      onChoose={(choiceId) => setChoices((current) => [...current, choiceId])}
      onBacktrack={() => setChoices((current) => current.slice(0, -1))}
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: React.ReactNode) {
  act(() => root.render(element));
}

function button(name: string) {
  const match = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(name),
  );
  if (!match) throw new Error(`Missing button: ${name}`);
  return match;
}

function heading(name: string) {
  const match = [...container.querySelectorAll("h1, h2, h3")].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!match) throw new Error(`Missing heading: ${name}`);
  return match;
}

describe("synchronized workflow controls", () => {
  it("activates adjacent tabs with arrow keys and moves focus", async () => {
    const onSelectView = vi.fn();
    render(<WorkflowNavigator activeView="flow" onSelectView={onSelectView} />);

    const flowTab = button("Flow");
    flowTab.focus();
    await act(() =>
      flowTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );

    expect(onSelectView).toHaveBeenCalledWith("steps");
    expect(document.activeElement).toBe(button("Step-by-step"));
  });

  it("advances a branch, announces terminal evidence, and restores the decision", async () => {
    render(<GuidedHarness />);

    await act(() => button("Approve").click());
    expect(document.activeElement).toBe(heading("Approval complete"));
    expect(container.textContent).toContain("Completed: complete");
    expect(container.textContent).toContain("Approval record");

    await act(() => button("Backtrack").click());
    expect(document.activeElement).toBe(heading("Choose route"));
    expect(button("Approve")).toBeTruthy();
  });

  it("keeps same-destination choices distinct in history and backtracking", async () => {
    render(<SameDestinationHarness />);

    await act(() => button("Delegated approval").click());
    expect(document.activeElement).toBe(heading("Approval complete"));
    expect(container.textContent).toContain("Via Delegated approval");
    expect(container.textContent).not.toContain("Via Manual approval");

    await act(() => button("Backtrack").click());
    expect(document.activeElement).toBe(heading("Choose route"));
    expect(button("Manual approval")).toBeTruthy();
    expect(button("Delegated approval")).toBeTruthy();
  });
});
