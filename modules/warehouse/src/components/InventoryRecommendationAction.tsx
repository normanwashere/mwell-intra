import { useEffect, useRef, useState } from 'react';
import type { DataSource } from '@intra/data-kit';
import { useSession } from '@/auth/session';
import type { Product } from '@/domain/types';
import { Icon } from './Icon';
import { Sheet } from './ui';

const statuses = ['recommended', 'accepted', 'handed_off'] as const;
type ActiveStatus = typeof statuses[number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (value: number) => Number.isInteger(value) && value >= 0 && value <= 2147483647;

export function InventoryRecommendationAction({ product, available, source, stockReady }: {
  product: Pick<Product, 'id' | 'name' | 'sku' | 'reorderPoint'>;
  available: number;
  source: DataSource;
  stockReady: boolean;
}) {
  const { mode, loading, profile, userCapabilities, supabaseClient: client } = useSession();
  const allowed = source === 'supabase' && mode === 'supabase' && !loading && !!profile && !!client
    && userCapabilities?.warehouse?.includes('view_inventory') === true
    && userCapabilities?.warehouse?.includes('recommend_replenishment') === true;
  const minimum = product.reorderPoint;
  const ready = stockReady && integer(available) && integer(minimum);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [days, setDays] = useState('14');
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState<ActiveStatus | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  // Invalidate pending reads immediately on a context change, including before effects run.
  const context = JSON.stringify([allowed, ready, profile?.id, product.id, available, minimum, open]);
  const latest = useRef({ context, client });
  if (latest.current.context !== context || latest.current.client !== client) {
    epoch.current += 1;
    latest.current = { context, client };
  }
  useEffect(() => () => { epoch.current += 1; }, []);

  async function readStatus(): Promise<ActiveStatus | null> {
    if (!client) throw new Error('Unavailable');
    const result = await client.schema('procurement').from('replenishment_recommendations')
      .select('id,product_id,status', { count: 'exact' }).eq('product_id', product.id)
      .in('status', [...statuses]).limit(2);
    if (result.error || !Array.isArray(result.data) || result.count !== result.data.length
      || result.data.length > 1) throw new Error('Unverified status');
    if (!result.data.length) return null;
    const row = result.data[0];
    if (!row || typeof row.id !== 'string' || !uuid.test(row.id) || row.product_id !== product.id
      || !statuses.includes(row.status as ActiveStatus)) throw new Error('Unverified status');
    return row.status as ActiveStatus;
  }

  useEffect(() => {
    setVerified(false);
    setStatus(null);
    setSaved(false);
    setError(null);
    if (!open || !allowed || !ready) return;
    setQuantity(String(Math.max(Math.max(0, minimum - available), minimum)));
    setDays('14');
    setRationale(available < minimum ? 'Available inventory is below the minimum stock level.' : '');
    const token = epoch.current;
    let cancelled = false;
    void readStatus().then(value => {
      if (cancelled || token !== epoch.current) return;
      setStatus(value); setVerified(true);
    }).catch(() => {
      if (!cancelled && token === epoch.current) setError('Recommendation status could not be verified. Close and reopen to retry.');
    });
    return () => { cancelled = true; };
  }, [open, allowed, ready, profile?.id, product.id, available, minimum, client]);

  const editable = status === null || status === 'recommended';
  const valid = quantity.trim() !== '' && integer(Number(quantity)) && Number(quantity) > 0
    && days.trim() !== '' && integer(Number(days)) && rationale.trim() !== '';
  const canSave = allowed && ready && open && verified && editable && valid && !busy && !saved;
  function changeOpen(value: boolean) {
    epoch.current += 1;
    setOpen(value);
  }
  async function save() {
    if (!canSave || inFlight.current || !client) return;
    inFlight.current = true; setBusy(true); setError(null);
    const token = epoch.current;
    try {
      const current = await readStatus();
      if (token !== epoch.current) return;
      setStatus(current);
      if (current === 'accepted' || current === 'handed_off') return;
      const { data, error: rpcError } = await client.schema('procurement')
        .rpc('manage_replenishment_recommendation', { payload: {
          action: 'recommend', product_id: product.id, recommended_quantity: Number(quantity),
          on_hand: available, reorder_point: minimum, lead_time_days: Number(days),
          stockout_risk: available === 0 ? 'critical' : available < minimum ? 'medium' : 'low',
          rationale: rationale.trim(),
        } });
      if (token !== epoch.current) return;
      if (rpcError || !data || typeof data.id !== 'string' || !uuid.test(data.id)
        || data.product_id !== product.id || data.status !== 'recommended') throw new Error('Unverified save');
      setStatus('recommended'); setSaved(true);
    } catch {
      if (token === epoch.current) {
        setVerified(false);
        setError('Recommendation could not be confirmed. Close and reopen to verify its status before retrying.');
      }
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  return <>
    {allowed && <button type="button" className="btn-outline min-h-11" disabled={!ready} onClick={() => changeOpen(true)}>
      <Icon name="plus" className="h-4 w-4" />Recommend replenishment
    </button>}
    <Sheet open={open} onOpenChange={changeOpen} title="Recommend replenishment"
      description={`${product.name} - ${product.sku}`}
      footer={<div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost min-h-11" onClick={() => changeOpen(false)}>Cancel</button>
        {editable && <button type="button" className="btn-primary min-h-11" disabled={!canSave} onClick={() => void save()}>Save recommendation</button>}
      </div>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt>Available inventory</dt><dd className="font-semibold" data-testid="recommendation-available">{available}</dd></div>
          <div><dt>Minimum stock</dt><dd className="font-semibold" data-testid="recommendation-minimum">{minimum}</dd></div>
        </dl>
        {!allowed || !ready ? <p role="alert">Current inventory and recommendation access are required.</p>
          : error ? <p role="alert">{error}</p>
          : <p role="status">{saved ? 'Recommendation saved' : !verified ? 'Checking recommendation status...' : status ? `Current status: ${status}` : 'No active recommendation'}</p>}
        {editable && <fieldset disabled={!allowed || !ready || !verified || busy || saved} className="space-y-4">
          <label className="block text-sm font-medium">Recommended quantity
            <input className="input mt-1 w-full" type="number" min={1} max={2147483647} step={1} required value={quantity} onChange={e => setQuantity(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Planning assumption (days)
            <input className="input mt-1 w-full" type="number" min={0} max={2147483647} step={1} required value={days} onChange={e => setDays(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Rationale
            <textarea className="input mt-1 w-full" rows={3} required value={rationale} onChange={e => setRationale(e.target.value)} />
          </label>
        </fieldset>}
      </div>
    </Sheet>
  </>;
}
