"use client";

import Link from "next/link";
import { Icon } from "@intra/ui";
import { projectTaskLearning, useOptionalLearning } from "@intra/learning";
import type { TaskDefinition } from "@shell/lib/knowledge/taskCatalog";

// Tasks are already role-scoped by the caller. Learning status changes the
// destination, never the permissions enforced inside the operational task.
export function TaskActionLink({
  task,
  learningHref = "/onboarding",
}: {
  task: TaskDefinition;
  learningHref?: string;
}) {
  const learning = useOptionalLearning();
  const projection = projectTaskLearning(
    learning?.snapshot ?? null,
    task.audience,
    task.actionCapabilities,
    !learning || learning.loading || learning.stale || Boolean(learning.error),
  );
  const ready =
    projection.status === "known" && projection.neededNow.length === 0;
  if (task.availability === "coming_soon") return null;
  return (
    <Link
      href={
        ready
          ? task.actionHref
          : `${learningHref}?task=${encodeURIComponent(task.id)}&next=${encodeURIComponent(task.actionHref)}`
      }
      className="btn-primary min-h-11 gap-2 px-4 text-sm"
    >
      {ready
        ? "Open task"
        : projection.status === "known"
          ? "Prepare for task"
          : "Check task readiness"}
      <span className="sr-only">: {task.title}</span>
      <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
    </Link>
  );
}
