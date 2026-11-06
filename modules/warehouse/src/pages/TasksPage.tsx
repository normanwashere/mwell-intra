import { userFacingError } from '@intra/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import type { WarehouseException, WarehouseTask, QualityInspectionSummary, StockChangeRequest } from '@intra/data-kit';
import { useSession } from '@intra/auth';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { loadCompleteControlQueue } from '@/domain/controlQueues';
import { exceptionPresentation, productIdentity, sourceIdentity } from './workSourcePresentation';

import { parseTaskStatus, sourcePathForTask, type TaskStatus } from '@/domain/taskNavigation';

export function TasksPage() {
  const { data, identityId, capabilities, can, canOpenRoute, loadWarehouseTasks, loadQualityInspectionSummaries, loadExceptions, loadStockChangeRequests } = useWarehouse();
  const { mode, supabaseClient } = useSession();
  const loaders = useRef({ tasks: loadWarehouseTasks, inspections: loadQualityInspectionSummaries, exceptions: loadExceptions, requests: loadStockChangeRequests });
  const accessScope = [...capabilities].sort().join('|');
  useEffect(() => { loaders.current = { tasks: loadWarehouseTasks, inspections: loadQualityInspectionSummaries, exceptions: loadExceptions, requests: loadStockChangeRequests }; });
  const mayReadExceptions = canOpenRoute('exceptions');
  const mayReadChanges = can('approve_stock_adjustment') || can('approve_stock_adjustment_finance');
  const [params, setParams] = useSearchParams();
  const status = parseTaskStatus(params.get('status'));
  const setStatus = (next: TaskStatus) => {
    const updated = new URLSearchParams(params);
    updated.set('status', parseTaskStatus(next));
    setParams(updated);
  };
  const [tasks, setTasks] = useState<WarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspections, setInspections] = useState<QualityInspectionSummary[]>([]);
  const [exceptions, setExceptions] = useState<WarehouseException[]>([]);
  const [requests, setRequests] = useState<StockChangeRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    // Wait for bootstrap and ignore provider callback churn between real data changes.
    if (!data) return;
    let active = true;
    setLoading(true);
    setError(null);
    setTasks([]);
    setInspections([]);
    setExceptions([]);
    setRequests([]);
    void Promise.all([loadCompleteControlQueue(loaders.current.tasks), loadCompleteControlQueue(loaders.current.inspections)])
      .then(async ([rows, quality]) => {
        const exceptionRows = mayReadExceptions && rows.some(t => t.type === 'exception')
          ? await loadCompleteControlQueue(loaders.current.exceptions).catch(() => []) : [];
        const changes = mayReadChanges && exceptionRows.some(e => e.sourceType === 'stock_change_request')
          ? await loadCompleteControlQueue(loaders.current.requests).catch(() => []) : [];
        if (active) { setTasks(rows); setInspections(quality); setExceptions(exceptionRows); setRequests(changes); }
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Tasks could not be loaded.'); })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data, identityId, mode, supabaseClient, accessScope, reloadVersion, mayReadExceptions, mayReadChanges]);

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
      {error ? <div role="alert"><p>{userFacingError(error)}</p><button type="button" className="btn-ghost mt-2" onClick={() => setReloadVersion(v => v + 1)}>Retry task queue</button></div> : loading ? <p className="text-sm text-muted">Loading tasks...</p> : shown.length === 0 ? (
        <EmptyState icon="clipboard" title={`No ${status} tasks`} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label={`${status} tasks`}>
          {shown.map((task) => {
            const inspection = inspections.find(i => i.id === task.sourceId);
            const receipt = data?.receipts.find(r => r.id === task.sourceId);
            const count = data?.cycleCounts.find(c => c.id === task.sourceId);
            const exception = exceptions.find(e => e.id === task.sourceId);
            const detail = exception ? exceptionPresentation(data, exception, requests, inspections, canOpenRoute) : undefined;
            const title = task.title.includes(task.sourceId) || /[0-9a-f]{8}-[0-9a-f-]{27}/i.test(task.title)
              ? { quality: 'Inspect quality', putaway: 'Put away accepted stock', cycle_count: 'Review cycle count', exception: 'Review warehouse exception' }[task.type]
              : task.title;
            const summary = inspection ? productIdentity(data, inspection.productId)
              : receipt ? [...new Set(receipt.lines.map(l => productIdentity(data, l.productId)))].join('; ')
                : count ? [...new Set(count.lines.map(l => productIdentity(data, l.productId)))].join('; ') : detail?.summary;
            const context = inspection ? [sourceIdentity(data, inspection.sourceType, inspection.sourceId), inspection.serialNumber].filter(Boolean).join(' / ')
              : receipt ? sourceIdentity(data, 'receipt', receipt.id)
                : count ? sourceIdentity(data, 'cycle_count', count.id) : detail?.context;
            const routeId = task.type === 'quality' ? 'quality' : task.type === 'putaway' ? 'storage'
              : task.type === 'cycle_count' ? 'cycle-counts' : 'exceptions';
            return <li key={task.id} className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-700">
                <Icon name={task.type === 'quality' ? 'scan' : 'alert'} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block break-words text-sm font-semibold text-ink">{title}</span>
                {summary && <span className="mt-1 block text-sm text-ink [overflow-wrap:anywhere]">{summary}</span>}
                {context && <span className="mt-1 block text-xs text-muted [overflow-wrap:anywhere]">{context}</span>}
                {!summary && !context && <span className="block text-xs text-muted">Source details unavailable or outside your access.</span>}
                <details className="my-1 text-xs text-muted [overflow-wrap:anywhere]"><summary className="cursor-pointer">Source reference</summary><code>{task.sourceId}</code></details>
                <span className="block whitespace-nowrap text-xs text-faint">{task.dueAt ? `Due ${task.dueAt.slice(0, 10)}` : 'No due date'}</span>
                <Badge tone={status === 'blocked' ? 'amber' : status === 'completed' ? 'emerald' : 'brand'}>{status}</Badge>
              </div>
              {canOpenRoute(routeId) ? <Link
                to={sourcePathForTask(task, status)}
                className="btn-ghost btn-sm col-start-2 justify-self-start sm:col-start-auto"
              >
                Open {task.type === 'cycle_count' ? 'count' : task.type} source
              </Link> : <span className="col-start-2 text-sm text-muted">Source access is not available for your role.</span>}
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
