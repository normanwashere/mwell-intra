'use client';

import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge,
  DataTable,
  EmptyState,
  HeroChipButton,
  InfoTip,
  ModuleHero,
  SectionTitle,
  money,
  type Column,
  type IconName,
  type Tone,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { ProcurementRequest, RequestStatus } from '../types';
import { useProcurementRequests } from '../localStore';
import { formatDate, statusLabel } from '../labels';
import { QueueFilters } from '../components/QueueFilters';

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
const columns: Column<ProcurementRequest>[] = [
  {
    key: 'title',
    header: 'Request',
    primary: true,
    sortable: true,
    sortValue: (row) => row.title,
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink">{row.title}</p>
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

type FilterKey = 'all' | 'draft' | 'submitted' | 'approved' | 'rejected';
const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'all requests',
  draft: 'drafts',
  submitted: 'in review',
  approved: 'approved',
  rejected: 'rejected',
};

export function RequestsPage() {
  const { rows, loading, error: readError, refresh } = useProcurementRequests();
  const { profile } = useSession();
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const filter = (params.get('filter') as FilterKey) ?? 'all';
  const visibleRows = useMemo(() => {
    switch (filter) {
      case 'draft':     return rows.filter((r) => r.status === 'draft');
      case 'submitted': return rows.filter((r) => r.status === 'submitted' || r.status === 'under_review');
      case 'approved':  return rows.filter((r) => r.status === 'approved');
      case 'rejected':  return rows.filter((r) => r.status === 'rejected');
      case 'all':
      default:          return rows;
    }
  }, [rows, filter]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const drafts = rows.filter((r) => r.status === 'draft').length;
    const submitted = rows.filter((r) => r.status === 'submitted' || r.status === 'under_review').length;
    const approved = rows.filter((r) => r.status === 'approved').length;
    const rejected = rows.filter((r) => r.status === 'rejected').length;
    return { total, drafts, submitted, approved, rejected };
  }, [rows]);

  const applyFilter = (next: FilterKey) => {
    if (next === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', next);
    }
    setParams(params, { replace: false });
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
  ];

  return (
    <div className="min-w-0 space-y-4">
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

      <QueueFilters items={filterCards} value={filter} onChange={applyFilter} />

      <div>
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
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={filter === 'all' ? 'No requests yet' : `No ${FILTER_LABEL[filter]}`}
            message={
              filter === 'all'
                ? 'Draft your first request — it will appear right here for the procurement officer to review.'
                : 'No requests match this status.'
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
            onRowClick={(row) => navigate(`/requests/${row.id}`)}
          />
        )}
      </div>
    </div>
  );
}
