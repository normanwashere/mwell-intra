"use client";

import { Badge } from "@intra/ui";
import type {
  KnowledgeEvidence,
  KnowledgeFlow as Flow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { StepWorkspace } from "./StepWorkspace";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNavigator } from "./WorkflowNavigator";

export function KnowledgeFlow({
  flow,
  selectedNodeId,
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
  const selected =
    flow.nodes.find((node) => node.id === selectedNodeId) ??
    flow.nodes.find((node) => node.id === flow.startNodeId)!;
  const selectedEvidence = evidence.find(
    (item) => item.id === selected.evidenceId,
  );
  const decisions = flow.nodes.filter(
    (node) => node.type === "decision",
  ).length;
  const outcomes = flow.nodes.filter((node) => node.type === "terminal").length;
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
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">
              Complete decision tree
            </h2>
            <p className="text-sm text-muted">
              Select any node to see its screen and operating instructions.
            </p>
          </div>
          <div className="hidden gap-3 text-xs text-faint sm:flex">
            <span>Blue · action</span>
            <span>Amber · decision</span>
            <span>Green · outcome</span>
          </div>
        </div>
        <WorkflowCanvas
          flow={flow}
          selectedNodeId={selected.id}
          rolesById={rolesById}
          onSelectNode={onSelectNode}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <WorkflowNavigator
          flow={flow}
          selectedNodeId={selected.id}
          onSelectNode={onSelectNode}
        />
        <StepWorkspace
          flow={flow}
          node={selected}
          evidence={selectedEvidence}
          rolesById={rolesById}
          onSelectNode={onSelectNode}
        />
      </div>
    </section>
  );
}
