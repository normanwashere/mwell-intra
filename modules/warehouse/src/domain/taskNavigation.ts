import type { WarehouseTask } from '@intra/data-kit';

export type TaskStatus = WarehouseTask['status'];

export function parseTaskStatus(value: string | null): TaskStatus {
  return value === 'blocked' || value === 'completed' ? value : 'due';
}

export function tasksReturnPath(params: URLSearchParams): string {
  return `/tasks?status=${parseTaskStatus(params.get('taskStatus'))}`;
}

export function sourcePathForTask(task: WarehouseTask, status: TaskStatus): string {
  const path = task.type === 'quality' ? '/quality'
    : task.type === 'cycle_count' ? '/cycle-counts'
      : task.type === 'putaway' ? '/storage' : '/exceptions';
  return `${path}?source=${encodeURIComponent(task.sourceId)}&taskStatus=${parseTaskStatus(status)}`;
}
