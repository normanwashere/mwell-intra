'use client';

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
import type { PurchaseOrder, PurchaseOrderStatus } from '../types';
import { usePurchaseOrders } from '../localStore';

const PO_TONE: Record<PurchaseOrderStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'cyan',
  issued: 'cyan',
  closed: 'emerald',
  cancelled: 'rose',
};

const columns: Column<PurchaseOrder>[] = [
  {
    key: 'poNumber',
    header: 'PO #',
    primary: true,
    render: (r) => (
      <Link to={`/purchase-orders/${r.id}`} className="font-semibold text-ink hover:underline">
        {r.poNumber}
        <span className="ml-2 text-xs font-normal text-muted">· {r.vendorName}</span>
      </Link>
    ),
  },
  { key: 'vendorName', header: 'Vendor', render: (r) => r.vendorName, hideOnMobile: true },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <Badge tone={PO_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>,
  },
  {
    key: 'total',
    header: 'Total',
    render: (r) =>
      `\u20b1${r.total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
  },
  {
    key: 'lines',
    header: 'Lines',
    render: (r) => `${r.lines.length} · ${r.lines.reduce((s, l) => s + l.receivedQuantity, 0)}/${r.lines.reduce((s, l) => s + l.quantity, 0)} received`,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    render: (r) => new Date(r.updatedAt).toLocaleDateString(),
  },
];

type PoFilter = 'all' | 'authoring' | 'active' | 'closed';
const PO_FILTERS: readonly { key: PoFilter; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'authoring', label: 'In authoring' },
  { key: 'active',    label: 'Active' },
  { key: 'closed',    label: 'Closed' },
];

export function PurchaseOrdersPage() {
  const { rows, loading } = usePurchaseOrders();
  const { profile } = useSession();
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as PoFilter) ?? 'all';

  const kpis = useMemo(() => {
    const total = rows.length;
    const drafts = rows.filter((r) => r.status === 'draft' || r.status === 'pending_approval').length;
    const active = rows.filter((r) => r.status === 'approved' || r.status === 'issued').length;
    const closed = rows.filter((r) => r.status === 'closed').length;
    const openValue = rows
      .filter((r) => r.status !== 'closed' && r.status !== 'cancelled')
      .reduce((s, r) => s + r.total, 0);
    return { total, drafts, active, closed, openValue };
  }, [rows]);

  const visibleRows = useMemo(() => {
    switch (filter) {
      case 'authoring': return rows.filter((r) => r.status === 'draft' || r.status === 'pending_approval');
      case 'active':    return rows.filter((r) => r.status === 'approved' || r.status === 'issued');
      case 'closed':    return rows.filter((r) => r.status === 'closed');
      case 'all':
      default:          return rows;
    }
  }, [rows, filter]);

  const applyFilter = (next: PoFilter) => {
    if (next === 'all') params.delete('filter');
    else params.set('filter', next);
    setParams(params, { replace: false });
  };

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Purchase orders,"
        title={firstName}
        description="Author, approve, and issue POs to accredited vendors. Warehouse receives against these — closing the request-to-receipt loop."
        icon="cart"
        action={
          <Guard module="procurement" cap="author_po" fallback={null}>
            <HeroChipButton href="/procurement/purchase-orders/new" icon="plus">
              New PO
            </HeroChipButton>
          </Guard>
        }
        accessory={
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Open POs</p>
              <p className="tnum text-2xl font-extrabold">{kpis.active + kpis.drafts}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Open value</p>
              <p className="tnum text-2xl font-extrabold">
                ₱{kpis.openValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </>
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total POs"
          value={kpis.total}
          icon="cart"
          tone="brand"
          hint="All statuses"
          onClick={() => applyFilter('all')}
        />
        <StatCard
          label="In authoring"
          value={kpis.drafts}
          icon="pin"
          tone="amber"
          hint="Draft + pending approval"
          onClick={() => applyFilter('authoring')}
        />
        <StatCard
          label="Active"
          value={kpis.active}
          icon="rotate"
          tone="cyan"
          hint="Approved or issued"
          onClick={() => applyFilter('active')}
        />
        <StatCard
          label="Closed"
          value={kpis.closed}
          icon="check"
          tone="emerald"
          hint="Fully received"
          onClick={() => applyFilter('closed')}
        />
      </div>

      <div>
        <SectionTitle
          title="Purchase orders"
          subtitle={
            filter === 'all'
              ? 'Every PO drafted from an approved request.'
              : `Filtered to ${PO_FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}. Switch filters below.`
          }
        />

        <div role="tablist" aria-label="Filter POs" className="mb-3 flex flex-wrap gap-1.5">
          {PO_FILTERS.map((f) => {
            const active = filter === f.key;
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
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="cart"
            title={filter === 'all' ? 'No purchase orders yet' : `No ${filter} POs`}
            message={
              filter === 'all'
                ? 'Approve a request first — the PO authoring path opens from the request detail page.'
                : 'Nothing in this bucket right now. Switch filters to see other POs.'
            }
            action={
              <Link to="/" className="btn-primary">
                See requests
              </Link>
            }
          />
        ) : (
          <DataTable
            rows={visibleRows}
            columns={columns}
            keyOf={(r) => r.id}
            onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
          />
        )}
      </div>
    </div>
  );
}
