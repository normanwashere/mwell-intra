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

it.each([
  ["warehouse-dashboard", "/warehouse", "permission to view the Warehouse dashboard", "Analytics and finance viewing permissions are not additional requirements"],
  ["warehouse-data", "/warehouse/data", "permission to view Warehouse analytics", "Export permission alone does not open this page"],
  ["warehouse-reports", "/warehouse/reports", "permission to view either Warehouse analytics or Warehouse finance", "together with access to Warehouse reporting in Insights"],
])("separates page entry from export permission in %s without changing its destination", async (id, route, entry, boundary) => {
  const exportFeature = KNOWLEDGE_CONTENT.features.find(item => item.id === id)!;
  const original = JSON.stringify(exportFeature);
  root = createRoot(container);
  await React.act(() => root.render(<FeatureGuide feature={exportFeature} rolesById={rolesById} relatedArticles={[]} relatedFlows={[]} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={vi.fn()} />));
  const section = container.querySelector("#feature-entry")!;
  expect(section.textContent).toContain(entry);
  expect(section.textContent).toContain(boundary);
  expect(section.textContent).toContain("Preparing an export is a separate permission");
  expect(section.textContent).toContain("currently be allowed to prepare Warehouse or Insights exports");
  expect(section.textContent).toContain("Viewing reports or reviewing exports alone is not enough");
  expect(section.textContent).toContain("Required training and access to the source records still apply");
  expect(section.textContent).not.toMatch(/Required capabilities:|userCapabilities|register_exports|prepare_exports/);
  expect(section.querySelector("a")?.getAttribute("href")).toBe(route);
  expect(JSON.stringify(exportFeature)).toBe(original);
  expect(container.querySelector("#feature-screen-guide")?.textContent).toContain("Unverified");
});

it("retains the existing prerequisite rendering for other feature guides", async () => {
  const other = KNOWLEDGE_CONTENT.features.find(item => item.id === "warehouse-inventory")!;
  root = createRoot(container);
  await React.act(() => root.render(<FeatureGuide feature={other} rolesById={rolesById} relatedArticles={[]} relatedFlows={[]} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={vi.fn()} />));
  expect(container.querySelector("#feature-entry")?.textContent).toContain("Required capabilities:");
  expect(container.querySelector("#feature-entry")?.textContent).not.toContain("Preparing an export is a separate permission");
});

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

it("puts the prerequisite jump before long collapsed metadata without dropping content", async () => {
  root = createRoot(container);
  const longFeature = { ...feature, purpose: "Long overview. ".repeat(80) };
  await React.act(() => root.render(<FeatureGuide feature={longFeature} rolesById={rolesById} relatedArticles={[]} relatedFlows={flows} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={vi.fn()} />));
  const header = container.querySelector("header")!;
  const jump = header.querySelector<HTMLAnchorElement>('a[href="#feature-entry"]')!;
  const metadata = header.querySelector("details")!;
  expect(jump.textContent).toContain("Before you start");
  expect(jump.classList.contains("dark:text-brand-300")).toBe(true);
  expect(jump.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metadata.open).toBe(false);
  expect(metadata.textContent).toContain(longFeature.purpose);
  expect(metadata.textContent).toContain(feature.owner);
  expect(metadata.textContent).toContain(feature.reviewedAt);
  expect(metadata.textContent).toContain(rolesById.get(feature.roleIds[0]!)!.label);
  const policy = container.querySelector<HTMLDetailsElement>("#feature-policy details")!;
  expect(policy.open).toBe(false);
  for (const value of feature.policyBasis) expect(policy.textContent).toContain(value);
  await React.act(() => { metadata.open = true; metadata.dispatchEvent(new Event("toggle")); });
  expect(metadata.open).toBe(true);
});

it("returns from reference view to a focused prerequisite target without executing a workflow", async () => {
  root = createRoot(container);
  const open = vi.fn();
  await React.act(() => root.render(<FeatureGuide feature={feature} rolesById={rolesById} relatedArticles={[]} relatedFlows={flows} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={open} />));
  await React.act(() => (container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!).click());
  expect(container.querySelector("#feature-entry")!.closest("[hidden]")).not.toBeNull();
  await React.act(() => container.querySelector<HTMLAnchorElement>('a[href="#feature-entry"]')!.click());
  expect(container.querySelector("#feature-entry")!.closest("[hidden]")).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("#feature-entry"));
  expect(open).not.toHaveBeenCalled();
});

it("does not apply an old feature's pending jump to a newly selected feature", async () => {
  root = createRoot(container);
  const props = { rolesById, relatedArticles: [], relatedFlows: flows, onBack: vi.fn(), onOpenArticle: vi.fn(), onOpenFlow: vi.fn() };
  await React.act(() => root.render(<FeatureGuide {...props} feature={feature} />));
  const entry = container.querySelector<HTMLElement>("#feature-entry")!;
  const focus = vi.spyOn(entry, "focus");
  await React.act(() => {
    container.querySelector<HTMLAnchorElement>('a[href="#feature-entry"]')!.click();
    root.render(<FeatureGuide {...props} feature={{ ...feature, id: "different-feature", title: "Different feature" }} />);
  });
  expect(focus).not.toHaveBeenCalled();
  expect(container.querySelector("h1")?.textContent).toBe("Different feature");
  focus.mockRestore();
});

it("keeps both selected tabs readable in dark mode with a visible keyboard focus ring", async () => {
  root = createRoot(container);
  await React.act(() => root.render(<FeatureGuide feature={feature} rolesById={rolesById} relatedArticles={[]} relatedFlows={flows} onBack={vi.fn()} onOpenArticle={vi.fn()} onOpenFlow={vi.fn()} />));
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  for (const tab of tabs) {
    await React.act(() => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.classList.contains("dark:text-brand-300")).toBe(true);
    expect(tab.classList.contains("focus-visible:ring-2")).toBe(true);
    expect(tab.classList.contains("dark:focus-visible:ring-brand-300")).toBe(true);
    const other = tabs.find((item) => item !== tab)!;
    expect(other.getAttribute("aria-selected")).toBe("false");
    expect(other.classList.contains("text-muted")).toBe(true);
    expect(other.classList.contains("hover:text-ink")).toBe(true);
  }
});
