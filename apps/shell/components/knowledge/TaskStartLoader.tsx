"use client";

import { useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import type { TaskDefinition } from "@shell/lib/knowledge/taskCatalog";
import { TaskStart } from "./TaskStart";

export function useAvailableTasks() {
  const { profile, userRoles, mode } = useSession();
  const [state, setState] = useState<{ key: string; tasks: TaskDefinition[] }>({ key: "", tasks: [] });
  const key = `${mode}:${profile?.id ?? ""}:${JSON.stringify(userRoles)}`;
  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    const url = mode === "memory" ? `/api/knowledge/tasks?demoProfile=${encodeURIComponent(profile.id)}` : "/api/knowledge/tasks";
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { tasks: [] })
      .then((data) => { if (!controller.signal.aborted) setState({ key, tasks: Array.isArray(data.tasks) ? data.tasks : [] }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, tasks: [] }); });
    return () => controller.abort();
  }, [key, profile?.id]);
  return state.key === key ? state.tasks : [];
}

export function TaskStartLoader() {
  const tasks = useAvailableTasks();
  const { profile } = useSession();
  return <TaskStart tasks={tasks} learningHref={profile?.kind === "vendor" ? "/vendor/onboarding" : "/onboarding"} />;
}
