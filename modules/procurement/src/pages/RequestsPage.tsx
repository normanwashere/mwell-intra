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
  StatCard,
  StaggerGrid,
  StaggerItem,
  money,
  type Column,
  type IconName,
  type Tone,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { ProcurementRequest, RequestStatus } from '../types';
import { useProcurementRequests } from '../localStore';
import { formatDate, statusLabel } from '../labels';

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
  const { rows, loading } = useProcurementRequests();
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

  // PR-1: ONE KPI surface. The StatCards below are the counts AND the
  // filters (active card ringed); the hero carries no numbers and the old
  // count-tabs row is gone.
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
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Welcome back,"
        title={firstName}
        description="Raise, route and track purchase requests."
        icon="cart"
        action={
          <Guard module="procurement" cap="create_request" fallback={null}>
            <HeroChipButton href="/procurement/requests/new" icon="plus">
              New request
            </HeroChipButton>
          </Guard>
        }
      />

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {filterCards.map((c) => {
          const active = filter === c.key;
          return (
            <StaggerItem
              key={c.key}
              className={
                active
                  ? 'rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-app'
                  : undefined
              }
            >
              <StatCard
                label={c.label}
                value={c.value}
                icon={c.icon}
                tone={c.tone}
                hint={active ? 'Showing below' : c.hint}
                onClick={() => applyFilter(c.key)}
              />
            </StaggerItem>
          );
        })}
      </StaggerGrid>

      <div>
        <SectionTitle
          title="Purchase requests"
          subtitle={
            filter === 'all'
              ? undefined
              : `Filtered to ${FILTER_LABEL[filter]} — tap a card above to change scope.`
          }
          action={
            <InfoTip
              label="About purchase requests"
              content="Requests route through a multi-tier approval ladder before PO authoring. Awards are gated on vendor accreditation."
            />
          }
        />

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={filter === 'all' ? 'No requests yet' : `No ${FILTER_LABEL[filter]}`}
            message={
              filter === 'all'
                ? 'Draft your first request — it will appear right here for the procurement officer to review.'
                : 'Nothing in this bucket right now. Tap a card above to see other requests.'
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
