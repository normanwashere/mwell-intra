import { useEffect, useRef, useState } from 'react';
import { useWarehouse } from '@/app/store';
import type { WarehouseData } from '@intra/data-kit';
import { loadCompleteControlQueue } from './controlQueues';
import { productPositionSummaries } from './inventoryPositionSummary';

const readError = 'Inventory availability could not be verified. Refresh availability before relying on these totals.';

export function useInventoryAvailability() {
  const { data, source, identityId, capabilities, canOpenRoute, loading, error, loadInventoryPositions, refresh: refreshSnapshot } = useWarehouse();
  const mayRead = canOpenRoute('reports');
  const scope = JSON.stringify([source, identityId, [...capabilities].sort()]);
  const loader = useRef(loadInventoryPositions);
  loader.current = loadInventoryPositions;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    snapshot: WarehouseData;
    revision: number;
    scope: string;
    totals: Map<string, number> | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    setResult(null);
    if (!mayRead || !data || loading || error) return;
    let active = true;
    void loadCompleteControlQueue(loader.current).then((positions) => {
      const totals = new Map<string, number>();
      for (const [productId, summary] of productPositionSummaries(positions, source)) {
        if (!summary.valid) {
          throw new Error('Invalid inventory availability.');
        }
        if (summary.available !== null) totals.set(productId, summary.available);
      }
      if (active) setResult({ snapshot: data, revision, scope, totals, error: null });
    }).catch(() => {
      if (active) setResult({ snapshot: data, revision, scope, totals: null, error: readError });
    });
    return () => { active = false; };
  }, [data, source, scope, mayRead, loading, error, revision]);

  // Hide the previous snapshot immediately, before the next effect runs.
  const current = mayRead && !loading && !error && result?.snapshot === data && result.revision === revision && result.scope === scope ? result : null;
  const failure = error ? readError : current?.error ?? null;
  return {
    totals: current?.totals ?? null,
    loading: mayRead && !failure && !current?.totals,
    error: failure,
    refresh: () => {
      setRevision((value) => value + 1);
      if (error) void refreshSnapshot();
    },
  };
}
