"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@intra/ui";
import {
  exceptionNodes,
  resolveBranch,
  roleNodes,
} from "@shell/lib/knowledge/graph";
import type {
  KnowledgeEvidence,
  KnowledgeFlow as Flow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { GuidedDecisionPath } from "./GuidedDecisionPath";
import { StepWorkspace } from "./StepWorkspace";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNavigator, type WorkflowView } from "./WorkflowNavigator";

const WORKFLOW_VIEWS = new Set<WorkflowView>([
  "flow",
  "steps",
  "roles",
  "exceptions",
]);

export function KnowledgeFlow({
  flow,
  selectedNodeId: _selectedNodeId,
  evidence,
  rolesById,
  onSelectNode,
}: {
  flow: Flow;
  selectedNodeId: string;
  evidence: KnowledgeEvidence[];
  rolesById: Map<string, KnowledgeRole>;
  onSelectNode: (nodeId: string) => void;
}) {
  const params = useSearchParams();
  const requestedView = params.get("view") as WorkflowView | null;
  const paramKey = params.toString();
  const activeView =
    requestedView && WORKFLOW_VIEWS.has(requestedView) ? requestedView : "flow";
  const rawBranch = params.get("branch");
  const hasBranch = params.has("branch");
  const requestedChoiceIds = (rawBranch ?? "").split(",").filter(Boolean);
  const branchResolution = resolveBranch(flow, requestedChoiceIds);
  const canonicalBranch = branchResolution.choiceIds.join(",");
  const requestedStepId = params.get("step");
  const requestedSelected = flow.nodes.find(
    (node) => node.id === requestedStepId,
  );
  const selected =
    hasBranch || !requestedSelected
      ? branchResolution.currentNode
      : requestedSelected;
  const selectedEvidence = evidence.find(
    (item) => item.id === selected.evidenceId,
  );
  const decisions = flow.nodes.filter(
    (node) => node.type === "decision",
  ).length;
  const outcomes = flow.nodes.filter((node) => node.type === "terminal").length;

  const nextHref = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `/knowledge${next.size ? `?${next}` : ""}`;
  };

  const rememberDestinationScroll = (href: string) => {
    sessionStorage.setItem(
      `knowledge-scroll:${window.location.pathname}${window.location.search}`,
      String(window.scrollY),
    );
    sessionStorage.setItem(`knowledge-scroll:${href}`, String(window.scrollY));
  };

  const navigate = (
    changes: Record<string, string | null>,
    options: { replace?: boolean; focusWorkspace?: boolean } = {},
  ) => {
    const href = nextHref(changes);
    rememberDestinationScroll(href);
    if (options.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    if (options.focusWorkspace)
      requestAnimationFrame(() =>
        document.getElementById("step-workspace-title")?.focus({
          preventScroll: true,
        }),
      );
  };

  useEffect(() => {
    const next = new URLSearchParams(paramKey);
    if (!requestedView || !WORKFLOW_VIEWS.has(requestedView))
      next.set("view", "flow");
    if (hasBranch) {
      if (canonicalBranch) next.set("branch", canonicalBranch);
      else next.delete("branch");
      next.set("step", branchResolution.currentNode.id);
    } else if (!requestedSelected) {
      next.set("step", branchResolution.currentNode.id);
    }
    if (next.toString() === paramKey) return;
    const href = `/knowledge?${next}`;
    sessionStorage.setItem(`knowledge-scroll:${href}`, String(window.scrollY));
    window.history.replaceState(null, "", href);
  }, [
    branchResolution.currentNode.id,
    canonicalBranch,
    hasBranch,
    paramKey,
    requestedSelected,
    requestedView,
  ]);

  const selectNode = (nodeId: string) => {
    if (hasBranch) {
      navigate({ step: nodeId, branch: null }, { focusWorkspace: true });
      return;
    }
    rememberDestinationScroll(nextHref({ step: nodeId }));
    onSelectNode(nodeId);
    requestAnimationFrame(() =>
      document.getElementById("step-workspace-title")?.focus({
        preventScroll: true,
      }),
    );
  };

  const chooseBranch = (choiceId: string) => {
    const choices = [...branchResolution.choiceIds, choiceId];
    const current = resolveBranch(flow, choices).currentNode;
    navigate({
      branch: choices.join(","),
      step: current.id,
    });
  };

  const backtrack = () => {
    const choices = branchResolution.choiceIds.slice(0, -1);
    const current = resolveBranch(flow, choices).currentNode;
    navigate({
      branch: choices.length ? choices.join(",") : null,
      step: current.id,
    });
  };

  return (
    <section aria-labelledby="flow-title" className="space-y-6">
      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Guided workflow
        </p>
        <h1 id="flow-title" className="mt-1 text-3xl font-bold text-ink">
          {flow.title}
        </h1>
        <p className="mt-2 max-w-3xl text-base text-muted">{flow.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="brand">{flow.nodes.length} steps</Badge>
          <Badge tone="amber">{decisions} decisions</Badge>
          <Badge tone="emerald">{outcomes} outcomes</Badge>
        </div>
      </header>

      <WorkflowNavigator
        activeView={activeView}
        onSelectView={(view) => navigate({ view })}
      />

      <div
        role="tabpanel"
        id="workflow-panel-flow"
        aria-labelledby="workflow-tab-flow"
        hidden={activeView !== "flow"}
        className="space-y-5"
      >
        {activeView === "flow" && (
          <>
            <div className="hidden min-[640px]:block">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-ink">
                    Complete decision tree
                  </h2>
                  <p className="text-sm text-muted">
                    Select any node to see its screen and operating
                    instructions.
                  </p>
                </div>
                <div className="hidden gap-3 text-xs text-faint sm:flex">
                  <span>Blue - action</span>
                  <span>Amber - decision</span>
                  <span>Green - outcome</span>
                </div>
              </div>
              <WorkflowCanvas
                flow={flow}
                selectedNodeId={selected.id}
                rolesById={rolesById}
                onSelectNode={selectNode}
              />
            </div>
            <GuidedDecisionPath
              flow={flow}
              choices={branchResolution.choiceIds}
              selectedNodeId={selected.id}
              evidence={evidence}
              rolesById={rolesById}
              onChoose={chooseBranch}
              onBacktrack={backtrack}
            />
            <div className="hidden min-[640px]:block">
              <StepWorkspace
                flow={flow}
                node={selected}
                evidence={selectedEvidence}
                rolesById={rolesById}
                onSelectNode={selectNode}
                onChooseBranch={chooseBranch}
              />
            </div>
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="workflow-panel-steps"
        aria-labelledby="workflow-tab-steps"
        hidden={activeView !== "steps"}
        className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]"
      >
        {activeView === "steps" && (
          <>
            <nav
              aria-label="Workflow steps"
              className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible"
            >
              {flow.nodes.map((node, index) => (
                <button
                  type="button"
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  aria-current={node.id === selected.id ? "step" : undefined}
                  className={`min-h-11 min-w-40 border-l-4 px-3 py-2 text-left text-sm md:min-w-0 ${node.id === selected.id ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-line bg-surface text-muted hover:bg-inset"}`}
                >
                  <span className="block text-[10px] uppercase text-faint">
                    {index + 1} - {node.type}
                  </span>
                  <span className="mt-0.5 block">{node.title}</span>
                </button>
              ))}
            </nav>
            <StepWorkspace
              flow={flow}
              node={selected}
              evidence={selectedEvidence}
              rolesById={rolesById}
              onSelectNode={selectNode}
              onChooseBranch={chooseBranch}
            />
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="workflow-panel-roles"
        aria-labelledby="workflow-tab-roles"
        hidden={activeView !== "roles"}
        className="space-y-6"
      >
        {activeView === "roles" && (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              {flow.roles.map((roleId) => (
                <section
                  key={roleId}
                  aria-labelledby={`workflow-role-${roleId}`}
                  className="border-t border-line pt-4"
                >
                  <h2
                    id={`workflow-role-${roleId}`}
                    className="text-lg font-bold text-ink"
                  >
                    {rolesById.get(roleId)?.label ?? roleId}
                  </h2>
                  <div className="mt-3 grid gap-2">
                    {roleNodes(flow, roleId).map((node) => (
                      <button
                        type="button"
                        key={node.id}
                        onClick={() => selectNode(node.id)}
                        aria-current={
                          node.id === selected.id ? "step" : undefined
                        }
                        className="min-h-11 border border-line bg-surface px-3 py-2 text-left text-sm text-ink hover:border-brand-400"
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <StepWorkspace
              flow={flow}
              node={selected}
              evidence={selectedEvidence}
              rolesById={rolesById}
              onSelectNode={selectNode}
              onChooseBranch={chooseBranch}
            />
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="workflow-panel-exceptions"
        aria-labelledby="workflow-tab-exceptions"
        hidden={activeView !== "exceptions"}
        className="space-y-6"
      >
        {activeView === "exceptions" && (
          <>
            <section aria-labelledby="workflow-exception-list">
              <h2
                id="workflow-exception-list"
                className="text-lg font-bold text-ink"
              >
                Exception and recovery points
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {exceptionNodes(flow).map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    onClick={() => selectNode(node.id)}
                    aria-current={node.id === selected.id ? "step" : undefined}
                    className="min-h-11 border border-rose-200 bg-rose-50 px-3 py-2 text-left text-sm font-semibold text-rose-900"
                  >
                    {node.title}
                  </button>
                ))}
              </div>
            </section>
            <StepWorkspace
              flow={flow}
              node={selected}
              evidence={selectedEvidence}
              rolesById={rolesById}
              onSelectNode={selectNode}
              onChooseBranch={chooseBranch}
            />
          </>
        )}
      </div>
    </section>
  );
}
