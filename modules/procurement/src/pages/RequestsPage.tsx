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
import type { ProcurementRequest } from '../types';

/** Stub read-model until the repository adapter lands (Step 3d). */
const STUB_REQUESTS: ProcurementRequest[] = [];

const columns: Column<ProcurementRequest>[] = [
  { key: 'title', header: 'Title', render: (row) => row.title },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone="slate">{row.status}</Badge>,
  },
  { key: 'department', header: 'Department', render: (row) => row.department ?? '—' },
  {
    key: 'estimatedAmount',
    header: 'Est. amount',
    render: (row) =>
      row.estimatedAmount != null ? `₱${row.estimatedAmount.toLocaleString()}` : '—',
  },
];

export function RequestsPage() {
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

      {STUB_REQUESTS.length === 0 ? (
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
        <DataTable rows={STUB_REQUESTS} columns={columns} keyOf={(row) => row.id} />
      )}
    </div>
  );
}
