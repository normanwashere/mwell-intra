'use client';

import {
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  type Column,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type { AccreditationCase } from '../types';

/** Stub read-model until the repository adapter lands (Step 3d). */
const STUB_CASES: AccreditationCase[] = [];

const STATUS_TONE: Record<
  AccreditationCase['status'],
  'slate' | 'amber' | 'emerald' | 'rose' | 'cyan'
> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  expired: 'rose',
  renewal_due: 'amber',
};

const columns: Column<AccreditationCase>[] = [
  { key: 'vendorName', header: 'Vendor', render: (row) => row.vendorName },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
  },
  {
    key: 'submittedAt',
    header: 'Submitted',
    render: (row) => row.submittedAt ?? '—',
  },
  {
    key: 'expiresAt',
    header: 'Expires',
    render: (row) => row.expiresAt ?? '—',
  },
];

export function AccreditationCasesPage() {
  const { profile } = useSession();
  const isVendor = profile?.kind === 'vendor';

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader
        title={isVendor ? 'Your accreditation' : 'Accreditation cases'}
        subtitle={
          isVendor
            ? 'Submit documents and track your vendor accreditation status.'
            : 'Review vendor accreditation intake, checklists, and approvals.'
        }
      />

      {STUB_CASES.length === 0 ? (
        <EmptyState
          icon="building"
          title={isVendor ? 'No accreditation case yet' : 'No cases yet'}
          message={
            isVendor
              ? 'Start your vendor accreditation submission when onboarding opens.'
              : 'Accreditation cases appear here once vendors submit intake forms.'
          }
          action={
            isVendor ? (
              <Guard module="legal" cap="submit_accreditation">
                <button type="button" className="btn-primary" disabled>
                  Start accreditation (stub)
                </button>
              </Guard>
            ) : undefined
          }
        />
      ) : (
        <DataTable rows={STUB_CASES} columns={columns} keyOf={(row) => row.id} />
      )}
    </div>
  );
}
