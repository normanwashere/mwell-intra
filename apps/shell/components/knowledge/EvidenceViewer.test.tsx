// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeEvidence, KnowledgeFlowNode } from "@shell/lib/knowledge/types";
import { EvidenceViewer } from "./EvidenceViewer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@intra/ui", () => ({
  Icon: ({ name }: { name: string }) => <span aria-hidden>{name}</span>,
}));

const node: KnowledgeFlowNode = {
  id: "setup-bin",
  type: "action",
  title: "Create scannable bins",
  ownerRoleIds: ["warehouse_admin"],
  body: "Create the bin.",
};

const evidence: KnowledgeEvidence = {
  id: "ev-setup-bin",
  nodeId: node.id,
  desktopSrc: "/desktop.png",
  mobileSrc: "/mobile.png",
  route: "/warehouse/storage",
  roleId: "warehouse_admin",
  state: "Add storage area is open.",
  capturedAt: "2026-07-13",
  reviewedAt: "2026-07-13",
  appCommit: "edb3609d20eea7eb27a59f1a6d8dfcf9163048b9",
  provenance: "documentation",
  environment: "demo",
  alt: "Add bin screen",
  expectedLandmark: "Bin code",
  sensitiveDataReviewed: true,
  hotspots: [
    { id: "primary", number: 1, x: 0.3, y: 0.4, mobileX: 0.3, mobileY: 0.4, label: "Bin code", instruction: "Enter code." },
    { id: "step-2", number: 2, x: 0.7, y: 0.8, mobileX: 0.7, mobileY: 0.8, label: "Add bin", instruction: "Submit once." },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("EvidenceViewer", () => {
  it("shows ordered markers and opens an unobstructed full-screen mobile view", async () => {
    await act(() => root.render(<EvidenceViewer evidence={evidence} node={node} />));
    expect(container.querySelectorAll('[aria-label^="1."]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label^="2."]')).toHaveLength(1);
    const open = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("View image full screen"),
    );
    expect(open).toBeTruthy();
    await act(() => open!.click());
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Demo example");
  });

  it("identifies evidence captured from an earlier deployed build", async () => {
    const previous = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA =
      "5637ac6d8b4d6d328d270ac66f827a5377e092a0";
    try {
      await act(() =>
        root.render(<EvidenceViewer evidence={evidence} node={node} />),
      );
      expect(container.textContent).toContain("Reference from an earlier build");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
      } else {
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = previous;
      }
    }
  });
});
