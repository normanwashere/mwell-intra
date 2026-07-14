import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ResolveExceptionInput, WarehouseException } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { Badge, EmptyState, Field, PageHeader, Sheet } from '@/components/ui';

function commandKey(exceptionId: string, action: string) {
  return `exception-${exceptionId}-${action}-${Date.now()}`;
}

function sourcePath(exception: WarehouseException) {
  if (exception.sourceType === 'stock_change_request') return '/approvals';
  if (exception.type === 'quality') return '/quality';
  return '/cycle-counts';
}

export function ExceptionsPage() {
  const { can, loadExceptions, resolveException } = useWarehouse();
  const [params, setParams] = useSearchParams();
  const [exceptions, setExceptions] = useState<WarehouseException[]>([]);
  const [selected, setSelected] = useState<WarehouseException | null>(null);
  const [resolution, setResolution] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const severity = params.get('severity') ?? 'all';
  const status = params.get('status') ?? 'open';
  const mayResolve = can('resolve_exceptions');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setExceptions((await loadExceptions({ limit: 100 })).rows);
    } finally {
      setLoading(false);
    }
  }, [loadExceptions]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => setResolution(''), [selected]);

  const rows = useMemo(() => exceptions.filter((exception) =>
    (severity === 'all' || exception.severity === severity) &&
    (status === 'all' || exception.status === status)), [exceptions, severity, status]);

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

      {loading ? <p className="text-sm text-muted">Loading exceptions...</p> : rows.length === 0 ? (
        <EmptyState icon="check" title="No exceptions match these filters" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" aria-label="Warehouse exceptions">
          {rows.map((exception) => (
            <li key={exception.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={exception.severity === 'P1' ? 'rose' : exception.severity === 'P2' ? 'amber' : 'slate'}>{exception.severity}</Badge>
                  <p className="text-sm font-semibold capitalize text-ink">{exception.type.replace('_', ' ')}</p>
                  <Badge tone="slate">{exception.status.replace('_', ' ')}</Badge>
                </div>
                <p className="mt-1 text-xs text-faint">Opened {exception.createdAt.slice(0, 10)} · Owner {exception.ownerId ?? 'Unassigned'}</p>
                <Link className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300" to={sourcePath(exception)}>View source</Link>
              </div>
              {mayResolve && <button type="button" className="btn-primary btn-sm justify-center" onClick={() => setSelected(exception)}>Review exception</button>}
            </li>
          ))}
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
