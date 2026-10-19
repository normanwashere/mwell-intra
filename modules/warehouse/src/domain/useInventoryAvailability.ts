import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { WarehouseData } from '@intra/data-kit';
import { loadCompleteControlQueue } from './controlQueues';

const readError = 'Inventory availability could not be verified. Refresh availability before relying on these totals.';

export function useInventoryAvailability() {
  const { data, loading, error, loadInventoryPositions, refresh: refreshSnapshot } = useWarehouse();
  const loader = useRef(loadInventoryPositions);
  loader.current = loadInventoryPositions;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    snapshot: WarehouseData;
    revision: number;
    totals: Map<string, number> | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    setResult(null);
    if (!data || loading || error) return;
    let active = true;
    void loadCompleteControlQueue(loader.current).then((positions) => {
      const totals = new Map<string, number>();
      for (const position of positions) {
        if (!Number.isFinite(position.available) || position.available < 0) {
          throw new Error('Invalid inventory availability.');
        }
        // The governed position already excludes holds and unavailable stock.
        totals.set(position.productId, (totals.get(position.productId) ?? 0) + position.available);
      }
      if (active) setResult({ snapshot: data, revision, totals, error: null });
    }).catch(() => {
      if (active) setResult({ snapshot: data, revision, totals: null, error: readError });
    });
    return () => { active = false; };
  }, [data, loading, error, revision]);

  // Hide the previous snapshot immediately, before the next effect runs.
  const current = !loading && !error && result?.snapshot === data && result.revision === revision ? result : null;
  const failure = error ? readError : current?.error ?? null;
  return {
    totals: current?.totals ?? null,
    loading: !failure && !current?.totals,
    error: failure,
    refresh: () => {
      setRevision((value) => value + 1);
      if (error) void refreshSnapshot();
    },
  };
}
