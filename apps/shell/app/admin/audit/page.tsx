"use client";

import { useEffect, useMemo, useState } from "react";
import { Guard, useSession } from "@intra/auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from "@intra/ui";
import { AdminHeader } from '../AdminHeader';
import { auditPageCsv, type AuditPage } from '@shell/lib/adminAuditQuery';
import {
  auditActorLabel,
  auditEntityLabel,
  auditEventSummary,
} from "@shell/lib/auditPresentation";

export default function AdminAuditPage() {
  return (
    <Guard module="core" cap="view_audit">
      <AdminAuditInner />
    </Guard>
  );
}

function AdminAuditInner() {
  const { mode, profile } = useSession();
  const [result, setResult] = useState<AuditPage | null>(null);
  const actors = useMemo(() => new Map(Object.entries(result?.actors ?? {})), [result]);
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ query: '', module: '', from: '', to: '' });
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const [snapshot, setSnapshot] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === "supabase");
  const before = cursors[cursors.length - 1];
  useEffect(() => {
    if (mode !== 'supabase') return;
    const controller = new AbortController();
    setResult(null);
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ q: filters.query, module: filters.module, from: filters.from, to: filters.to });
    if (before !== null) params.set('before', String(before));
    if (snapshot !== null) params.set('snapshot', String(snapshot));
    void (async () => {
      try {
        const response = await fetch(`/api/admin/audit?${params}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Audit history could not be loaded.');
        if (!controller.signal.aborted) setResult(body as AuditPage);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Audit history could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [mode, profile?.id, filters, before, snapshot, retry]);

  const filtered = result?.rows ?? [];
  const draftChanged = query !== filters.query || moduleFilter !== filters.module || from !== filters.from || to !== filters.to;

  const exportCsv = () => {
    if (!result || mode !== 'supabase' || loading || error || draftChanged) return;
    const csv = auditPageCsv(result);
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `mwell-intra-audit-page-${cursors.length}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <AdminHeader
        title="Audit history"
        action={
          <Button variant="outline" onClick={exportCsv} disabled={mode !== 'supabase' || !filtered.length || loading || Boolean(error) || draftChanged}>
            Export current page CSV
          </Button>
        }
      />
      <form className="border-b border-line pb-4" onSubmit={event => {
        event.preventDefault();
        setResult(null); setLoading(true); setCursors([null]); setSnapshot(null);
        setFilters({ query, module: moduleFilter, from, to });
      }}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Search audit history" htmlFor="audit-search">
            <Input
              id="audit-search"
              type="search"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Actor, action, entity, reference"
            />
          </Field>
          <Field label="Module" htmlFor="audit-module">
            <Input
              id="audit-module"
              value={moduleFilter}
              maxLength={80}
              placeholder="All modules"
              list="audit-modules"
              onChange={(event) => setModuleFilter(event.target.value)}
            />
            <datalist id="audit-modules">
              {['core', 'warehouse', 'procurement', 'legal', 'events', 'product', 'finance', 'learning', 'insights'].map(name => <option key={name} value={name} />)}
            </datalist>
          </Field>
          <Field label="From (UTC+08)" htmlFor="audit-from"><Input id="audit-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
          <Field label="Through (UTC+08)" htmlFor="audit-to"><Input id="audit-to" type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" icon="search" disabled={mode !== 'supabase'}>Search</Button>
          <p className="text-sm text-muted">Retained authorized events · {filters.from || 'Earliest retained'} to {filters.to || 'Latest retained'} · Newest recorded first</p>
          {draftChanged && <p role="status" className="text-sm text-muted">Unapplied filters</p>}
        </div>
      </form>
      {mode !== 'supabase' ? <p role="status">Audit history is unavailable in this read-only preview.</p> : error ? (
        <div role="alert" className="border-l-4 border-rose-500 bg-rose-50 p-4 text-rose-900">
          <p className="font-semibold">Audit history unavailable</p><p>{error}</p>
          <Button className="mt-3" variant="outline" icon="rotate" onClick={() => setRetry(value => value + 1)}>Retry audit history</Button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="shield"
          title={result?.searchPending ? 'Search unfinished' : 'No matching audit events'}
          message={result?.searchPending ? 'No matches in this segment. Older retained events remain to be searched.' : 'No matches in the remaining authorized history for these filters.'}
        />
      ) : (
        <ol className="min-w-0 max-w-full space-y-3">
          {filtered.map((row) => (
            <li key={row.id} className="min-w-0 max-w-full">
              <Card className="min-w-0 max-w-full overflow-hidden p-4">
                <div className="flex min-w-0 max-w-full flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 max-w-full flex-1">
                    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                      <Badge tone="brand">{row.module || "Platform"}</Badge>
                      <h2 className="min-w-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                        {auditEventSummary(row)}
                      </h2>
                    </div>
                    <p
                      data-testid="audit-entity-reference"
                      className="mt-2 max-w-full break-words text-sm text-muted [overflow-wrap:anywhere]"
                    >
                      {auditEntityLabel(row)}
                    </p>
                  </div>
                  <time className="text-xs text-faint" dateTime={row.created_at}>
                    {new Date(row.created_at).toLocaleString("en-PH")}
                  </time>
                </div>
                <p className="mt-3 max-w-full break-words text-sm text-muted [overflow-wrap:anywhere]">
                  Performed by {auditActorLabel(row.actor, actors)}
                </p>
                <details className="mt-3 border-t border-line pt-3 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand-700">
                    Technical details
                  </summary>
                  <dl className="grid gap-2 rounded-md bg-inset p-3 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <dt className="font-semibold text-muted">Reference</dt>
                    <dd className="break-all font-mono text-ink">
                      {row.entity_id || "unavailable"}
                    </dd>
                    <dt className="font-semibold text-muted">Event code</dt>
                    <dd className="break-all font-mono text-ink">
                      {row.action || "unavailable"}
                    </dd>
                    <dt className="font-semibold text-muted">Actor ID</dt>
                    <dd className="break-all font-mono text-ink">{row.actor || "system"}</dd>
                  </dl>
                  {row.detail && (
                    <pre
                      data-testid="audit-event-detail"
                      className="mt-2 max-h-48 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-inset p-3 text-xs text-muted [overflow-wrap:anywhere]"
                    >
                      {JSON.stringify(row.detail, null, 2)}
                    </pre>
                  )}
                </details>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {result && !loading && !error && mode === 'supabase' && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p role="status" className="text-sm text-muted">Page {cursors.length} · {filtered.length} events on this page · {result.scanned} retained events checked · {result.searchPending ? 'Search unfinished: older history remains' : result.next === null ? 'End of matching history' : 'More matching events available'}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={cursors.length === 1 || draftChanged} onClick={() => { setLoading(true); setCursors(value => value.slice(0, -1)); }}>Previous</Button>
          <Button variant="outline" disabled={result.next === null || draftChanged} onClick={() => { setLoading(true); setSnapshot(result.snapshot); setCursors(value => [...value, result.next]); }}>{result.searchPending ? 'Continue searching' : 'Older results'}</Button>
        </div>
      </div>}
    </div>
  );
}
