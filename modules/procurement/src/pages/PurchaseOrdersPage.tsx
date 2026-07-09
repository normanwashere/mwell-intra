'use client';

import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge,
  DataTable,
  EmptyState,
  HeroChipButton,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  StatCard,
  StaggerGrid,
  StaggerItem,
  money,
  useToast,
  type Column,
  type IconName,
  type Tone,
} from '@intra/ui';
import { useCan, useSession } from '@intra/auth';
import type { PurchaseOrder, PurchaseOrderStatus } from '../types';
import { usePurchaseOrders } from '../localStore';
import { downloadCsv, purchaseOrdersToCsv } from '../export';
import { formatDate, poStatusLabel } from '../labels';
import { ProcurementAccessDenied } from '../components/ProcurementAccessDenied';

const PO_TONE: Record<PurchaseOrderStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'cyan',
  issued: 'cyan',
  closed: 'emerald',
  cancelled: 'rose',
};

// PR-3 treatment applied here too: the row navigates; no nested link.
const columns: Column<PurchaseOrder>[] = [
  {
    key: 'poNumber',
    header: 'PO #',
    primary: true,
    sortable: true,
    sortValue: (r) => r.poNumber,
    render: (r) => (
      <span className="font-semibold text-ink">
        {r.poNumber}
        <span className="ml-2 text-xs font-normal text-muted">· {r.vendorName}</span>
      </span>
    ),
  },
  { key: 'vendorName', header: 'Vendor', render: (r) => r.vendorName, hideOnMobile: true },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <Badge tone={PO_TONE[r.status]}>{poStatusLabel(r.status)}</Badge>,
  },
  {
    key: 'total',
    header: 'Total',
    sortable: true,
    sortValue: (r) => r.total,
    render: (r) => money(r.total),
  },
  {
    key: 'lines',
    header: 'Lines',
    render: (r) => `${r.lines.length} · ${r.lines.reduce((s, l) => s + l.receivedQuantity, 0)}/${r.lines.reduce((s, l) => s + l.quantity, 0)} received`,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    sortable: true,
    sortValue: (r) => r.updatedAt,
    render: (r) => formatDate(r.updatedAt),
  },
];

type PoFilter = 'all' | 'authoring' | 'active' | 'closed';
const PO_FILTER_LABEL: Record<PoFilter, string> = {
  all: 'all POs',
  authoring: 'POs in authoring',
  active: 'active POs',
  closed: 'closed POs',
};

export function PurchaseOrdersPage() {
  const { rows, loading } = usePurchaseOrders();
  const { profile } = useSession();
  const { success } = useToast();
  const canAuthorPo = useCan('procurement', 'author_po');
  const canApproveAward = useCan('procurement', 'approve_award');
  const canViewFinance = useCan('procurement', 'view_finance');
  const canAdmin = useCan('procurement', 'admin');
  const canViewPurchaseOrders =
    canAuthorPo || canApproveAward || canViewFinance || canAdmin;
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const exportCsv = () => {
    downloadCsv(
      `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      purchaseOrdersToCsv(rows),
    );
    success('Purchase orders exported for Finance');
  };
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

  if (!canViewPurchaseOrders) {
    return (
      <ProcurementAccessDenied
        title="No purchase order access"
        message="Your procurement role can raise requests, but purchase orders and Finance exports are restricted."
      />
    );
  }

  // One KPI surface (PR-1 treatment): StatCards are the counts AND the
  // filters; hero carries no numbers; the count-tabs row is gone.
  const filterCards: Array<{
    key: PoFilter;
    label: string;
    value: number;
    icon: IconName;
    tone: Tone;
    hint: string;
  }> = [
    { key: 'all',       label: 'Total POs',    value: kpis.total,  icon: 'cart',   tone: 'brand',   hint: 'All statuses' },
    { key: 'authoring', label: 'In authoring', value: kpis.drafts, icon: 'edit',   tone: 'amber',   hint: 'Draft + pending approval' },
    { key: 'active',    label: 'Active',       value: kpis.active, icon: 'rotate', tone: 'cyan',    hint: 'Approved or issued' },
    { key: 'closed',    label: 'Closed',       value: kpis.closed, icon: 'check',  tone: 'emerald', hint: 'Fully received' },
  ];

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Purchase orders,"
        title={firstName}
        description="Author, approve, and issue POs to accredited vendors."
        icon="cart"
        action={
          <HeroChipButton href="/procurement/?filter=approved" icon="arrowRight">
            Author from approved request
          </HeroChipButton>
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
          title="Purchase orders"
          subtitle={
            filter === 'all'
              ? kpis.openValue > 0
                ? `${kpis.drafts + kpis.active} open · ${money(kpis.openValue)} on order`
                : undefined
              : `Filtered to ${PO_FILTER_LABEL[filter]} — tap a card above to change scope.`
          }
          action={
            <div className="flex items-center gap-2">
              {rows.length > 0 && (
                <button type="button" className="btn-ghost btn-sm" onClick={exportCsv}>
                  <Icon name="download" className="h-4 w-4" /> Export CSV
                </button>
              )}
              <InfoTip
                label="About purchase orders"
                content="POs are authored from approved requests. Awards are gated on vendor accreditation; the warehouse receives against issued POs. Export hands the PO extract to Finance (CSV MVP boundary)."
              />
            </div>
          }
        />

        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-inset" aria-hidden />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon="cart"
            title={filter === 'all' ? 'No purchase orders yet' : `No ${PO_FILTER_LABEL[filter]}`}
            message={
              filter === 'all'
                ? 'Approve a request first — the PO authoring path opens from the request detail page.'
                : 'Nothing in this bucket right now. Tap a card above to see other POs.'
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
