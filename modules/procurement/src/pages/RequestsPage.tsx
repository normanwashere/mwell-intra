'use client';

import { Link } from 'react-router-dom';
import {
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  type Column,
} from '@intra/ui';
import { Guard } from '@intra/auth';
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
  { key: 'title', header: 'Title', render: (row) => row.title },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
  { key: 'department', header: 'Department', render: (row) => row.department ?? '—' },
  {
    key: 'estimatedAmount',
    header: 'Est. amount',
    render: (row) =>
      row.estimatedAmount != null ? `₱${row.estimatedAmount.toLocaleString()}` : '—',
  },
  {
    key: 'createdAt',
    header: 'Created',
    render: (row) => new Date(row.createdAt).toLocaleDateString(),
  },
];

export function RequestsPage() {
  const { rows, loading } = useProcurementRequests();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Purchase requests"
        subtitle="Raise and track procurement requests before PO authoring."
        action={
          <Guard module="procurement" cap="create_request">
            <Link to="/requests/new" className="btn-primary">
              New request
            </Link>
          </Guard>
        }
      />

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No requests yet"
          message="Create a purchase request to start the procurement workflow."
          action={
            <Guard module="procurement" cap="create_request">
              <Link to="/requests/new" className="btn-primary">
                Create request
              </Link>
            </Guard>
          }
        />
      ) : (
        <DataTable rows={rows} columns={columns} keyOf={(row) => row.id} />
      )}
    </div>
  );
}
