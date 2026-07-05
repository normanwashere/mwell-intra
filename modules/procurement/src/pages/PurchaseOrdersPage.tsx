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
    render: (r) => (
      <Link to={`/purchase-orders/${r.id}`} className="font-semibold text-ink hover:underline">
        {r.poNumber}
      </Link>
    ),
  },
  { key: 'vendorName', header: 'Vendor', render: (r) => r.vendorName },
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

export function PurchaseOrdersPage() {
  const { rows, loading } = usePurchaseOrders();
  const { profile } = useSession();
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';

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

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Purchase orders,"
        title={firstName}
        description="Author, approve, and issue POs to accredited vendors. Warehouse receives against these — closing the request-to-receipt loop."
        icon="cart"
        action={
          <Guard module="procurement" cap="author_po">
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
        <StatCard label="Total POs" value={kpis.total} icon="cart" tone="brand" hint="All statuses" />
        <StatCard label="In authoring" value={kpis.drafts} icon="pin" tone="amber" hint="Draft + pending approval" />
        <StatCard label="Active" value={kpis.active} icon="rotate" tone="cyan" hint="Approved or issued" />
        <StatCard label="Closed" value={kpis.closed} icon="check" tone="emerald" hint="Fully received" />
      </div>

      <div>
        <SectionTitle title="Purchase orders" subtitle="Every PO drafted from an approved request." />
        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="cart"
            title="No purchase orders yet"
            message="Approve a request first — the PO authoring path opens from the request detail page."
            action={
              <Link to="/" className="btn-primary">
                See requests
              </Link>
            }
          />
        ) : (
          <DataTable rows={rows} columns={columns} keyOf={(r) => r.id} />
        )}
      </div>
    </div>
  );
}
