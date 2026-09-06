// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KnowledgeEvidence,
  KnowledgeFlowNode,
} from "@shell/lib/knowledge/types";
import { EvidenceViewer } from "./EvidenceViewer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    {
      id: "primary",
      number: 1,
      x: 0.3,
      y: 0.4,
      mobileX: 0.3,
      mobileY: 0.4,
      label: "Bin code",
      instruction: "Enter code.",
    },
    {
      id: "step-2",
      number: 2,
      x: 0.7,
      y: 0.8,
      mobileX: 0.7,
      mobileY: 0.8,
      label: "Add bin",
      instruction: "Submit once.",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
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
  it("keeps named zoom and hotspot controls at least 44px without desktop shrink overrides", async () => {
    await act(() => root.render(<EvidenceViewer evidence={evidence} node={node} />));
    const assertTarget = (button: HTMLButtonElement) => {
      expect(button.getAttribute("aria-label")).toMatch(/[a-z]/i);
      expect(button.type).toBe("button");
      expect(button.classList.contains("min-h-11")).toBe(true);
      expect(button.classList.contains("min-w-11")).toBe(true);
      expect(button.classList.contains("h-11")).toBe(true);
      expect(button.classList.contains("w-11")).toBe(true);
      expect(button.className).not.toMatch(/(?:^|\s)(?:\w+:)*(?:h|w)-(?:8|9|10)(?:\s|$)/);
    };
    const inline = [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
    expect(inline.map(button => button.getAttribute("aria-label"))).toEqual([
      "Zoom out", "Reset zoom", "Zoom in", "1. Bin code", "2. Add bin",
    ]);
    inline.forEach(assertTarget);
    const open = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("View image full screen"))!;
    await act(() => open.click());
    const expanded = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(expanded.map(button => button.getAttribute("aria-label"))).toEqual([
      "Close full-screen evidence", "1. Bin code in full-screen evidence", "2. Add bin in full-screen evidence",
    ]);
    expanded.forEach(assertTarget);
  });

  it("preserves zoom limits, reset, and named hotspot selection", async () => {
    await act(() => root.render(<EvidenceViewer evidence={evidence} node={node} />));
    const get = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(get("Zoom out").disabled).toBe(true);
    for (let index = 0; index < 4; index += 1) await act(() => get("Zoom in").click());
    expect(get("Zoom in").disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Zoom 200 percent");
    await act(() => get("Reset zoom").click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Zoom 100 percent");
    await act(() => get("2. Add bin").click());
    expect(get("2. Add bin").getAttribute("aria-pressed")).toBe("true");
    expect(get("1. Bin code").getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Submit once.");
  });

  it("shows ordered markers and opens an unobstructed full-screen mobile view", async () => {
    await act(() =>
      root.render(<EvidenceViewer evidence={evidence} node={node} />),
    );
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
      expect(container.textContent).toContain(
        "Reference from an earlier build",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
      } else {
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = previous;
      }
    }
  });

  it("labels role walkthrough captures as UAT evidence", async () => {
    await act(() =>
      root.render(
        <EvidenceViewer
          evidence={{ ...evidence, environment: "uat" }}
          node={node}
        />,
      ),
    );
    expect(container.textContent).toContain("UAT evidence");
  });

  it("traps focus, closes with Escape, and returns focus to the opener", async () => {
    await act(() =>
      root.render(<EvidenceViewer evidence={evidence} node={node} />),
    );
    const open = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("View image full screen"),
    )!;
    open.focus();
    await act(() => open.click());
    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close full-screen evidence"]',
    );
    expect(document.activeElement).toBe(close);
    await act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});
