// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LearningContext, type LearningContextValue } from "@intra/learning";
import type { LearningSnapshot } from "@intra/learning";
import type { TaskDefinition } from "../../lib/knowledge/taskCatalog";
import { TaskStart } from "./TaskStart";

vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const task: TaskDefinition = {
  id: "receive",
  title: "Receive delivery",
  outcome: "Inspect received units",
  actionHref: "/warehouse/inbound",
  guideHref: "/knowledge?article=receive",
  audience: "internal",
  actionCapabilities: [{ module: "warehouse", capability: "receive_stock" }],
  priority: 10,
  roleIds: ["warehouse_operator"],
  module: "warehouse",
  moduleLabel: "Warehouse",
  aliases: [],
  personaIds: [],
  featureId: "receiving",
  availability: "live",
};
const snapshot: LearningSnapshot = {
  curricula: [
    {
      source: "role",
      curriculum: {
        id: "receiving",
        version: 1,
        personaId: "operations_associate",
        audience: "internal",
        requirementIds: ["receive"],
      },
      requirements: [
        {
          id: "receive",
          version: 1,
          audience: "internal",
          kind: "scenario",
          title: "Receive safely",
          mandatory: true,
          prerequisiteIds: [],
          capabilityOutcomes: task.actionCapabilities,
        },
      ],
    },
  ],
  progress: [
    {
      assignmentRequirementId: "ar-1",
      requirementId: "receive",
      requirementVersion: 1,
      state: "passed",
      attemptCount: 1,
      allowsSharedCompletion: false,
      updatedAt: "2026-09-20T00:00:00Z",
    },
  ],
  certifications: [],
  lockedCapabilities: [],
  refreshedAt: "2026-09-20T00:00:00Z",
};
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(state: Partial<LearningContextValue> = {}) {
  await React.act(() =>
    root.render(
      <LearningContext.Provider
        value={
          {
            snapshot,
            loading: false,
            stale: false,
            error: null,
            ...state,
          } as LearningContextValue
        }
      >
        <TaskStart tasks={[task]} />
      </LearningContext.Provider>,
    ),
  );
}
it("opens the operational destination when current task learning is complete", async () => {
  await render();
  const open = [...host.querySelectorAll("a")].find((link) =>
    link.textContent?.includes("Open task"),
  );
  expect(open?.getAttribute("href")).toBe("/warehouse/inbound");
  expect(host.textContent).not.toContain("Prepare for task");
});
it("sends incomplete work to its exact learning task and preserves the operational return", async () => {
  await render({
    snapshot: {
      ...snapshot,
      progress: snapshot.progress.map((item) => ({
        ...item,
        state: "not_started",
      })),
    },
  });
  const prepare = [...host.querySelectorAll("a")].find((link) =>
    link.textContent?.includes("Prepare for task"),
  )!;
  expect(prepare.getAttribute("href")).toBe(
    "/onboarding?task=receive&next=%2Fwarehouse%2Finbound",
  );
  expect(host.querySelector('a[href="/warehouse/inbound"]')).toBeNull();
});
it.each([
  { stale: true },
  { loading: true },
  { error: "Unavailable" },
  { snapshot: null },
])("does not advertise ready work with unknown learning %j", async (state) => {
  await render(state);
  expect(host.textContent).toContain("Check task readiness");
  expect(host.querySelector('a[href="/warehouse/inbound"]')).toBeNull();
});
