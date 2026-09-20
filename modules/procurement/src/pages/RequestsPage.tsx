'use client';

import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge,
  DataTable,
  EmptyState,
  HeroChipButton,
  InfoTip,
  Icon,
  ModuleHero,
  SectionTitle,
  money,
  useListReturnPosition,
  type Column,
  type IconName,
  type Tone,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { RequestStatus } from '../types';
import { useProcurementRequests } from '../localStore';
import { formatDate, statusLabel } from '../labels';
import { QueueFilters } from '../components/QueueFilters';
import { filterRequests, readRequestList, requestDetailPath, sortRequests, type RequestListFilter, type RequestListRow } from '../requestList';
import { useRequestListRead } from '../requestListRead';
import { classifyRecord, recordPurposeLabel, RECORD_VIEWS } from '../../../../packages/data-kit/src/domain/testFixtures';

const STATUS_TONE: Record<RequestStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  cancelled: 'slate',
};

// PR-3: one interactive element per row — the row itself navigates (via
// DataTable onRowClick); the title is plain text, not a nested link.
const columns: Column<RequestListRow>[] = [
  {
    key: 'title',
    header: 'Request',
    primary: true,
    sortable: true,
    sortValue: (row) => row.title,
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink">{row.title}</p>
        <p className="break-words text-xs text-muted [overflow-wrap:anywhere]">{row.id}{row.references?.length ? ` / ${row.references.join(', ')}` : ''}</p>
        {recordPurposeLabel(row.classification ?? classifyRecord(row)) && <Badge tone="amber">{recordPurposeLabel(row.classification ?? classifyRecord(row))}</Badge>}
        {row.classification?.scenarioName && <p className="break-words text-xs text-muted">{row.classification.scenarioName}: starts {row.classification.startingState}; next actor {row.classification.nextActor}.</p>}
        <p className="text-xs text-muted">
          {row.lines.length} line{row.lines.length === 1 ? '' : 's'}
          {row.department ? ` · ${row.department}` : ''}
        </p>
      </div>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</Badge>,
  },
  {
    key: 'vendorName',
    header: 'Vendor',
    render: (row) => row.vendorName ?? '—',
  },
  {
    key: 'estimatedAmount',
    header: 'Est. total',
    sortable: true,
    sortValue: (row) => row.estimatedAmount ?? 0,
    render: (row) => (row.estimatedAmount != null ? money(row.estimatedAmount) : '—'),
  },
  {
    key: 'neededBy',
    header: 'Needed',
    sortable: true,
    sortValue: (row) => row.neededBy ?? '',
    render: (row) => (row.neededBy ? formatDate(row.neededBy) : '—'),
  },
  {
    key: 'createdAt',
    header: 'Created',
    sortable: true,
    sortValue: (row) => row.createdAt,
    render: (row) => formatDate(row.createdAt),
  },
];

type FilterKey = RequestListFilter;
const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'all requests',
  draft: 'drafts',
  submitted: 'in review',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

