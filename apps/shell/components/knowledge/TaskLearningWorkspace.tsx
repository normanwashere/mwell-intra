"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { OnboardingCenter } from "@intra/learning";
import { TaskStart } from "./TaskStart";
import { useAvailableTasks } from "./TaskStartLoader";

export function TaskLearningWorkspace({ audience = "internal" }: { audience?: "internal" | "vendor" }) {
  const tasks = useAvailableTasks();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selectedTask = tasks.find((task) => task.id === params.get("task"));
  const chooser = <TaskStart tasks={tasks} selectedTaskId={selectedTask?.id} onSelect={(task) => {
    const next = new URLSearchParams(params.toString());
    next.set("task", task.id);
    next.set("next", task.actionHref);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }} />;
  return (
    <div className="space-y-6">
      {selectedTask ? <details className="border-b border-line">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-muted">Change task</summary>
        {chooser}
      </details> : chooser}
      <OnboardingCenter audience={audience} selectedTask={selectedTask} />
    </div>
  );
}
