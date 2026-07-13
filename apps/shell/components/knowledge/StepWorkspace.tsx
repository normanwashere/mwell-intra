"use client";

import Link from "next/link";
import { Badge, Icon } from "@intra/ui";
import { edgeChoiceId, outgoingEdges } from "@shell/lib/knowledge/graph";
import type {
  KnowledgeEvidence,
  KnowledgeFlow,
  KnowledgeFlowNode,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { EvidenceViewer } from "./EvidenceViewer";

export function StepWorkspace({
  flow,
  node,
  evidence,
  rolesById,
  onSelectNode,
  onChooseBranch,
}: {
  flow: KnowledgeFlow;
  node: KnowledgeFlowNode;
  evidence?: KnowledgeEvidence;
  rolesById: Map<string, KnowledgeRole>;
  onSelectNode: (nodeId: string) => void;
  onChooseBranch?: (choiceId: string) => void;
}) {
  const branches = outgoingEdges(flow, node.id);
  const selectEdge = (edge: (typeof branches)[number]) => {
    if (branches.length > 1 && onChooseBranch)
      onChooseBranch(edgeChoiceId(flow, edge));
    else onSelectNode(edge.to);
  };
  return (
    <section
      aria-labelledby="step-workspace-title"
      className="border-t border-line pt-6"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,.85fr)]">
        <div className="min-w-0">
          <EvidenceViewer evidence={evidence} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge
              tone={
                node.type === "decision"
                  ? "amber"
                  : node.type === "terminal"
                    ? "emerald"
                    : "brand"
              }
            >
              {node.type}
            </Badge>
            {node.ownerRoleIds.map((id) => (
              <Badge key={id} tone="slate">
                {rolesById.get(id)?.label ?? id}
              </Badge>
            ))}
          </div>
          <h2
            id="step-workspace-title"
            tabIndex={-1}
            className="mt-3 text-2xl font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {node.title}
          </h2>
          <p className="mt-2 leading-7 text-muted">{node.body}</p>
          {node.prerequisite && (
            <div className="mt-5 border-l-4 border-brand-500 pl-4">
              <p className="text-xs font-semibold uppercase text-brand-700">
                Before you begin
              </p>
              <p className="mt-1 text-sm text-muted">{node.prerequisite}</p>
            </div>
          )}
          {node.outcome && (
            <div className="mt-5 border-l-4 border-emerald-500 pl-4">
              <p className="text-xs font-semibold uppercase text-emerald-700">
                Expected result
              </p>
              <p className="mt-1 text-sm text-muted">{node.outcome}</p>
            </div>
          )}
          {node.databaseEffect && (
            <div className="mt-5 border-l-4 border-cyan-500 pl-4">
              <p className="text-xs font-semibold uppercase text-cyan-700">
                Database effect
              </p>
              <p className="mt-1 text-sm text-muted">{node.databaseEffect}</p>
            </div>
          )}
          {node.exception && (
            <div className="mt-5 border-l-4 border-amber-500 pl-4">
              <p className="text-xs font-semibold uppercase text-amber-700">
                If this cannot proceed
              </p>
              <p className="mt-1 text-sm text-muted">{node.exception}</p>
            </div>
          )}
          {branches.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-ink">
                {node.type === "decision"
                  ? "Choose the outcome to continue"
                  : "Continue the workflow"}
              </p>
              <div className="mt-2 grid gap-2">
                {branches.map((edge) => (
                  <button
                    type="button"
                    key={edgeChoiceId(flow, edge)}
                    onClick={() => selectEdge(edge)}
                    className={`flex min-h-11 items-center justify-between gap-3 border px-3 py-2 text-left text-sm font-semibold ${edge.outcome === "exception" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-line bg-surface text-ink hover:border-brand-400"}`}
                  >
                    <span>{edge.label ?? "Next step"}</span>
                    <Icon name="arrowRight" className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {evidence?.route && (
            <Link
              href={evidence.route}
              className="btn-primary mt-6 w-full justify-center"
            >
              Open live screen <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
      <div className="sticky bottom-20 z-20 mt-4 grid grid-cols-2 gap-2 border border-line bg-surface/95 p-2 shadow-e2 backdrop-blur md:hidden">
        {branches[0] ? (
          <button
            type="button"
            onClick={() => selectEdge(branches[0]!)}
            className="btn-outline min-w-0 justify-center"
          >
            <span className="truncate">{branches[0].label ?? "Next step"}</span>
            <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
          </button>
        ) : (
          <span />
        )}
        {evidence?.route && (
          <Link
            href={evidence.route}
            className="btn-primary min-w-0 justify-center"
          >
            <span className="truncate">Open live screen</span>
            <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
          </Link>
        )}
      </div>
    </section>
  );
}
