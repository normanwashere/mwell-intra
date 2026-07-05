'use client';

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  DataTable,
  EmptyState,
  HeroChipButton,
  ModuleHero,
  SectionTitle,
  StatCard,
  type Column,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { ProcurementRequest, RequestStatus } from '../types';
import { useProcurementRequests } from '../localStore';

const STATUS_TONE: Record<RequestStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  cancelled: 'slate',
};

const columns: Column<ProcurementRequest>[] = [
  {
    key: 'title',
    header: 'Request',
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink">
          <Link to={`/requests/${row.id}`} className="hover:underline">
            {row.title}
          </Link>
        </p>
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
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
  {
    key: 'vendorName',
    header: 'Vendor',
    render: (row) => row.vendorName ?? '—',
  },
  {
    key: 'estimatedAmount',
    header: 'Est. total',
    render: (row) =>
      row.estimatedAmount != null
        ? `\u20b1${row.estimatedAmount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : '—',
  },
  {
    key: 'neededBy',
    header: 'Needed',
    render: (row) => (row.neededBy ? new Date(row.neededBy).toLocaleDateString() : '—'),
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row) => new Date(row.createdAt).toLocaleDateString(),
  },
];

export function RequestsPage() {
  const { rows, loading } = useProcurementRequests();
  const { profile } = useSession();
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';

  const kpis = useMemo(() => {
    const total = rows.length;
    const drafts = rows.filter((r) => r.status === 'draft').length;
    const submitted = rows.filter((r) => r.status === 'submitted' || r.status === 'under_review').length;
    const approved = rows.filter((r) => r.status === 'approved').length;
    const rejected = rows.filter((r) => r.status === 'rejected').length;
    return { total, drafts, submitted, approved, rejected };
  }, [rows]);

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Welcome back,"
        title={firstName}
        description="Raise, route and track purchase requests before PO authoring. Awards are gated on vendor accreditation."
        icon="cart"
        action={
          <Guard module="procurement" cap="create_request">
            <HeroChipButton href="/procurement/requests/new" icon="plus">
              New request
            </HeroChipButton>
          </Guard>
        }
        accessory={
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">
                Awaiting review
              </p>
              <p className="tnum text-2xl font-extrabold">
                {kpis.submitted}
                <span className="ml-1 text-sm font-medium text-brand-100/70">
                  of {kpis.total}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-brand-100/70">
                Approved
              </p>
              <p className="tnum text-2xl font-extrabold">{kpis.approved}</p>
            </div>
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total requests" value={kpis.total} icon="clipboard" tone="brand" hint="All statuses" />
        <StatCard label="Drafts" value={kpis.drafts} icon="pin" tone="slate" hint="Not yet submitted" />
        <StatCard label="Awaiting review" value={kpis.submitted} icon="rotate" tone="cyan" hint="With procurement" />
        <StatCard label="Approved" value={kpis.approved} icon="check" tone="emerald" hint="Ready for PO" />
      </div>

      <div>
        <SectionTitle
          title="Purchase requests"
          subtitle="Every draft you save appears here (persisted locally in this preview)."
        />

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No requests yet"
            message="Draft your first request — it will appear right here for the procurement officer to review."
            action={
              <Guard module="procurement" cap="create_request">
                <Link to="/requests/new" className="btn-primary">
                  Draft a request
                </Link>
              </Guard>
            }
          />
        ) : (
          <DataTable rows={rows} columns={columns} keyOf={(row) => row.id} />
        )}
      </div>
    </div>
  );
}
