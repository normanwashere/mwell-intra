"use client";

import Link from "next/link";
import { useState } from 'react';
import { Icon } from "@intra/ui";
import type { TaskDefinition } from "@shell/lib/knowledge/taskCatalog";
import { eligibleTasks, recommendTasks } from "@shell/lib/knowledge/taskRecommendations";
import { KNOWLEDGE_ROLES } from '@shell/lib/knowledge/roles';
import { TaskActionLink } from './TaskActionLink';

const roleLabels = new Map(KNOWLEDGE_ROLES.map(role => [role.id, role.label]));

export function TaskStart({ tasks, onSelect, selectedTaskId, learningHref = "/onboarding" }: {
  tasks: TaskDefinition[];
  onSelect?: (task: TaskDefinition) => void;
  selectedTaskId?: string;
  learningHref?: string;
}) {
  const [query, setQuery] = useState('');
  if (!tasks.length) return null;
  const recommendations = recommendTasks({ tasks, eligibleTaskIds: new Set(tasks.map(task => task.id)), selectedTaskId, assignedTaskIds: [] });
  const complete = eligibleTasks(tasks, query);
  return (
    <section aria-labelledby="task-start-title" className="border-y border-line py-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="task-start-title" className="text-lg font-bold text-ink">Your operational tasks</h2>
        </div>
        <Link href="/knowledge?mode=task" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
          All task guides <Icon name="arrowRight" className="h-4 w-4" />
        </Link>
      </div>
      {!onSelect && <ol className="divide-y divide-line">
        {recommendations.map((task, index) => (
          <li key={task.id} className={`grid items-center gap-2 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] ${selectedTaskId === task.id ? "bg-inset" : ""}`}>
            <span aria-hidden className="hidden h-10 w-10 items-center justify-center rounded-lg bg-inset text-sm font-bold text-muted sm:flex">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-ink">{task.title}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={task.guideHref} className="btn-ghost min-h-11 px-3 text-sm">View guide</Link>
              <TaskActionLink task={task} learningHref={learningHref} />
            </div>
          </li>
        ))}
      </ol>}
      {onSelect && <div className="mt-4 border-t border-line pt-4">
        <label htmlFor="task-search" className="label">All eligible tasks</label>
        <input id="task-search" type="search" className="input mt-2 min-h-11" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search task, module or role" />
        <p role="status" className="mt-2 text-xs text-muted">{complete.length} tasks</p>
        <div role="region" aria-label="Eligible tasks by module" tabIndex={0} className="mt-2 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">
          {[...new Set(complete.map(task => task.moduleLabel))].map(moduleLabel => <section key={moduleLabel} aria-label={moduleLabel}>
            <h3 className="border-b border-line py-2 text-sm font-bold">{moduleLabel}</h3>
            <ul className="divide-y divide-line">
              {complete.filter(task => task.moduleLabel === moduleLabel).map(task => {
                const audience = [...new Set(task.roleIds.flatMap(role => roleLabels.has(role) ? [roleLabels.get(role)!] : []))];
                return <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0 basis-48 flex-1">
                  <p className="break-words text-sm font-semibold">{task.title}</p>
                  {audience.length > 3 ? <details className="mt-1 text-xs text-muted">
                    <summary className="min-h-11 cursor-pointer content-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">Available to {audience.length} roles</summary>
                    <ul className="mb-2 grid gap-1.5 border-l border-line pl-3 sm:grid-cols-2">
                      {audience.map(label => <li key={label} className="break-words">{label}</li>)}
                    </ul>
                  </details> : <p className="mt-1 break-words text-xs text-muted">{audience.join(', ') || 'Assigned role'}</p>}
                  {recommendations.some(item => item.id === task.id) && <span className="text-xs text-brand-700">Recommended</span>}
                </div>
                <button type="button" className="btn-secondary min-h-11" aria-label={`Select ${task.title}`} aria-pressed={task.id === selectedTaskId} onClick={() => onSelect(task)}>{task.id === selectedTaskId ? 'Selected' : 'Select task'}</button>
              </li>; })}
            </ul>
          </section>)}
        </div>
      </div>}
    </section>
  );
}
