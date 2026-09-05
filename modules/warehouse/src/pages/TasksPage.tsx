import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import type { WarehouseTask, QualityInspection } from '@intra/data-kit';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { loadCompleteControlQueue } from '@/domain/controlQueues';

import { parseTaskStatus, sourcePathForTask, type TaskStatus } from '@/domain/taskNavigation';

export function TasksPage() {
  const { data, loadWarehouseTasks, loadQualityInspections } = useWarehouse();
  const [params, setParams] = useSearchParams();
  const status = parseTaskStatus(params.get('status'));
  const setStatus = (next: TaskStatus) => {
    const updated = new URLSearchParams(params);
    updated.set('status', parseTaskStatus(next));
    setParams(updated);
  };
  const [tasks, setTasks] = useState<WarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspections, setInspections] = useState<QualityInspection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([loadCompleteControlQueue(loadWarehouseTasks), loadCompleteControlQueue(loadQualityInspections)])
      .then(([rows, quality]) => {
        if (active) { setTasks(rows); setInspections(quality); }
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Tasks could not be loaded.'); })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadWarehouseTasks, loadQualityInspections, reloadVersion]);

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
      {error ? <div role="alert"><p>{error}</p><button type="button" className="btn-ghost mt-2" onClick={() => setReloadVersion(v => v + 1)}>Retry task queue</button></div> : loading ? <p className="text-sm text-muted">Loading tasks...</p> : shown.length === 0 ? (
        <EmptyState icon="clipboard" title={`No ${status} tasks`} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label={`${status} tasks`}>
          {shown.map((task) => {
            const inspection = inspections.find(i => i.id === task.sourceId);
            const product = data?.products.find(p => p.id === inspection?.productId);
            return <li key={task.id} className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-700">
                <Icon name={task.type === 'quality' ? 'scan' : 'alert'} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold text-ink">{task.title}</span>
                <span className="block break-all text-xs text-muted">{inspection ? `${product?.name ?? inspection.productId}${inspection.serialNumber ? ` · ${inspection.serialNumber}` : ''}` : task.sourceId}</span>
                <span className="block whitespace-nowrap text-xs text-faint">{task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : 'No due date'}</span>
                <Badge tone={status === 'blocked' ? 'amber' : status === 'completed' ? 'emerald' : 'brand'}>{status}</Badge>
              </span>
              <Link
                to={sourcePathForTask(task, status)}
                className="btn-ghost btn-sm col-start-2 justify-self-start sm:col-start-auto"
              >
                Open {task.type === 'cycle_count' ? 'count' : task.type} source
              </Link>
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
