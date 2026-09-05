import { useEffect, useState } from 'react';
import type { CycleCount } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';

export function useCycleCountRecord(id: string | null | undefined) {
  const { data, getCycleCount } = useWarehouse();
  const cached = data?.cycleCounts.find(count => count.id === id);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; record: CycleCount | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!id || cached) return;
    let current = true;
    setResult(null);
    void getCycleCount(id).then(record => {
      if (current) setResult({ id, record, error: null });
    }).catch(error => {
      if (current) setResult({ id, record: null, error: error instanceof Error ? error.message : 'The source count could not be loaded.' });
    });
    return () => { current = false; };
  }, [id, cached, getCycleCount, attempt]);

  const resolved = result?.id === id ? result : null;
  return {
    record: cached ?? resolved?.record ?? null,
    loading: Boolean(id && !cached && !resolved),
    error: resolved?.error ?? null,
    retry: () => setAttempt(value => value + 1),
  };
}
