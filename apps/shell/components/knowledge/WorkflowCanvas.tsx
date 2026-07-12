"use client";

import { Badge } from "@intra/ui";
import { layoutFlow } from "@shell/lib/knowledge/graph";
import type { KnowledgeFlow, KnowledgeRole } from "@shell/lib/knowledge/types";

export function WorkflowCanvas({
  flow,
  selectedNodeId,
  rolesById,
  onSelectNode,
}: {
  flow: KnowledgeFlow;
  selectedNodeId: string;
  rolesById: Map<string, KnowledgeRole>;
  onSelectNode: (nodeId: string) => void;
}) {
  const layout = layoutFlow(flow);
  return (
    <div
      className="overflow-x-auto border-y border-line bg-inset"
      aria-label={`${flow.title} decision tree`}
    >
      <div
        className="relative mx-auto"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <marker
              id={`arrow-${flow.id}`}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className="fill-brand-500" />
            </marker>
          </defs>
          {flow.edges.map((edge) => {
            const from = layout.nodes.get(edge.from)!;
            const to = layout.nodes.get(edge.to)!;
            const x1 = from.x + 100,
              y1 = from.y + 108,
              x2 = to.x + 100,
              y2 = to.y;
            return (
              <g key={`${edge.from}-${edge.to}-${edge.label ?? "next"}`}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                  fill="none"
                  className={
                    edge.outcome === "exception"
                      ? "stroke-rose-500"
                      : edge.outcome === "success"
                        ? "stroke-emerald-500"
                        : "stroke-brand-400"
                  }
                  strokeWidth="2"
                  markerEnd={`url(#arrow-${flow.id})`}
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 5}
                    textAnchor="middle"
                    className="fill-muted text-[11px] font-semibold"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {flow.nodes.map((node, index) => {
          const position = layout.nodes.get(node.id)!;
          const selected = node.id === selectedNodeId;
          return (
            <button
              type="button"
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              style={{ left: position.x, top: position.y }}
              aria-current={selected ? "step" : undefined}
              aria-label={`${index + 1}. ${node.title}. ${node.type}. ${node.ownerRoleIds.map((id) => rolesById.get(id)?.label ?? id).join(", ")}`}
              className={`absolute z-10 flex h-[108px] w-[200px] flex-col justify-center border-2 bg-surface px-3 text-left shadow-e1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${selected ? "border-brand-600 shadow-e2" : node.type === "decision" ? "border-amber-500" : node.type === "terminal" ? "rounded-[3rem] border-emerald-500" : node.type === "start" ? "rounded-[3rem] border-brand-500" : node.type === "system" ? "border-cyan-500" : "border-line hover:border-brand-400"}`}
            >
              <span className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase text-faint">
                <span>Step {index + 1}</span>
                <Badge
                  tone={
                    node.type === "decision"
                      ? "amber"
                      : node.type === "terminal"
                        ? "emerald"
                        : node.type === "system"
                          ? "cyan"
                          : "brand"
                  }
                >
                  {node.type}
                </Badge>
              </span>
              <span className="mt-2 line-clamp-2 text-sm font-bold text-ink">
                {node.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
