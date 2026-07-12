"use client";

import { Badge, Icon } from "@intra/ui";
import type { KnowledgeFlow, KnowledgeRole } from "@shell/lib/knowledge/types";

export function WorkflowLibrary({
  flows,
  rolesById,
  recommendedRoleIds,
  onOpenFlow,
}: {
  flows: KnowledgeFlow[];
  rolesById: Map<string, KnowledgeRole>;
  recommendedRoleIds: string[];
  onOpenFlow: (flowId: string) => void;
}) {
  const recommended = new Set(recommendedRoleIds);
  const ranked = [...flows].sort((left, right) => {
    const leftRecommended = left.roles.some((role) => recommended.has(role));
    const rightRecommended = right.roles.some((role) => recommended.has(role));
    return (
      Number(rightRecommended) - Number(leftRecommended) ||
      left.title.localeCompare(right.title)
    );
  });

  return (
    <section
      aria-labelledby="workflow-library-title"
      className="border-b border-line pb-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Guided workflows
          </p>
          <h2
            id="workflow-library-title"
            className="mt-1 text-2xl font-bold text-ink"
          >
            What do you need to complete?
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Start with the full governed flow, then work through each role,
            decision, screen, and outcome.
          </p>
        </div>
        <Badge tone="cyan">{flows.length} end-to-end flows</Badge>
      </div>
      <div className="mt-5 grid gap-px overflow-hidden border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
        {ranked.map((flow) => {
          const isRecommended = flow.roles.some((role) =>
            recommended.has(role),
          );
          const decisions = flow.nodes.filter(
            (node) => node.type === "decision",
          ).length;
          const outcomes = flow.nodes.filter(
            (node) => node.type === "terminal",
          ).length;
          return (
            <button
              key={flow.id}
              type="button"
              onClick={() => onOpenFlow(flow.id)}
              className="group min-w-0 bg-surface p-5 text-left transition hover:bg-inset focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              aria-label={`Open ${flow.title} guided workflow`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center bg-brand-50 text-brand-700">
                  <Icon name="transfer" className="h-5 w-5" />
                </span>
                {isRecommended && <Badge tone="emerald">Recommended</Badge>}
              </span>
              <span className="mt-4 block text-lg font-bold text-ink">
                {flow.title}
              </span>
              <span className="mt-1 block min-h-10 text-sm leading-5 text-muted">
                {flow.summary}
              </span>
              <span className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                <span>{flow.nodes.length} steps</span>
                <span>{decisions} decisions</span>
                <span>{outcomes} outcomes</span>
              </span>
              <span className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                <span className="truncate text-xs text-muted">
                  {flow.roles
                    .slice(0, 2)
                    .map((id) => rolesById.get(id)?.label ?? id)
                    .join(" + ")}
                </span>
                <Icon
                  name="arrowRight"
                  className="h-4 w-4 shrink-0 text-brand-700 transition group-hover:translate-x-0.5"
                />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
