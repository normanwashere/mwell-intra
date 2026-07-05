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
import type { AccreditationCase } from '../types';
import { computeCaseStatus, isExpiringSoon, useAccreditationCases } from '../localStore';

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
      render: (r) => (
        <Link to={`${basePath}/cases/${r.id}`} className="font-semibold text-ink hover:underline">
          {r.vendorName}
        </Link>
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

export function AccreditationCasesPage() {
  const { profile } = useSession();
  const { rows, loading } = useAccreditationCases();
  const isVendor = profile?.kind === 'vendor';
  const firstName =
    profile?.name?.split(/\s+/)[0] ?? (isVendor ? 'Vendor' : 'Legal');

  // Vendors see only their own case(s). Internal users see everything.
  const visible = useMemo(() => {
    if (!isVendor) return rows;
    return rows.filter((r) => r.vendorId === profile?.vendorId);
  }, [rows, isVendor, profile?.vendorId]);

  const kpis = useMemo(() => {
    const total = visible.length;
    const inReview = visible.filter((r) => r.status === 'submitted' || r.status === 'under_review').length;
    const approved = visible.filter((r) => r.status === 'approved').length;
    const expiringSoon = visible.filter((r) => isExpiringSoon(r.expiresAt, 30)).length;
    return { total, inReview, approved, expiringSoon };
  }, [visible]);

  const basePath = isVendor ? '/vendor' : '/legal';

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
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Expiring soon</p>
                <p className="tnum text-2xl font-extrabold">{kpis.expiringSoon}</p>
              </div>
            </>
          )
        }
      />

      {!isVendor && (
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Active cases" value={kpis.total} icon="clipboard" tone="brand" hint="Total in pipeline" />
          <StatCard label="Under review" value={kpis.inReview} icon="rotate" tone="amber" hint="Waiting on Legal" />
          <StatCard label="Approved" value={kpis.approved} icon="check" tone="emerald" hint="Vendors awarded" />
          <StatCard label="Expiring 30d" value={kpis.expiringSoon} icon="alert" tone="rose" hint="Renewals due" />
        </div>
      )}

      <div>
        <SectionTitle
          title={isVendor ? 'Your accreditation' : 'Accreditation cases'}
          subtitle={
            isVendor
              ? 'Documents and status for your organization only.'
              : 'All vendor cases across the pipeline. Click a row to review.'
          }
          action={
            !isVendor && (
              <Guard module="legal" cap="manage_checklist">
                <HeroChipButton href="/legal/invites/new" icon="plus">
                  Invite vendor
                </HeroChipButton>
              </Guard>
            )
          }
        />

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="building"
            title={isVendor ? 'No accreditation case yet' : 'No cases yet'}
            message={
              isVendor
                ? 'When Legal invites your organization, your case will appear here to fill out.'
                : 'Invite a vendor to start their onboarding — a case appears here once they submit.'
            }
            action={
              !isVendor && (
                <Guard module="legal" cap="manage_checklist">
                  <Link to="/invites/new" className="btn-primary">
                    Invite vendor
                  </Link>
                </Guard>
              )
            }
          />
        ) : (
          <DataTable rows={visible} columns={columns(basePath)} keyOf={(r) => r.id} />
        )}
      </div>
    </div>
  );
}
