import type { TaskDefinition } from "./taskCatalog";

export interface TaskRecommendationInput {
  tasks: readonly TaskDefinition[];
  eligibleTaskIds: ReadonlySet<string>;
  selectedTaskId?: string;
  resumableTaskId?: string;
  assignedTaskIds: readonly string[];
}

export function recommendTasks(input: TaskRecommendationInput): TaskDefinition[] {
  const eligible = new Map<string, TaskDefinition>();
  for (const task of input.tasks) {
    if (task.availability === "live" && input.eligibleTaskIds.has(task.id) && !eligible.has(task.id)) eligible.set(task.id, task);
  }
  const curated = [...eligible.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  const ids = new Set([input.selectedTaskId, input.resumableTaskId, ...input.assignedTaskIds, ...curated.map(task => task.id)]);
  return [...ids].flatMap(id => id && eligible.has(id) ? [eligible.get(id)!] : []).slice(0, 3);
}
