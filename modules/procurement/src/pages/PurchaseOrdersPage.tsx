'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { makeTypedSignature } from '../signature';

interface AmendmentWorkItem {
  amendment_id: string;
  purchase_order_id: string;
  po_line_id: string;
  po_number: string;
  line_description: string;
  previous_quantity: number;
  amended_quantity: number;
  status: string;
  next_tier?: string;
  can_decide: boolean;
  reason: string;
  evidence_urls: string[];
}

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
  const { profile, mode, supabaseClient } = useSession();
  const { success, error } = useToast();
  const canAuthorPo = useCan('procurement', 'author_po');
  const canApproveAward = useCan('procurement', 'approve_award');
  const canViewFinance = useCan('procurement', 'view_finance');
  const canAdmin = useCan('procurement', 'admin');
  const canViewPurchaseOrders =
    canAuthorPo || canApproveAward || canViewFinance || canAdmin;
  const firstName = profile?.name?.split(/\s+/)[0] ?? 'Procurement';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [amendmentItems, setAmendmentItems] = useState<AmendmentWorkItem[]>([]);
  const [amendmentQueueLoading, setAmendmentQueueLoading] = useState(mode === 'supabase');
  const [amendmentLineId, setAmendmentLineId] = useState('');
  const [amendedQuantity, setAmendedQuantity] = useState(1);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [amendmentEvidence, setAmendmentEvidence] = useState('');
  const [amendmentDecisionReasons, setAmendmentDecisionReasons] = useState<Record<string, string>>({});

  const exportCsv = () => {
    downloadCsv(
      `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      purchaseOrdersToCsv(rows),
    );
    success('Purchase orders exported for Finance');
  };
  const filter = (params.get('filter') as PoFilter) ?? 'all';
  const refreshAmendmentQueue = useCallback(async (): Promise<boolean> => {
    if (mode !== 'supabase' || !supabaseClient) {
      setAmendmentQueueLoading(false);
      return true;
    }
    const { data, error: rpcError } = await supabaseClient.schema('procurement')
      .rpc('purchase_order_amendment_work_items', { payload: {} });
    if (rpcError) {
      setAmendmentItems([]);
      setAmendmentQueueLoading(false);
      error(rpcError.message);
      return false;
    }
    setAmendmentItems((data ?? []) as AmendmentWorkItem[]);
    setAmendmentQueueLoading(false);
    return true;
  }, [error, mode, supabaseClient]);
  useEffect(() => { void refreshAmendmentQueue(); }, [refreshAmendmentQueue]);

  const requestAmendment = async () => {
    if (!supabaseClient || !amendmentLineId || !amendmentReason.trim() || !amendmentEvidence.trim()) return;
    const selected = rows.flatMap((po) => po.lines.map((line) => ({ po, line })))
      .find(({ line }) => line.id === amendmentLineId);
    if (!selected) return;
    const { error: rpcError } = await supabaseClient.schema('procurement')
      .rpc('request_po_line_quantity_amendment', { payload: {
        purchase_order_id: selected.po.id, po_line_id: selected.line.id,
        amended_quantity: amendedQuantity, reason: amendmentReason.trim(),
        evidence_urls: [amendmentEvidence.trim()],
      } });
    if (rpcError) { error(rpcError.message); return; }
    setAmendmentReason(''); setAmendmentEvidence('');
    if (!(await refreshAmendmentQueue())) return;
    success('PO quantity amendment entered the current DOA queue');
  };

  const decideAmendment = async (item: AmendmentWorkItem, decision: 'approved' | 'rejected') => {
    if (!supabaseClient) return;
    const decisionReason = amendmentDecisionReasons[item.amendment_id]?.trim();
    if (!decisionReason) { error('Enter the approver decision rationale first'); return; }
    const signature = decision === 'approved' ? makeTypedSignature(profile?.name) : null;
    if (decision === 'approved' && !signature) {
      error('Your active profile name is required to create the approval signature');
      return;
    }
    const { error: rpcError } = await supabaseClient.schema('procurement')
      .rpc('approve_po_line_quantity_amendment', { payload: {
        amendment_id: item.amendment_id, decision, reason: decisionReason,
        ...(signature ? { signature: {
          signature_png: signature.dataUrl,
          signer_name: signature.signerName,
          signature_method: signature.method,
          signed_at: signature.signedAt,
          signer_ua: signature.userAgent,
        } } : {}),
      } });
    if (rpcError) { error(rpcError.message); return; }
    setAmendmentDecisionReasons((current) => ({ ...current, [item.amendment_id]: '' }));
    if (!(await refreshAmendmentQueue())) return;
    success(`PO quantity amendment ${decision}`);
  };

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

  const hasAssignedAmendmentWork = amendmentItems.some((item) => item.can_decide);
  if (!canViewPurchaseOrders && amendmentQueueLoading) {
    return <p className="p-4 text-sm text-muted" aria-live="polite">Loading assigned amendment work...</p>;
  }
  if (!canViewPurchaseOrders && !hasAssignedAmendmentWork) {
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
        action={canAuthorPo ? (
          <HeroChipButton href="/procurement/?filter=approved" icon="arrowRight">
            Author from approved request
          </HeroChipButton>
        ) : undefined}
      />

      <StaggerGrid className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
        {filterCards.map((c) => {
          const active = filter === c.key;
          return (
            <StaggerItem
              key={c.key}
              className={
                active
                  ? 'h-full min-w-0 rounded-2xl ring-2 ring-brand-500 ring-offset-2 ring-offset-app'
                  : 'h-full min-w-0'
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

      {mode === 'supabase' && (canAuthorPo || amendmentItems.length > 0) && <section className="space-y-3" aria-label="PO quantity amendment queue">
        <SectionTitle title="PO quantity amendments" subtitle="Requests follow the current department, category, amount, and effective-date DOA ladder." />
        {canAuthorPo && <div className="grid gap-3 border-y border-line py-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-ink">PO line
            <select className="input mt-1.5" value={amendmentLineId} onChange={(event) => setAmendmentLineId(event.target.value)}>
              <option value="">Select an open issued PO line</option>
              {rows.filter((po) => po.status === 'approved' || po.status === 'issued').flatMap((po) => po.lines.map((line) => (
                <option key={line.id} value={line.id}>{po.poNumber} · {line.description} · {line.quantity} ordered</option>
              ))) }
            </select>
          </label>
          <label className="text-sm font-semibold text-ink">New whole-number quantity
            <input className="input mt-1.5" type="number" min={1} step={1} value={amendedQuantity} onChange={(event) => setAmendedQuantity(Number(event.target.value))} />
          </label>
          <label className="text-sm font-semibold text-ink">Reason
            <input className="input mt-1.5" value={amendmentReason} onChange={(event) => setAmendmentReason(event.target.value)} />
          </label>
          <label className="text-sm font-semibold text-ink">Evidence URL
            <input className="input mt-1.5" value={amendmentEvidence} onChange={(event) => setAmendmentEvidence(event.target.value)} />
          </label>
          <button type="button" className="btn-primary md:col-span-2 md:justify-self-start" disabled={!amendmentLineId || amendedQuantity <= 0 || !Number.isInteger(amendedQuantity) || !amendmentReason.trim() || !amendmentEvidence.trim()} onClick={() => void requestAmendment()}>
            <Icon name="edit" className="h-4 w-4" /> Request governed amendment
          </button>
        </div>}
        {amendmentItems.length === 0 ? <p className="text-sm text-muted">No requester-owned or assigned amendment work is active.</p> : <ul className="divide-y divide-line border-y border-line">
          {amendmentItems.map((item) => <li key={item.amendment_id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0 space-y-1">
              <p className="font-semibold text-ink">{item.po_number} / {item.line_description}</p>
              <p className="text-sm text-muted">{item.previous_quantity} to {item.amended_quantity} units / {item.status}{item.next_tier ? ` / next: ${item.next_tier}` : ''}</p>
              <p className="text-sm text-ink"><span className="font-semibold">Request reason:</span> {item.reason}</p>
              {item.evidence_urls?.length > 0 && <div className="text-xs text-muted">
                <span className="font-semibold text-ink">Submitted evidence:</span>
                <ul className="mt-1 space-y-1">
                  {item.evidence_urls.map((evidence) => <li key={evidence} className="break-all">{evidence}</li>)}
                </ul>
              </div>}
            </div>
            {item.can_decide && <div className="grid min-w-0 gap-2 sm:min-w-80">
              <label className="text-sm font-semibold text-ink">Decision rationale
                <textarea className="input mt-1.5 min-h-20 resize-y" value={amendmentDecisionReasons[item.amendment_id] ?? ''}
                  onChange={(event) => setAmendmentDecisionReasons((current) => ({ ...current, [item.amendment_id]: event.target.value }))} />
              </label>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn-outline btn-sm" disabled={!amendmentDecisionReasons[item.amendment_id]?.trim()} onClick={() => void decideAmendment(item, 'rejected')}>Reject</button><button type="button" className="btn-primary btn-sm" disabled={!amendmentDecisionReasons[item.amendment_id]?.trim()} onClick={() => void decideAmendment(item, 'approved')}><Icon name="signature" className="h-4 w-4" />Approve step</button></div>
            </div>}
          </li>)}
        </ul>}
      </section>}
    </div>
  );
}
