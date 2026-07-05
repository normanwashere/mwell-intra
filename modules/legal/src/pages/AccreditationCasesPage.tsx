'use client';

// Reviewer inbox (T1.6) — cases bucketed by what unblocks them next:
// Waiting on vendor / Waiting on Legal / Ready for decision / Renewals.
// Buckets are derived from checklist + document + signed-instrument state
// (caseLogic.deriveInboxBucket), so a case moves buckets the moment the
// vendor uploads or Legal reviews.

import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import type { AccreditationCase, InboxBucket } from '../types';
import { JURISDICTION_LABEL } from '../types';
import {
  computeCaseStatus,
  isExpiringSoon,
  useAccreditationCases,
  useAccreditationDocs,
  useChecklist,
  useSignedInstruments,
} from '../localStore';
import { deriveInboxBucket, INBOX_BUCKET_LABEL } from '../caseLogic';

const STATUS_TONE: Record<
  string,
  'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'
> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  expired: 'rose',
  renewal_due: 'amber',
};

function columns(basePath: string): Column<AccreditationCase>[] {
  return [
    {
      key: 'vendorName',
      header: 'Vendor',
      primary: true,
      render: (r) => (
        <div className="min-w-0">
          <Link to={`${basePath}/cases/${r.id}`} className="font-semibold text-ink hover:underline">
            {r.vendorName}
          </Link>
          {r.jurisdiction && (
            <span className="ml-2 inline-flex items-center rounded-full bg-inset px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
              {r.jurisdiction === 'OTHER' && r.originCountry
                ? r.originCountry
                : JURISDICTION_LABEL[r.jurisdiction]}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const s = computeCaseStatus(r);
        return <Badge tone={STATUS_TONE[s] ?? 'slate'}>{s.replace('_', ' ')}</Badge>;
      },
    },
    { key: 'category', header: 'Category', render: (r) => r.category ?? '—' },
    {
      key: 'submittedAt',
      header: 'Submitted',
      render: (r) => (r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—'),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      render: (r) => (r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—'),
    },
  ];
}

type CaseFilter = 'all' | InboxBucket;
const CASE_FILTERS: readonly { key: CaseFilter; label: string }[] = [
  { key: 'all', label: 'All cases' },
  { key: 'waiting_on_vendor', label: INBOX_BUCKET_LABEL.waiting_on_vendor },
  { key: 'waiting_on_legal', label: INBOX_BUCKET_LABEL.waiting_on_legal },
  { key: 'ready_for_decision', label: INBOX_BUCKET_LABEL.ready_for_decision },
  { key: 'renewal_due', label: INBOX_BUCKET_LABEL.renewal_due },
];

export function AccreditationCasesPage() {
  const { profile } = useSession();
  const { rows, loading } = useAccreditationCases();
  const { rows: allChecklist } = useChecklist();
  const { rows: allDocs } = useAccreditationDocs();
  const { rows: allSigned } = useSignedInstruments();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isVendor = profile?.kind === 'vendor';
  const firstName =
    profile?.name?.split(/\s+/)[0] ?? (isVendor ? 'Vendor' : 'Legal');
  const filter = (params.get('filter') as CaseFilter) ?? 'all';

  // Vendors see only their own case(s). Internal users see everything.
  const visible = useMemo(() => {
    if (!isVendor) return rows;
    return rows.filter((r) => r.vendorId === profile?.vendorId);
  }, [rows, isVendor, profile?.vendorId]);

  const bucketOf = useMemo(() => {
    const map = new Map<string, InboxBucket | null>();
    for (const kase of visible) {
      const items = allChecklist.filter((i) => i.caseId === kase.id);
      const evidence = {
        docs: allDocs.filter((d) => d.caseId === kase.id),
        signed: allSigned.filter((s) => s.caseId === kase.id),
      };
      map.set(kase.id, deriveInboxBucket(kase, items, evidence));
    }
    return map;
  }, [visible, allChecklist, allDocs, allSigned]);

  const bucketCounts = useMemo(() => {
    const counts: Record<InboxBucket, number> = {
      waiting_on_vendor: 0,
      waiting_on_legal: 0,
      ready_for_decision: 0,
      renewal_due: 0,
    };
    for (const bucket of bucketOf.values()) {
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [bucketOf]);

  const kpis = useMemo(() => {
    const total = visible.length;
    const approved = visible.filter((r) => r.status === 'approved').length;
    const expiringSoon = visible.filter((r) => isExpiringSoon(r.expiresAt, 30)).length;
    return { total, approved, expiringSoon };
  }, [visible]);

  const filteredVisible = useMemo(() => {
    if (filter === 'all') return visible;
    return visible.filter((r) => bucketOf.get(r.id) === filter);
  }, [visible, filter, bucketOf]);

  const basePath = isVendor ? '/vendor' : '/legal';

  const applyFilter = (next: CaseFilter) => {
    if (next === 'all') params.delete('filter');
    else params.set('filter', next);
    setParams(params, { replace: false });
  };

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow={isVendor ? 'Vendor portal,' : 'Welcome back,'}
        title={isVendor ? profile?.name ?? 'Your organization' : firstName}
        description={
          isVendor
            ? 'Submit accreditation documents and track your review status. Every action is scoped to your vendor record.'
            : 'Review vendor accreditation intake, requirement checklists, and approvals. Approvals here unblock procurement PO awards.'
        }
        icon={isVendor ? 'building' : 'clipboard'}
        accessory={
          isVendor ? undefined : (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Active cases</p>
                <p className="tnum text-2xl font-extrabold">{kpis.total}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Waiting on you</p>
                <p className="tnum text-2xl font-extrabold">
                  {bucketCounts.waiting_on_legal + bucketCounts.ready_for_decision}
                </p>
              </div>
            </>
          )
        }
      />

      {!isVendor && (
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Waiting on vendor"
            value={bucketCounts.waiting_on_vendor}
            icon="building"
            tone="slate"
            hint="Docs / signatures outstanding"
            onClick={() => applyFilter('waiting_on_vendor')}
          />
          <StatCard
            label="Waiting on Legal"
            value={bucketCounts.waiting_on_legal}
            icon="rotate"
            tone="amber"
            hint="Evidence needs your review"
            onClick={() => applyFilter('waiting_on_legal')}
          />
          <StatCard
            label="Ready for decision"
            value={bucketCounts.ready_for_decision}
            icon="signature"
            tone="emerald"
            hint="All required items approved"
            onClick={() => applyFilter('ready_for_decision')}
          />
          <StatCard
            label="Renewals"
            value={bucketCounts.renewal_due}
            icon="alert"
            tone="rose"
            hint="Expiring within 30 days"
            onClick={() => applyFilter('renewal_due')}
          />
        </div>
      )}

      <div>
        <SectionTitle
          title={isVendor ? 'Your accreditation' : 'Accreditation cases'}
          subtitle={
            isVendor
              ? 'Documents and status for your organization only.'
              : filter === 'all'
                ? 'All vendor cases across the pipeline. Tap a row to review.'
                : `Filtered to ${CASE_FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}.`
          }
          action={
            !isVendor && (
              <Guard module="legal" cap="manage_checklist" fallback={null}>
                <HeroChipButton href="/legal/invites/new" icon="plus">
                  Invite vendor
                </HeroChipButton>
              </Guard>
            )
          }
        />

        {!isVendor && (
          <div role="tablist" aria-label="Filter cases" className="mb-3 flex flex-wrap gap-1.5">
            {CASE_FILTERS.map((f) => {
              const active = filter === f.key;
              const count =
                f.key === 'all' ? visible.length : bucketCounts[f.key];
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => applyFilter(f.key)}
                  className={
                    active
                      ? 'chip bg-brand-500/15 text-brand-700 dark:text-brand-300'
                      : 'chip bg-inset text-muted hover:text-ink'
                  }
                >
                  {f.label}
                  <span className="ml-1 tnum opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : filteredVisible.length === 0 ? (
          <EmptyState
            icon="building"
            title={isVendor ? 'No accreditation case yet' : 'No cases in this bucket'}
            message={
              isVendor
                ? 'When Legal invites your organization, your case will appear here to fill out.'
                : filter === 'all'
                  ? 'Invite a vendor to start their onboarding — a case appears here once they submit.'
                  : 'Nothing here right now. Switch buckets above to see other cases.'
            }
            action={
              !isVendor && (
                <Guard module="legal" cap="manage_checklist" fallback={null}>
                  <Link to="/invites/new" className="btn-primary">
                    Invite vendor
                  </Link>
                </Guard>
              )
            }
          />
        ) : (
          <DataTable
            rows={filteredVisible}
            columns={columns(basePath)}
            keyOf={(r) => r.id}
            onRowClick={(r) => navigate(`/cases/${r.id}`)}
          />
        )}
      </div>
    </div>
  );
}
