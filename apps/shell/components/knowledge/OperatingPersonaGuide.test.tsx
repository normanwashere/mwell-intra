// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatingPersonaGuide } from "./OperatingPersonaGuide";
import { OPERATING_PERSONAS, OPERATING_PERSONA_GUIDES } from "../../lib/knowledge/operatingPersonas";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";

vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@intra/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Icon: () => null,
}));

const persona = OPERATING_PERSONAS.find(item => item.id === "operations_associate")!;
const guide = OPERATING_PERSONA_GUIDES.operations_associate!;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onOpenFeature = vi.fn();
const onBack = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<OperatingPersonaGuide
    persona={persona} guide={guide}
    linkedRoles={KNOWLEDGE_CONTENT.roles.filter(role => guide.roleIds.includes(role.id))}
    rolesById={new Map(KNOWLEDGE_CONTENT.roles.map(role => [role.id, role]))}
    relatedFlows={[]} relatedFeatures={[]}
    onBack={onBack} onOpenFlow={vi.fn()} onOpenFeature={onOpenFeature}
  />));
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it("hides only the redundant start callout on narrow screens and retains it from sm", () => {
  const title = [...host.querySelectorAll("header p")].find(element => element.textContent?.trim() === "Start here")!;
  const callout = title.parentElement!;
  expect(callout.classList.contains("hidden")).toBe(true);
  expect(callout.classList.contains("sm:block")).toBe(true);
  expect(host.querySelectorAll(".hidden")).toHaveLength(1);
  expect(host.querySelector("h1")?.textContent).toBe(persona.label);
  expect(host.querySelector("header")?.textContent).toContain(persona.responsibility);
  expect(host.querySelector("#persona-start-title")?.textContent).toBe("What do you need to do?");
});

it("retains every governed task destination, walkthrough handler and back action", async () => {
  expect(guide.tasks).toHaveLength(7);
  for (const task of guide.tasks) {
    const section = host.querySelector(`[aria-labelledby="persona-task-${task.id}"]`)!;
    expect(section.querySelector("a")?.getAttribute("href")).toBe(task.workspaceHref);
    const button = section.querySelector("button")!;
    expect(button.textContent).toBe("Show me how");
    await act(() => button.click());
    expect(onOpenFeature).toHaveBeenLastCalledWith(task.featureId);
  }
  expect(onOpenFeature).toHaveBeenCalledTimes(7);
  await act(() => host.querySelector<HTMLButtonElement>("article > button")!.click());
  expect(onBack).toHaveBeenCalledOnce();
});
