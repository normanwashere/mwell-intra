'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@intra/auth';
import { Badge } from '@intra/ui';

type VendorPo = {
  id: string;
  poNumber: string;
  vendorName: string;
  lifecycle: { revision: number; acknowledgementStatus: 'pending' | 'acknowledged' | 'overdue'; acknowledgementDueAt?: string };
};

export function VendorPurchaseOrderAcknowledgements() {
  const { profile, mode, supabaseClient } = useSession();
  const [rows, setRows] = useState<VendorPo[]>([]);
  const [reference, setReference] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const live = mode === 'supabase' ? supabaseClient : null;

  const refresh = useCallback(async () => {
    if (!live || profile?.kind !== 'vendor') { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: rpcError } = await live.schema('procurement').rpc('vendor_purchase_order_acknowledgements', { payload: {} });
    if (rpcError) { setError(rpcError.message); setRows([]); } else { setError(undefined); setRows((data ?? []) as VendorPo[]); }
    setLoading(false);
  }, [live, profile?.kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (profile?.kind !== 'vendor') return <p role="alert" className="p-6 text-sm text-muted">Vendor access is required.</p>;
  return <main className="mx-auto max-w-4xl space-y-5 p-4 md:p-6" aria-label="Vendor PO acknowledgements">
    <header><h1 className="text-xl font-semibold text-ink">Purchase order acknowledgements</h1><p className="text-sm text-muted">Only purchase orders awarded to your organization appear here.</p></header>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    {loading ? <p className="text-sm text-muted">Loading awarded purchase orders...</p> : null}
    {!loading && rows.length === 0 ? <p className="text-sm text-muted">No issued purchase orders require acknowledgement.</p> : null}
    {rows.map((po) => <section key={po.id} className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-ink">{po.poNumber}</h2><p className="text-sm text-muted">{po.vendorName}</p></div><Badge tone={po.lifecycle.acknowledgementStatus === 'acknowledged' ? 'emerald' : po.lifecycle.acknowledgementStatus === 'overdue' ? 'rose' : 'amber'}>{po.lifecycle.acknowledgementStatus}</Badge></div>
      {po.lifecycle.acknowledgementDueAt ? <p className="text-xs text-muted">Acknowledgement due {new Date(po.lifecycle.acknowledgementDueAt).toLocaleString()}</p> : null}
      {po.lifecycle.acknowledgementStatus !== 'acknowledged' ? <label className="block text-sm font-semibold text-ink">Acknowledgement reference<input aria-label={`Acknowledgement reference for ${po.poNumber}`} className="input mt-1.5" value={reference[po.id] ?? ''} onChange={(event) => setReference((current) => ({ ...current, [po.id]: event.target.value }))} /><button type="button" className="btn-primary mt-2" disabled={!reference[po.id]?.trim()} onClick={async () => { const { error: rpcError } = await live!.schema('procurement').rpc('acknowledge_purchase_order', { payload: { purchase_order_id: po.id, expected_revision: po.lifecycle.revision, acknowledgement_reference: reference[po.id]!.trim() } }); if (rpcError) setError(rpcError.message); else await refresh(); }}>Acknowledge purchase order</button></label> : null}
    </section>)}
  </main>;
}