export function RequestsPage() {
  const { mode } = useSession();
  return mode === 'supabase' ? <LiveRequestsPage /> : <MemoryRequestsPage />;
}
function LiveRequestsPage() {
  const data = useRequestListRead();
  return <RequestsList {...data} />;
}
function MemoryRequestsPage() {
  const data = useProcurementRequests();
  return <RequestsList {...data} />;
}
function RequestsList({ rows, loading, error: readError, refresh }: {
  rows: RequestListRow[]; loading: boolean; error?: string; refresh: () => Promise<void>;
}) {
  const { profile } = useSession();
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const state = useMemo(() => readRequestList(params), [params]);
  const filter = state.filter;
  const matchingRows = filterRequests(rows, state, profile?.id ?? '');
  const visibleRows = sortRequests(matchingRows, state).slice(0, state.shown);
  const scopedRows = filterRequests(rows, { ...state, filter: 'all' }, profile?.id ?? '');
  const allRecordRows = filterRequests(rows, { ...state, records: 'all' }, profile?.id ?? '');
  const returnPosition = useListReturnPosition(`procurement-requests:${profile?.id}`, JSON.stringify(state), !loading && !readError);
  const update = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    if (!('shown' in patch)) next.delete('shown');
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace });
  };

  const kpis = useMemo(() => {
    const total = scopedRows.length;
    const drafts = scopedRows.filter((r) => r.status === 'draft').length;
    const submitted = scopedRows.filter((r) => r.status === 'submitted' || r.status === 'under_review').length;
    const approved = scopedRows.filter((r) => r.status === 'approved').length;
    const rejected = scopedRows.filter((r) => r.status === 'rejected').length;
    return { total, drafts, submitted, approved, rejected };
  }, [scopedRows]);

  const applyFilter = (next: FilterKey) => {
    update({ filter: next === 'all' ? '' : next });
  };

  // Counts and filters share one compact queue control.
  const filterCards: Array<{
    key: FilterKey;
    label: string;
    value: number;
    icon: IconName;
    tone: Tone;
    hint: string;
  }> = [
    { key: 'all',       label: 'Total requests',  value: kpis.total,     icon: 'clipboard', tone: 'brand',   hint: 'All statuses' },
    { key: 'draft',     label: 'Drafts',          value: kpis.drafts,    icon: 'edit',      tone: 'slate',   hint: 'Not yet submitted' },
    { key: 'submitted', label: 'In review',       value: kpis.submitted, icon: 'rotate',    tone: 'cyan',    hint: 'On the approval ladder' },
    { key: 'approved',  label: 'Approved',        value: kpis.approved,  icon: 'check',     tone: 'emerald', hint: 'Ready for PO' },
    { key: 'rejected', label: 'Rejected', value: kpis.rejected, icon: 'clipboard', tone: 'rose', hint: 'Rejected requests' },
    { key: 'cancelled', label: 'Cancelled', value: scopedRows.filter(row => row.status === 'cancelled').length, icon: 'clipboard', tone: 'slate', hint: 'Cancelled requests' },
  ];

  return (
    <div ref={returnPosition.ref} onClickCapture={returnPosition.onClickCapture} className="min-w-0 space-y-4">
      <ModuleHero
        eyebrow="Procurement workspace"
        title="Purchase requests"
        description={`Welcome back, ${firstName}. Raise, route and track governed purchase requests.`}
        icon="cart"
        action={
          <Guard module="procurement" cap="create_request" fallback={null}>
            <HeroChipButton href="/procurement/requests/new" icon="plus">
              New request
            </HeroChipButton>
          </Guard>
        }
      />

      {!loading && !readError && <QueueFilters items={filterCards} value={filter} onChange={applyFilter} />}
      <div className="grid min-w-0 gap-3 border-b border-line pb-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 text-sm font-medium sm:col-span-2">Search requests
          <input type="search" className="input mt-1 w-full" maxLength={120} placeholder="Request reference, title, PO or vendor" value={state.search} onChange={event => update({ q: event.target.value }, true)} />
        </label>
        <label className="min-w-0 text-sm font-medium">Ownership<select className="input mt-1 w-full" value={state.owner} onChange={event => update({ owner: event.target.value })}><option value="all">All authorized requests</option><option value="mine">Requested by me</option></select></label>
        <label className="min-w-0 text-sm font-medium">Records<select className="input mt-1 w-full" value={state.records} onChange={event => update({ records: event.target.value })}>{RECORD_VIEWS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="min-w-0 text-sm font-medium">Created from<input type="date" className="input mt-1 w-full" value={state.from} onChange={event => update({ from: event.target.value })} /></label>
        <label className="min-w-0 text-sm font-medium">Created through<input type="date" className="input mt-1 w-full" value={state.to} onChange={event => update({ to: event.target.value })} /></label>
        <button type="button" className="btn-outline self-end justify-self-start" disabled={loading} onClick={() => void refresh()}><Icon name="rotate" className="h-4 w-4" />Refresh</button>
      </div>
      {!loading && !readError && <p role="status" className="text-sm text-muted">Showing {visibleRows.length} of {matchingRows.length} matching requests; {rows.length} authorized requests searched.{allRecordRows.length > matchingRows.length ? ` ${allRecordRows.length - matchingRows.length} outside this record view.` : ''}</p>}
      {state.records === 'scenario-ready' && <p className="text-sm text-muted">Readiness is declared in fixture metadata; workflow checkpoints are not verified here.</p>}

      <div role="region" aria-label="Purchase request results" aria-busy={loading}>
        <SectionTitle
          title="Purchase requests"
          subtitle={
            filter === 'all'
              ? undefined
              : `Filtered to ${FILTER_LABEL[filter]}`
          }
          action={
            <InfoTip
              label="About purchase requests"
              content="Requests route through a multi-tier approval ladder before PO authoring. Awards are gated on vendor accreditation."
            />
          }
        />

        {readError ? <div role="alert"><p>{readError}</p><button type="button" className="btn-outline" disabled={loading} onClick={() => void refresh()}>Retry requests</button></div> : loading ? (
          <><p role="status" className="text-sm text-muted">Loading requests...</p><div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden /></>
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={rows.length ? 'No matching requests' : 'No requests yet'}
            message={
              !rows.length
                ? 'Draft your first request — it will appear right here for the procurement officer to review.'
                : 'No requests match the current search and filters.'
            }
            action={
              <Guard module="procurement" cap="create_request" fallback={null}>
                <Link to="/requests/new" className="btn-primary">
                  Draft a request
                </Link>
              </Guard>
            }
          />
        ) : (
          <DataTable
            density="compact"
            rows={visibleRows}
            columns={columns}
            keyOf={(row) => row.id}
            sortKey={state.sort}
            sortDir={state.dir}
            onSortChange={(sort, dir) => update({ sort, dir })}
            onRowClick={(row) => { returnPosition.remember(); navigate(requestDetailPath(row.id, params)); }}
          />
        )}
        {!loading && !readError && visibleRows.length < matchingRows.length && <button type="button" className="btn-outline mt-3" onClick={() => update({ shown: String(Math.min(state.shown + 50, matchingRows.length)) })}><Icon name="plus" className="h-4 w-4" />Show more requests</button>}
      </div>
    </div>
  );
}
