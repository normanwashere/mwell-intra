import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StockChangeRequest } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { Badge, EmptyState, PageHeader, SegmentedControl } from '@/components/ui';
import { StockChangeDecisionSheet } from '@/components/approvals/StockChangeDecisionSheet';

type ApprovalTab = 'waiting' | 'review' | 'decided';

const number = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
});

const money = (value: number) => `PHP ${number.format(value)}`;

function statusLabel(status: StockChangeRequest['status']) {
  if (status === 'pending_supervisor') return 'Awaiting Warehouse Supervisor';
  if (status === 'pending_finance') return 'Awaiting Finance';
  return status === 'approved' ? 'Approved' : 'Rejected';
}

export function ApprovalsPage() {
  const { data, role, identityId, source, loadStockChangeRequests, decideStockChange } = useWarehouse();
  const [tab, setTab] = useState<ApprovalTab>('waiting');
  const [requests, setRequests] = useState<StockChangeRequest[]>([]);
  const [selected, setSelected] = useState<StockChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRequests((await loadStockChangeRequests({ limit: 100 })).rows);
    } finally {
      setLoading(false);
    }
  }, [loadStockChangeRequests]);

  useEffect(() => { void reload(); }, [reload]);

  const waitingStatus: StockChangeRequest['status'] = role === 'finance'
    ? 'pending_finance'
    : 'pending_supervisor';
  const rows = useMemo(() => {
    if (tab === 'waiting') return requests.filter((request) => request.status === waitingStatus);
    if (tab === 'review') return requests.filter((request) =>
      ['pending_supervisor', 'pending_finance'].includes(request.status) && request.status !== waitingStatus);
    return requests.filter((request) => ['approved', 'rejected'].includes(request.status));
  }, [requests, tab, waitingStatus]);

  if (!data) return null;
  const productName = (id: string) => data.products.find((product) => product.id === id)?.name ?? id;
  const decide = async (input: Parameters<typeof decideStockChange>[0]) => {
    const ok = await decideStockChange(input);
    if (ok) await reload();
    return ok;
  };
  const online = source !== 'supabase' || navigator.onLine;

  return (
    <div className="space-y-4">
      <PageHeader title="Stock approvals" icon="check" subtitle="Review governed inventory changes and financial escalation" />
      <div className="rounded-xl border border-line bg-inset/50 px-4 py-3 text-sm text-muted">
        <p className="font-semibold text-ink">Controlled exceptions</p>
        <p className="mt-0.5 text-xs">Delegation never permits the requester to approve their own transaction.</p>
      </div>
      <SegmentedControl<ApprovalTab>
        ariaLabel="Approval status"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'waiting', label: 'Waiting on you' },
          { value: 'review', label: 'In review' },
          { value: 'decided', label: 'Recently decided' },
        ]}
      />

      {loading ? (
        <p className="text-sm text-muted">Loading approvals...</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title="No approvals in this view" />
      ) : (
        <ul
          className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface"
          aria-label={tab === 'waiting' ? 'Waiting on you approvals' : tab === 'review' ? 'In review approvals' : 'Recently decided approvals'}
        >
          {rows.map((request) => (
            <li key={request.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-ink">{productName(request.productId)}</p>
                  <Badge tone={request.status === 'approved' ? 'emerald' : request.status === 'rejected' ? 'rose' : request.status === 'pending_finance' ? 'amber' : 'brand'}>
                    {statusLabel(request.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {request.quantityDelta > 0 ? '+' : ''}{request.quantityDelta} units · {money(request.financialImpact)}
                </p>
                <p className="mt-1 break-all text-xs text-faint">Requested by {request.requestedBy} · {request.reason}</p>
              </div>
              {tab === 'waiting' && (
                <button type="button" className="btn-primary btn-sm justify-center" onClick={() => setSelected(request)}>
                  Review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <StockChangeDecisionSheet
        request={selected}
        actor={identityId}
        online={online}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        onDecision={decide}
      />
    </div>
  );
}
