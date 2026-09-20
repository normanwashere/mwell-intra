"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@intra/ui";
import { sharedCompletionKey, requirementProgress } from "./requirementIdentity";
import type { RequirementDefinition, RequirementProgress } from "./types";
import type {
  SelectedLearningTask,
  TaskLearningProjection,
} from "./taskReadiness";

export interface TaskLearningSummaryProps {
  task: SelectedLearningTask;
  projection: TaskLearningProjection;
  renderRequirement?: (requirement: RequirementDefinition) => ReactNode;
  progress?: readonly RequirementProgress[];
  onRefresh?: () => Promise<void>;
  loading?: boolean;
  refreshError?: string | null;
}

export function TaskLearningSummary({
  task,
  projection,
  renderRequirement,
  progress = [],
  onRefresh,
  loading = false,
  refreshError,
}: TaskLearningSummaryProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setRefreshing(false);
    setFailed(false);
    return () => { generation.current += 1; };
  }, [task.id]);
  const refresh = async () => {
    if (!onRefresh || inFlight.current || loading) return;
    const current = generation.current;
    inFlight.current = true;
    setRefreshing(true);
    setFailed(false);
    try { await onRefresh(); }
    catch { if (current === generation.current) setFailed(true); }
    finally {
      if (current === generation.current) {
        inFlight.current = false;
        setRefreshing(false);
      }
    }
  };
  const completedOther = projection.otherRequired.filter((item) =>
    ["passed", "waived"].includes(requirementProgress(item, progress)?.state ?? ""),
  ).length;
  const pending = refreshing || loading;
  const list = (items: readonly RequirementDefinition[]) => (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={sharedCompletionKey(item)} className="py-3">
          {renderRequirement ? (
            renderRequirement(item)
          ) : (
            <span className="break-words text-sm text-ink">
              {item.title}{" "}
              <span className="text-muted">(Version {item.version})</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <section
      aria-label="Task learning"
      data-onboarding-anchor="onboarding-required-steps"
      tabIndex={-1}
      className="min-w-0 border-b border-line py-5"
      data-task-id={task.id}
    >
      <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
        Selected task
      </p>
      <h2 className="mt-1 break-words font-display text-lg font-bold text-ink">
        {task.title}
      </h2>
      <p className="mt-1 break-words text-sm text-muted">{task.outcome}</p>
      {projection.status === "unavailable" ? (
        <div className="mt-4 space-y-3">
          <p role={pending ? "status" : "alert"} className="text-sm text-amber-800 dark:text-amber-300">
            {pending ? "Refreshing task readiness. Your task remains selected." : failed || refreshError
              ? "Task readiness could not be refreshed. Try again. Existing action controls still apply."
              : "Task learning readiness is unavailable. Refresh learning status before relying on it. Existing action controls still apply."}
          </p>
          {onRefresh && <Button type="button" variant="outline" icon="rotate" className="min-h-11" disabled={pending} onClick={() => void refresh()}>
            {pending ? "Refreshing task readiness" : "Refresh task readiness"}
          </Button>}
        </div>
      ) : (
        <>
          <h3 className="mt-5 text-sm font-semibold text-ink">
            Needed for this task
          </h3>
          {projection.neededNow.length ? (
            <>
              <p className="mt-1 text-xs text-muted">{projection.neededNow.length} {projection.neededNow.length === 1 ? 'requirement' : 'requirements'} remaining for this task</p>
              {list(projection.neededNow.slice(0, 1))}
              {projection.neededNow.length > 1 && <details className="border-t border-line">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">Remaining task requirements ({projection.neededNow.length - 1})</summary>
                {list(projection.neededNow.slice(1))}
              </details>}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No outstanding learning is identified for this task. Role
              permissions and record checks still apply.
            </p>
          )}
          <details className="mt-3 border-t border-line">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
              Other required learning ({projection.otherRequired.length - completedOther} outstanding, {completedOther} completed)
            </summary>
            {list(projection.otherRequired)}
          </details>
          <details className="border-t border-line">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
              Optional guidance ({projection.optional.length})
            </summary>
            {list(projection.optional)}
          </details>
        </>
      )}
    </section>
  );
}
