'use client';

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
  const firstName = profile?.name?.split(/\s+/)[0] ?? (isVendor ? 'Vendor' : 'Legal');

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <ModuleHero
        eyebrow={isVendor ? 'Vendor portal,' : 'Welcome back,'}
        title={isVendor ? (profile?.name ?? 'Your organization') : firstName}
        description={
          isVendor
            ? 'Submit accreditation documents and track your review status. Every action is scoped to your vendor record.'
            : 'Review vendor accreditation intake, requirement checklists, and approvals. Approvals here unblock procurement PO awards.'
        }
        icon={isVendor ? 'building' : 'clipboard'}
        action={
          isVendor ? (
            <Guard module="core" cap="submit_accreditation">
              <HeroChipButton icon="plus" onClick={() => alert('Accreditation intake opens in Phase 2. This is a preview build.')}>
                Start accreditation
              </HeroChipButton>
            </Guard>
          ) : (
            <Guard module="legal" cap="manage_checklist">
              <HeroChipButton icon="plus" onClick={() => alert('Open a case from a vendor invite in Phase 2. This is a preview build.')}>
                Open a case
              </HeroChipButton>
            </Guard>
          )
        }
        accessory={
          isVendor ? undefined : (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">
                  Active cases
                </p>
                <p className="tnum text-2xl font-extrabold">{STUB_CASES.length}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-brand-100/70">
                  Expiring soon
                </p>
                <p className="tnum text-2xl font-extrabold">0</p>
              </div>
            </>
          )
        }
      />

      {!isVendor && (
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active cases" value={STUB_CASES.length} icon="clipboard" tone="brand" hint="Currently in review" />
          <StatCard label="Under review" value={0} icon="rotate" tone="amber" hint="Checklist in progress" />
          <StatCard label="Approved" value={0} icon="check" tone="emerald" hint="Vendors awarded" />
          <StatCard label="Expiring 30d" value={0} icon="alert" tone="rose" hint="Renewals due" />
        </div>
      )}

      <div>
        <SectionTitle
          title={isVendor ? 'Your accreditation' : 'Accreditation cases'}
          subtitle={
            isVendor
              ? 'Documents and status for your organization only.'
              : 'All vendor cases across the pipeline.'
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
          />
        ) : (
          <DataTable rows={STUB_CASES} columns={columns} keyOf={(row) => row.id} />
        )}
      </div>
    </div>
  );
}
