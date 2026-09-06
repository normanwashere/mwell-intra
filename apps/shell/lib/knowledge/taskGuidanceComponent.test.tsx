// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_CONTENT } from "./content";
import { KnowledgeRoleGuide } from "@shell/components/knowledge/KnowledgeRoleGuide";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@intra/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Icon: () => <span aria-hidden="true" />,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await React.act(() => root?.unmount());
});

async function render(
  roleId: string,
  overrides: Partial<React.ComponentProps<typeof KnowledgeRoleGuide>> = {},
) {
  const role = KNOWLEDGE_CONTENT.roles.find((item) => item.id === roleId)!;
  const onOpenArticle = vi.fn();
  const onOpenFlow = vi.fn();
  root = createRoot(container);
  await React.act(() =>
    root.render(
      <KnowledgeRoleGuide
        role={role}
        rolesById={
          new Map(KNOWLEDGE_CONTENT.roles.map((item) => [item.id, item]))
        }
        relatedFeatures={KNOWLEDGE_CONTENT.features.filter((item) =>
          item.roleIds.includes(role.id),
        )}
        relatedFlows={KNOWLEDGE_CONTENT.flows.filter((item) =>
          item.roles.includes(role.id),
        )}
        relatedArticles={[]}
        onBack={vi.fn()}
        onOpenArticle={onOpenArticle}
        onOpenFlow={onOpenFlow}
        {...overrides}
      />,
    ),
  );
  return {
    role,
    onOpenArticle,
    onOpenFlow,
    tasks: container.querySelector("#role-tasks")!,
  };
}

describe("role task controls", () => {
  it("opens the explicitly mapped vendor feature article", async () => {
    const { tasks, onOpenArticle, onOpenFlow } = await render("vendor_portal");
    await React.act(() =>
      (tasks.querySelectorAll("button")[2] as HTMLButtonElement).click(),
    );
    expect(onOpenArticle).toHaveBeenCalledExactlyOnceWith(
      "feature-vendor-purchase-orders",
    );
    expect(onOpenFlow).not.toHaveBeenCalled();
  });

  it("opens the task-specific Product flow, not the first related flow", async () => {
    const { tasks, onOpenArticle, onOpenFlow } = await render("product_owner");
    await React.act(() =>
      (tasks.querySelectorAll("button")[1] as HTMLButtonElement).click(),
    );
    expect(onOpenFlow).toHaveBeenCalledExactlyOnceWith("pricing-and-costing");
    expect(onOpenArticle).not.toHaveBeenCalled();
  });

  it("renders written responsibilities as text, without disabled controls", async () => {
    const { tasks } = await render("events_viewer");
    expect(tasks.querySelectorAll("li")).toHaveLength(2);
    expect(tasks.querySelectorAll("button")).toHaveLength(1);
    expect(tasks.textContent).toContain(
      "Send the event reference and question",
    );
    expect(tasks.querySelector("[disabled]")).toBeNull();
  });

  it("keeps every task readable when destinations are absent", async () => {
    const { role, tasks } = await render("vendor_portal", {
      relatedFeatures: [],
      relatedFlows: [],
    });
    for (const task of role.dailyTasks)
      expect(tasks.textContent).toContain(task);
    expect(tasks.querySelector("button, a, [disabled]")).toBeNull();
  });

  it("does not truncate tasks or launch a roadmap role", async () => {
    const role = KNOWLEDGE_CONTENT.roles.find(
      (item) => item.id === "product_owner",
    )!;
    const { tasks } = await render(role.id, {
      role: {
        ...role,
        availability: "coming_soon",
        dailyTasks: [...role.dailyTasks, "Third", "Fourth", "Fifth", "Sixth"],
      },
    });
    expect(tasks.querySelectorAll("li")).toHaveLength(6);
    expect(tasks.querySelector("button, a, [disabled]")).toBeNull();
    expect(tasks.textContent).toContain("Planned responsibility only");
  });
});
