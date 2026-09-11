"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef } from 'react';
import { OnboardingCenter, taskRequirementIds, taskSelectionQuery, useOptionalLearning } from "@intra/learning";
import { TaskStart } from "./TaskStart";
import { useAvailableTasks } from "./TaskStartLoader";

export function TaskLearningWorkspace({ audience = "internal" }: { audience?: "internal" | "vendor" }) {
  const tasks = useAvailableTasks();
  const params = useSearchParams();
  const pathname = usePathname();
  const learning = useOptionalLearning();
  const workspace = useRef<HTMLDivElement>(null);
  const previousTask = useRef(params.get('task'));
  const selectedTask = tasks.find((task) => task.id === params.get("task"));
  useEffect(() => {
    if (previousTask.current === selectedTask?.id) return;
    previousTask.current = selectedTask?.id ?? null;
    if (!selectedTask) return;
    const target = workspace.current?.querySelector<HTMLElement>('[data-task-id] h2');
    if (target) {
      target.tabIndex = -1;
      target.focus();
    }
  }, [selectedTask]);
  const chooser = <TaskStart tasks={tasks} selectedTaskId={selectedTask?.id} onSelect={(task) => {
    if (task.id === selectedTask?.id) return;
    const requirementIds = taskRequirementIds(learning && !learning.loading && !learning.stale ? learning.snapshot : null, audience, task.actionCapabilities);
    const next = taskSelectionQuery(new URLSearchParams(params.toString()), task, requirementIds);
    window.history.pushState(null, "", `${pathname}?${next}`);
  }} />;
  return (
    <div ref={workspace} className="space-y-6">
      {selectedTask ? <details className="border-b border-line">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-muted">Change task</summary>
        {chooser}
      </details> : chooser}
      <OnboardingCenter audience={audience} selectedTask={selectedTask} />
    </div>
  );
}
