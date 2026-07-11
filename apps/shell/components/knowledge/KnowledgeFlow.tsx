"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Icon, Sheet } from "@intra/ui";
import type {
  KnowledgeFlow,
  KnowledgeFlowNode,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";

const tone = (type: KnowledgeFlowNode["type"]) =>
  type === "terminal"
    ? "emerald"
    : type === "decision"
      ? "amber"
      : type === "system"
        ? "cyan"
        : "brand";

export function KnowledgeFlow({
  flow,
  rolesById,
}: {
  flow: KnowledgeFlow;
  rolesById: Map<string, KnowledgeRole>;
}) {
  const [selected, setSelected] = useState<KnowledgeFlowNode | null>(null);
  const ordered = useMemo(() => {
    const result: KnowledgeFlowNode[] = [];
    const seen = new Set<string>();
    let current = flow.startNodeId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const item = flow.nodes.find((node) => node.id === current);
      if (!item) break;
      result.push(item);
      current = flow.edges.find((edge) => edge.from === current)?.to ?? "";
    }
    for (const item of flow.nodes) if (!seen.has(item.id)) result.push(item);
    return result;
  }, [flow]);

  return (
    <section aria-labelledby="flow-title" className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Interactive flow
        </p>
        <h2 id="flow-title" className="mt-1 text-2xl font-bold text-ink">
          {flow.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{flow.summary}</p>
      </div>
      <ol
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        aria-label={`${flow.title} steps`}
      >
        {ordered.map((item, index) => (
          <li key={item.id} className="relative min-w-0">
            <button
              type="button"
              onClick={() => setSelected(item)}
              className="group flex min-h-32 w-full flex-col border-l-4 border-brand-500 bg-surface p-4 text-left shadow-e1 transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label={`${index + 1}. ${item.title}. Open details`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="tnum text-xs font-semibold text-faint">
                  STEP {index + 1}
                </span>
                <Badge tone={tone(item.type)}>{item.type}</Badge>
              </span>
              <span className="mt-3 font-semibold text-ink">{item.title}</span>
              <span className="mt-1 line-clamp-2 text-sm text-muted">
                {item.body}
              </span>
              <span className="mt-auto pt-3 text-xs font-semibold text-brand-700">
                View owner, outcome and exceptions
              </span>
            </button>
            {index < ordered.length - 1 && (
              <Icon
                name="arrowRight"
                className="absolute -bottom-3 left-1/2 z-10 h-5 w-5 -translate-x-1/2 rotate-90 rounded-full bg-app p-0.5 text-brand-600 md:-right-2.5 md:bottom-auto md:left-auto md:top-1/2 md:translate-x-0 md:-translate-y-1/2 md:rotate-0"
              />
            )}
          </li>
        ))}
      </ol>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.title ?? "Flow step"}
        description={selected ? `Step type: ${selected.type}` : undefined}
        footer={<Button onClick={() => setSelected(null)}>Done</Button>}
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold text-ink">Owner</p>
              <p className="mt-1 text-muted">
                {selected.ownerRoleIds
                  .map((id) => rolesById.get(id)?.label ?? id)
                  .join(", ")}
              </p>
            </div>
            <div>
              <p className="font-semibold text-ink">Action</p>
              <p className="mt-1 text-muted">{selected.body}</p>
            </div>
            {selected.prerequisite && (
              <div>
                <p className="font-semibold text-ink">Prerequisite</p>
                <p className="mt-1 text-muted">{selected.prerequisite}</p>
              </div>
            )}
            {selected.outcome && (
              <div className="border-l-4 border-emerald-500 bg-emerald-500/10 p-3">
                <p className="font-semibold text-ink">Expected outcome</p>
                <p className="mt-1 text-muted">{selected.outcome}</p>
              </div>
            )}
            {selected.exception && (
              <div className="border-l-4 border-amber-500 bg-amber-500/10 p-3">
                <p className="font-semibold text-ink">Exception path</p>
                <p className="mt-1 text-muted">{selected.exception}</p>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
}
