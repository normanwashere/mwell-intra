"use client";

import type { ReactNode } from "react";
import { sharedCompletionKey } from "./requirementIdentity";
import type { RequirementDefinition } from "./types";
import type {
  SelectedLearningTask,
  TaskLearningProjection,
} from "./taskReadiness";

export interface TaskLearningSummaryProps {
  task: SelectedLearningTask;
  projection: TaskLearningProjection;
  renderRequirement?: (requirement: RequirementDefinition) => ReactNode;
}

export function TaskLearningSummary({
  task,
  projection,
  renderRequirement,
}: TaskLearningSummaryProps) {
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
        <p
          role="alert"
          className="mt-4 text-sm text-amber-800 dark:text-amber-300"
        >
          Task learning readiness is unavailable. Refresh learning status before
          relying on it. Existing action controls still apply.
        </p>
      ) : (
        <>
          <h3 className="mt-5 text-sm font-semibold text-ink">
            Needed for this task
          </h3>
          {projection.neededNow.length ? (
            list(projection.neededNow)
          ) : (
            <p className="mt-2 text-sm text-muted">
              No outstanding learning is identified for this task. Role
              permissions and record checks still apply.
            </p>
          )}
          <details className="mt-3 border-t border-line">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">
              Other required learning ({projection.otherRequired.length})
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
