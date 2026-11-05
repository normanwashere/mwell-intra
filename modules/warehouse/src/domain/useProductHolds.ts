import { useEffect, useRef, useState } from 'react';
import type { InventoryHold, InventoryUnit } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { loadCompleteControlQueue } from './controlQueues';

export function matchingUnitHolds(holds: InventoryHold[], unit: InventoryUnit): InventoryHold[] {
  return holds.filter(hold => hold.status === 'active' && hold.productId === unit.productId
    && (hold.serialNumber ? hold.serialNumber === unit.serialNumber
      : hold.locationId === unit.locationId && (hold.binId ?? null) === (unit.binId ?? null)
        && (hold.lotId ?? null) === (unit.lotId ?? null)));
}

export function useProductHolds(productId: string) {
  const { loadHolds, data, identityId, source, can } = useWarehouse();
  const canReadHolds = source === 'memory' || can('inspect_quality') || can('view_exceptions') || can('view_finance');
  const loader = useRef(loadHolds);
  loader.current = loadHolds;
  const [state, setState] = useState<{ productId: string; holds: InventoryHold[]; loading: boolean; error: boolean }>({ productId, holds: [], loading: true, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!data?.products.some(product => product.id === productId && product.serialized)) return;
    if (!canReadHolds) {
      setState({ productId, holds: [], loading: false, error: true });
      return;
    }
    let active = true;
    setState({ productId, holds: [], loading: true, error: false });
    void loadCompleteControlQueue(query => loader.current({ ...query, status: 'active' }))
      .then(holds => { if (active) setState({ productId, holds: holds.filter(hold => hold.productId === productId), loading: false, error: false }); })
      .catch(() => { if (active) setState({ productId, holds: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [data, identityId, productId, retry, canReadHolds]);
  return { ...(state.productId === productId ? state : { holds: [], loading: true, error: false }), refresh: () => setRetry(value => value + 1) };
}
