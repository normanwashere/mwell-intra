"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "@intra/auth";
import { Badge, Icon } from "@intra/ui";
import {
  branchOptions,
  edgeChoiceId,
  resolveBranch,
} from "@shell/lib/knowledge/graph";
import type {
  KnowledgeEvidence,
  KnowledgeFlow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { knowledgeRoleIdsForAssignments } from "@shell/lib/knowledge/roles";
import { guidedEvidenceRoute } from "@shell/lib/knowledge/semantics";
import { EvidenceViewer } from "./EvidenceViewer";

export function GuidedDecisionPath({
  flow,
  choices,
  selectedNodeId,
  evidence,
  rolesById,
  onChoose,
  onBacktrack,
}: {
  flow: KnowledgeFlow;
  choices: readonly string[];
  selectedNodeId?: string;
  evidence: KnowledgeEvidence[];
  rolesById: Map<string, KnowledgeRole>;
  onChoose: (choiceId: string) => void;
  onBacktrack: () => void;
}) {
  const params = useSearchParams();
  const { userRoles } = useSession();
  const resolution = resolveBranch(flow, choices);
  const current =
    flow.nodes.find((node) => node.id === selectedNodeId) ??
    resolution.currentNode;
  const followsTrace = current.id === resolution.currentNode.id;
  const path = followsTrace ? resolution.nodes : [current];
  const options = branchOptions(flow, current.id);
  const currentEvidence = evidence.find(
    (item) => item.id === current.evidenceId,
  );
  const assignedRoleIds = knowledgeRoleIdsForAssignments(userRoles);
  const canExecute = current.ownerRoleIds.some((roleId) =>
    assignedRoleIds.includes(roleId),
  );
  const returnTo = `/knowledge${params.size ? `?${params}` : ""}`;
  const liveRoute = currentEvidence?.route
    ? guidedEvidenceRoute(currentEvidence.route, current.id, returnTo)
    : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousNodeId = useRef(current.id);

  useEffect(() => {
    if (previousNodeId.current !== current.id)
      headingRef.current?.focus({ preventScroll: true });
    previousNodeId.current = current.id;
  }, [current.id]);

  return (
    <section
      aria-labelledby="guided-current-step"
      aria-live="polite"
      className="border-y border-line bg-surface py-4 min-[640px]:hidden"
    >
      <nav aria-label="Branch history" className="pb-2">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {path.map((node, index) => (
            <li key={node.id} className="flex items-center gap-2">
              {followsTrace && index > 0 && (
                <>
                  <Icon name="chevron" className="h-3 w-3 -rotate-90" />
                  {branchOptions(
                    flow,
                    resolution.traversedEdges[index - 1]!.from,
                  ).length > 1 && (
                    <span className="font-semibold text-brand-700">
                      Via {resolution.traversedEdges[index - 1]!.label}
                    </span>
                  )}
                </>
              )}
              <span aria-current={node.id === current.id ? "step" : undefined}>
                {node.title}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-2 border border-line bg-surface p-4 shadow-e1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={
              current.type === "decision"
                ? "amber"
                : current.type === "terminal"
                  ? "emerald"
                  : "brand"
            }
          >
            {current.type}
          </Badge>
          {current.ownerRoleIds.map((roleId) => (
            <Badge key={roleId} tone="slate">
              {rolesById.get(roleId)?.label ?? roleId}
            </Badge>
          ))}
        </div>
        <h2
          ref={headingRef}
          id="guided-current-step"
          tabIndex={-1}
          className="mt-3 text-xl font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {current.title}
        </h2>
        <p className="mt-2 leading-6 text-muted">{current.body}</p>

        <div className="mt-5">
          <EvidenceViewer evidence={currentEvidence} node={current} />
        </div>

        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="font-semibold text-ink">Responsible role</dt>
            <dd className="mt-1 text-muted">
              {current.ownerRoleIds
                .map((id) => rolesById.get(id)?.label ?? id)
                .join(", ")}
            </dd>
          </div>
          {currentEvidence && (
            <div>
              <dt className="font-semibold text-ink">Completion evidence</dt>
              <dd className="mt-1 text-muted">{currentEvidence.alt}</dd>
            </div>
          )}
          {current.type === "terminal" && (
            <div>
              <dt className="font-semibold text-ink">Terminal outcome</dt>
              <dd className="mt-1 text-emerald-700">
                Completed: {current.terminalOutcome}
                {current.outcome ? ` - ${current.outcome}` : ""}
              </dd>
            </div>
          )}
        </dl>

        {options.length > 0 && (
          <div className="mt-5 grid gap-2" aria-label="Branch choices">
            {options.map((edge) => {
              const choiceId = edgeChoiceId(flow, edge);
              return (
                <button
                  type="button"
                  key={choiceId}
                  onClick={() => onChoose(choiceId)}
                  className={`flex min-h-11 items-center justify-between gap-3 border px-3 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${edge.outcome === "exception" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-line bg-surface text-ink"}`}
                >
                  <span>{edge.label ?? "Continue"}</span>
                  <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {choices.length > 0 && (
          <button
            type="button"
            onClick={onBacktrack}
            className="btn-outline mt-4 min-h-11 w-full justify-center"
          >
            <Icon name="chevron" className="h-4 w-4 rotate-90" />
            Backtrack
          </button>
        )}
        {liveRoute && canExecute && (
          <a
            href={liveRoute}
            data-navigation="document"
            className="btn-primary mt-4 min-h-11 w-full justify-center"
          >
            Open guided screen <Icon name="arrowRight" className="h-4 w-4" />
          </a>
        )}
        {liveRoute && !canExecute && (
          <div className="mt-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">View-only guidance</p>
            <p className="mt-1">Your current role cannot perform this step.</p>
            <Link href="/knowledge?flow=identity-and-access&view=flow" className="btn-outline btn-sm mt-3 min-h-11">
              Request access guidance
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
