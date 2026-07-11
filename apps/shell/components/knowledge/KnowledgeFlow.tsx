"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Sheet } from "@intra/ui";
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
      <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(20rem,2fr)_minmax(12rem,1.2fr)] gap-4 px-2 text-xs font-semibold uppercase tracking-wide text-faint md:grid">
        <span>Responsible role</span>
        <span>Governed process</span>
        <span>Outcome or exception</span>
      </div>
      <ol className="relative" aria-label={`${flow.title} flowchart`}>
        {ordered.map((item, index) => (
          <li
            key={item.id}
            className="relative grid min-w-0 gap-3 pb-12 md:grid-cols-[minmax(10rem,1fr)_minmax(20rem,2fr)_minmax(12rem,1.2fr)] md:gap-4 md:pb-14"
          >
            <div className="order-1 flex min-w-0 items-start md:justify-end md:pt-4">
              <div className="flex flex-wrap gap-1.5 md:justify-end">
                {item.ownerRoleIds.slice(0, 3).map((id) => (
                  <Badge key={id} tone="slate">
                    {rolesById.get(id)?.label ?? id}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="relative order-2">
              {index > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-12 left-6 h-12 w-0.5 bg-brand-300 md:left-1/2 md:-translate-x-1/2"
                />
              )}
              <button
                type="button"
                onClick={() => setSelected(item)}
                className={`group relative flex min-h-28 w-full flex-col justify-center border-2 bg-surface px-5 py-4 text-left shadow-e1 transition hover:-translate-y-0.5 hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app ${
                  item.type === "decision"
                    ? "border-amber-500 md:mx-auto md:w-[88%] md:rotate-0"
                    : item.type === "terminal"
                      ? "rounded-full border-emerald-500"
                      : item.type === "start"
                        ? "rounded-full border-brand-500"
                        : item.type === "system"
                          ? "border-cyan-500"
                          : "border-brand-400"
                }`}
                aria-label={`${index + 1}. ${item.title}. Open details`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="tnum text-xs font-semibold text-faint">
                    STEP {index + 1}
                  </span>
                  <Badge tone={tone(item.type)}>{item.type}</Badge>
                </span>
                <span className="mt-2 text-base font-bold text-ink">
                  {item.title}
                </span>
                <span className="mt-1 text-sm leading-6 text-muted">
                  {item.body}
                </span>
              </button>
              {index < ordered.length - 1 && (
                <span
                  aria-hidden
                  className="absolute -bottom-10 left-6 flex h-10 w-5 flex-col items-center md:left-1/2 md:-translate-x-1/2"
                >
                  <span className="h-6 w-0.5 bg-brand-400" />
                  <span className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-brand-500" />
                </span>
              )}
            </div>
            <div className="relative order-3 min-w-0 md:pt-2">
              {(item.outcome || item.exception) && (
                <span
                  aria-hidden
                  className="absolute -left-4 top-9 hidden h-0.5 w-4 bg-line md:block"
                >
                  <span className="absolute -right-0.5 -top-[4px] h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-line" />
                </span>
              )}
              {item.outcome && (
                <div className="border-l-4 border-emerald-500 bg-emerald-500/10 px-3 py-2 text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Success path
                  </span>
                  <span className="mt-1 block text-muted">{item.outcome}</span>
                </div>
              )}
              {item.exception && (
                <div className="mt-2 border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Exception branch
                  </span>
                  <span className="mt-1 block text-muted">
                    {item.exception}
                  </span>
                </div>
              )}
              {!item.outcome && !item.exception && item.type !== "terminal" && (
                <p className="text-sm text-faint">
                  Continue to the next governed step.
                </p>
              )}
            </div>
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
