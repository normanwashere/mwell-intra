import { useEffect, useMemo, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { WarehouseTask } from '@intra/data-kit';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { Icon } from '@/components/Icon';

type TaskStatus = WarehouseTask['status'];

export function TasksPage() {
  const { loadWarehouseTasks } = useWarehouse();
  const [status, setStatus] = useState<TaskStatus>('due');
  const [tasks, setTasks] = useState<WarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadWarehouseTasks({ limit: 100 })
      .then((page) => {
        if (active) setTasks(page.rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadWarehouseTasks]);

  const shown = useMemo(() => tasks.filter((task) => task.status === status), [status, tasks]);
  return (
    <div className="space-y-4">
      <PageHeader title="Tasks" icon="clipboard" subtitle="Warehouse work queue" />
      <SegmentedControl<TaskStatus>
        ariaLabel="Task status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'due', label: 'Due' },
          { value: 'blocked', label: 'Blocked' },
          { value: 'completed', label: 'Completed' },
        ]}
      />
      {loading ? <p className="text-sm text-muted">Loading tasks...</p> : shown.length === 0 ? (
        <EmptyState icon="clipboard" title={`No ${status} tasks`} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label={`${status} tasks`}>
          {shown.map((task) => (
            <li key={task.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-700">
                <Icon name={task.type === 'quality' ? 'scan' : 'alert'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{task.title}</span>
                <span className="block text-xs text-faint">{task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : 'No due date'}</span>
              </span>
              <Badge tone={status === 'blocked' ? 'amber' : status === 'completed' ? 'emerald' : 'brand'}>{status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
