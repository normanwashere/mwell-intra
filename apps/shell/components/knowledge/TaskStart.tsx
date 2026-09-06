"use client";

import Link from "next/link";
import { Icon } from "@intra/ui";
import type { TaskDefinition } from "@shell/lib/knowledge/taskCatalog";
import { recommendTasks } from "@shell/lib/knowledge/taskRecommendations";

export function TaskStart({ tasks, onSelect, selectedTaskId, learningHref = "/onboarding" }: {
  tasks: TaskDefinition[];
  onSelect?: (task: TaskDefinition) => void;
  selectedTaskId?: string;
  learningHref?: string;
}) {
  if (!tasks.length) return null;
  const recommendations = recommendTasks({ tasks, eligibleTaskIds: new Set(tasks.map(task => task.id)), selectedTaskId, assignedTaskIds: [] });
  return (
    <section aria-labelledby="task-start-title" className="border-y border-line py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-muted">Your next step</p>
          <h2 id="task-start-title" className="mt-1 text-xl font-bold text-ink">What are you working on?</h2>
        </div>
        <Link href="/knowledge?mode=task" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
          All task guides <Icon name="arrowRight" className="h-4 w-4" />
        </Link>
      </div>
      <ol className="divide-y divide-line">
        {recommendations.map((task, index) => (
          <li key={task.id} className={`grid items-center gap-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] ${selectedTaskId === task.id ? "bg-inset" : ""}`}>
            <span aria-hidden className="hidden h-10 w-10 items-center justify-center rounded-lg bg-inset text-sm font-bold text-muted sm:flex">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{task.title}</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{task.outcome}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={task.guideHref} className="btn-ghost min-h-11 px-3 text-sm">View guide</Link>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(task)} aria-pressed={selectedTaskId === task.id} className="btn-primary min-h-11 gap-2 px-4 text-sm">
                  {selectedTaskId === task.id ? "Selected" : "Prepare for task"}<Icon name="arrowRight" className="h-4 w-4" />
                </button>
              ) : (
                <Link href={`${learningHref}?task=${encodeURIComponent(task.id)}&next=${encodeURIComponent(task.actionHref)}`} className="btn-primary min-h-11 gap-2 px-4 text-sm">Prepare for task<Icon name="arrowRight" className="h-4 w-4" /></Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
