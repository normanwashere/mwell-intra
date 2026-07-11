"use client";

import type { KnowledgeFlow } from "@shell/lib/knowledge/types";
import Link from "next/link";

export function WorkflowNavigator({
  flow,
  selectedNodeId,
}: {
  flow: KnowledgeFlow;
  selectedNodeId: string;
}) {
  return (
    <nav
      aria-label="Workflow steps"
      className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible"
    >
      {flow.nodes.map((node, index) => (
        <Link
          key={node.id}
          href={`/knowledge?flow=${encodeURIComponent(flow.id)}&step=${encodeURIComponent(node.id)}`}
          aria-current={node.id === selectedNodeId ? "step" : undefined}
          className={`min-w-40 border-l-4 px-3 py-2 text-left text-sm md:min-w-0 ${node.id === selectedNodeId ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-line bg-surface text-muted hover:bg-inset"}`}
        >
          <span className="block text-[10px] uppercase text-faint">
            {index + 1} · {node.type}
          </span>
          <span className="mt-0.5 block">{node.title}</span>
        </Link>
      ))}
    </nav>
  );
}
