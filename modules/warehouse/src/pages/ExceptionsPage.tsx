import { userFacingError } from '@intra/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { tasksReturnPath } from '@/domain/taskNavigation';
import type { QualityInspectionSummary, ResolveExceptionInput, StockChangeRequest, WarehouseException } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { Badge, EmptyState, Field, PageHeader, Sheet } from '@/components/ui';
import { loadCompleteControlQueue } from '@/domain/controlQueues';
import { exceptionPresentation } from './workSourcePresentation';

function commandKey(exceptionId: string, action: string) {
  return `exception-${exceptionId}-${action}-${Date.now()}`;
}

export function ExceptionsPage() {
  const { data, identityId, capabilities, can, canOpenRoute, loadExceptions, loadStockChangeRequests, loadQualityInspectionSummaries, resolveException } = useWarehouse();
  const [params, setParams] = useSearchParams();
  const [exceptions, setExceptions] = useState<WarehouseException[]>([]);
  const [requests, setRequests] = useState<StockChangeRequest[]>([]);
  const [inspections, setInspections] = useState<QualityInspectionSummary[]>([]);
  const sequence = useRef(0);
  const loaders = useRef({ loadExceptions, loadStockChangeRequests, loadQualityInspectionSummaries });
  useEffect(() => { loaders.current = { loadExceptions, loadStockChangeRequests, loadQualityInspectionSummaries }; });
  const accessScope = [...capabilities].sort().join('|');
  const mayReadChanges = canOpenRoute('approvals') || can('cycle_count') || can('manage_inventory');
  const mayReadQuality = canOpenRoute('quality');
  const [selected, setSelected] = useState<WarehouseException | null>(null);
  const [resolution, setResolution] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sourceId = params.get('source');
  const severity = params.get('severity') ?? 'all';
  const status = params.get('status') ?? 'open';
  const mayResolve = can('resolve_exceptions');
  const hasNonDefaultFilters = severity !== 'all' || status !== 'open';

  const reload = useCallback(async () => {
    if (!data) return;
    const current = ++sequence.current;
    setLoading(true);
    setLoadError(null);
    setExceptions([]);
    setRequests([]);
    setInspections([]);
    try {
      const rows = await loadCompleteControlQueue(loaders.current.loadExceptions);
      // Enrichment is read-only and caller-scoped. A denied detail read must not hide the queue.
      const [changes, quality] = await Promise.all([
        mayReadChanges && rows.some(e => e.sourceType === 'stock_change_request')
          ? loadCompleteControlQueue(loaders.current.loadStockChangeRequests).catch(() => []) : [],
        mayReadQuality && rows.some(e => e.sourceType === 'quality_inspection')
          ? loadCompleteControlQueue(loaders.current.loadQualityInspectionSummaries).catch(() => []) : [],
      ]);
      if (current !== sequence.current) return;
      setExceptions(rows);
      setRequests(changes);
      setInspections(quality);
    } catch (e) {
      if (current === sequence.current) setLoadError(e instanceof Error ? e.message : 'Exceptions could not be loaded.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [data, identityId, accessScope, mayReadChanges, mayReadQuality]);

  useEffect(() => { setSelected(null); void reload(); return () => { sequence.current += 1; }; }, [reload]);
  useEffect(() => setResolution(''), [selected]);

  const rows = useMemo(() => exceptions.filter((exception) =>
    sourceId ? exception.id === sourceId || exception.sourceId === sourceId :
    (severity === 'all' || exception.severity === severity) &&
    (status === 'all' || exception.status === status)), [exceptions, severity, status, sourceId]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all' || (key === 'status' && value === 'open')) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const act = async (action: ResolveExceptionInput['action']) => {
    if (!selected || submitting) return;
    if (['resolve', 'waive', 'cancel'].includes(action) && !resolution.trim()) return;
    setSubmitting(true);
    try {
      const ok = await resolveException({
        idempotencyKey: commandKey(selected.id, action),
        exceptionId: selected.id,
        action,
        ...(['resolve', 'waive', 'cancel'].includes(action) ? { resolution: resolution.trim() } : {}),
      });
      if (ok) {
        setSelected(null);
        await reload();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Warehouse exceptions" icon="alert" subtitle="Investigate operational risk, ownership, and resolution" />
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
        <Field label="Severity" htmlFor="exception-severity">
          <select id="exception-severity" className="input" value={severity} onChange={(event) => setFilter('severity', event.target.value)}>
            <option value="all">All severities</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
          </select>
        </Field>
        <Field label="Status" htmlFor="exception-status">
          <select id="exception-status" className="input" value={status} onChange={(event) => setFilter('status', event.target.value)}>
            <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="waived">Waived</option><option value="all">All statuses</option>
          </select>
        </Field>
      </div>

      {sourceId && <p className="break-all text-sm">Selected source: {sourceId} <Link to={tasksReturnPath(params)} className="btn-ghost btn-sm">Back to tasks</Link></p>}
      {loadError ? <div role="alert"><p>{userFacingError(loadError)}</p><button type="button" className="btn-ghost mt-2" onClick={() => void reload()}>Retry exceptions</button></div> : loading ? <p className="text-sm text-muted">Loading exceptions...</p> : rows.length === 0 ? (
        <EmptyState
          compact
          icon="check"
          title={sourceId ? 'Selected exception is unavailable or outside your access' : hasNonDefaultFilters ? 'No exceptions match these filters' : 'No open warehouse exceptions'}
          message={
            hasNonDefaultFilters
              ? `${exceptions.length} exception${exceptions.length === 1 ? '' : 's'} exist outside this view.`
              : 'New operational exceptions appear here automatically.'
          }
          action={
            hasNonDefaultFilters ? (
              <button type="button" className="btn-outline btn-sm" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Warehouse exceptions">
          {rows.map((exception) => {
            const { summary, context, source } = exceptionPresentation(data, exception, requests, inspections, canOpenRoute);
            return (
            <li key={exception.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={exception.severity === 'P1' ? 'rose' : exception.severity === 'P2' ? 'amber' : 'slate'}>{exception.severity}</Badge>
                  <p className="text-sm font-semibold capitalize text-ink">{exception.type.replace('_', ' ')}</p>
                  <Badge tone="slate">{exception.status.replace('_', ' ')}</Badge>
                </div>
                {summary && <p className="mt-1 text-sm font-medium text-ink [overflow-wrap:anywhere]">{summary}</p>}
                {context && <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{context}</p>}
                <details className="mt-1 text-xs text-muted [overflow-wrap:anywhere]"><summary className="cursor-pointer">Source reference</summary><code>{exception.sourceType}: {exception.sourceId}</code></details>
                <p className="mt-1 text-xs text-faint">Opened {exception.createdAt.slice(0, 10)} · Owner {exception.ownerId ?? 'Unassigned'}</p>
                {exception.type === 'po_receipt' && <p className="text-sm text-muted">An independent Lead must complete the controlled receipt decision before the next delivery. Beginning work alone does not release the PO line.</p>}
                {source ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300" to={source.path}>View source</Link>
                  : <p className="mt-2 text-sm text-muted">Source details unavailable or outside your access.</p>}
              </div>
              {mayResolve && exception.type !== 'po_receipt' && <button type="button" className="btn-primary btn-sm justify-center" onClick={() => setSelected(exception)}>Review exception</button>}
            </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        title="Resolve exception"
        description={selected ? `${selected.severity} · ${selected.type.replace('_', ' ')}` : undefined}
        footer={
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {selected?.severity !== 'P1' && <button type="button" className="btn-ghost justify-center" disabled={!resolution.trim() || submitting} onClick={() => void act('waive')}>Waive</button>}
            <button type="button" className="btn-ghost justify-center" disabled={submitting} onClick={() => void act('begin')}>Begin work</button>
            <button type="button" className="btn-primary justify-center" disabled={!resolution.trim() || submitting} onClick={() => void act('resolve')}>Resolve</button>
          </div>
        }
      >
        <div className="space-y-4">
          {selected?.severity === 'P1' && <p className="rounded-lg bg-rose-500/10 p-3 text-sm font-medium text-rose-700 dark:text-rose-300">P1 exceptions cannot be waived. Record a verified resolution or continue the investigation.</p>}
          <Field label="Resolution" htmlFor="exception-resolution" hint="Required to resolve, waive, or cancel an exception.">
            <textarea id="exception-resolution" className="input min-h-28 resize-y" value={resolution} onChange={(event) => setResolution(event.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
