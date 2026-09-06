// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { KNOWLEDGE_CONTENT } from "@shell/lib/knowledge/content";
import { edgeChoiceId } from "@shell/lib/knowledge/graph";
import { FeatureGuide } from "./FeatureGuide";
import { StepWorkspace } from "./StepWorkspace";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@intra/auth", () => ({ useSession: () => ({ userRoles: [] }) }));
vi.mock("@intra/ui", () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, Icon: () => <span /> }));
vi.mock("./EvidenceViewer", () => ({ EvidenceViewer: () => <div data-testid="evidence">Evidence</div> }));
vi.mock("./GuideOutline", () => ({ GuideOutline: () => null }));
vi.mock("./GlossaryTerms", () => ({ GlossaryTerms: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
const container = document.createElement("div");
document.body.append(container);
afterEach(async () => { await React.act(() => root?.unmount()); });
const rolesById = new Map(KNOWLEDGE_CONTENT.roles.map((role) => [role.id, role]));
const feature = KNOWLEDGE_CONTENT.features.find((item) => item.availability === "live" && item.relatedFlowIds.length)!;
const flows = KNOWLEDGE_CONTENT.flows.filter((flow) => feature.relatedFlowIds.includes(flow.id));

it("orders prerequisite, real flow, controls, evidence and recovery without inventing a screenshot", async () => {
  root = createRoot(container);
  const open = vi.fn();
  await React.act(() => root.render(<FeatureGuide feature={feature} rolesById={rolesById} relatedArticles={[]} relatedFlows={flows} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={open} />));
  const ids = [...container.querySelectorAll("section[id]")].map((node) => node.id);
  expect(ids.slice(0, 5)).toEqual(["feature-entry", "feature-flow", "feature-controls", "feature-screen-guide", "feature-outcomes"]);
  expect(container.querySelector("#feature-screen-guide")?.textContent).toContain("Unverified");
  expect(container.querySelector("#feature-flow")?.textContent).toContain(flows[0]!.nodes[0]!.title);
  await React.act(() => (container.querySelector("#feature-flow button") as HTMLButtonElement).click());
  expect(open).toHaveBeenCalledWith(flows[0]!.id);
});

it("keeps coming-soon guidance non-executable", async () => {
  root = createRoot(container);
  await React.act(() => root.render(<FeatureGuide feature={{ ...feature, availability: "coming_soon" }} rolesById={rolesById} relatedArticles={[]} relatedFlows={flows} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={vi.fn()} />));
  expect(container.querySelector("#feature-entry a")).toBeNull();
  expect(container.querySelector("#feature-flow button")).toBeNull();
});

it("keeps branch callback identity and presents prerequisites before step evidence", async () => {
  const flow = KNOWLEDGE_CONTENT.flows.find((item) => item.nodes.some((node) => node.type === "decision"))!;
  const node = { ...flow.nodes.find((item) => item.type === "decision")!, prerequisite: "Exact prerequisite" };
  const choose = vi.fn();
  root = createRoot(container);
  await React.act(() => root.render(<StepWorkspace flow={flow} node={node} rolesById={rolesById} onSelectNode={vi.fn()} onChooseBranch={choose} />));
  expect(container.textContent!.indexOf("Exact prerequisite")).toBeLessThan(container.textContent!.indexOf("Evidence"));
  const button = container.querySelector("button")!;
  await React.act(() => button.click());
  expect(choose).toHaveBeenCalledExactlyOnceWith(edgeChoiceId(flow, flow.edges.find((edge) => edge.from === node.id)!));
});
