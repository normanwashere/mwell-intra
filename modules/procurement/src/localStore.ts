// Local-only procurement store (preview build).
//
// The real repository adapter (@intra/core-data) lands post-MVP; until then we
// persist requests + POs to localStorage so the "Save draft → appears in list"
// journey isn't a dead-end and users can see their actions took effect.
// The keys are namespaced under `intra.procurement.v1.*` so we can clear them
// cleanly when the real adapter is wired.

import { useEffect, useState } from 'react';
import type { ProcurementRequest } from './types';

const KEY = 'intra.procurement.v1.requests';

function safeRead(): ProcurementRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProcurementRequest[]) : [];
  } catch {
    return [];
  }
}

function safeWrite(rows: ProcurementRequest[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
    // Notify any other mounted `useProcurementRequests` in this tab.
    window.dispatchEvent(new Event('intra.procurement.change'));
  } catch {
    /* quota exceeded / disabled — noop */
  }
}

export function useProcurementRequests(): {
  rows: ProcurementRequest[];
  add: (row: Omit<ProcurementRequest, 'id' | 'createdAt' | 'status'> & { status?: ProcurementRequest['status'] }) => ProcurementRequest;
  loading: boolean;
} {
  const [rows, setRows] = useState<ProcurementRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRows(safeRead());
    setLoading(false);
    if (typeof window === 'undefined') return;
    const onChange = () => setRows(safeRead());
    window.addEventListener('intra.procurement.change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('intra.procurement.change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  function add(input: Omit<ProcurementRequest, 'id' | 'createdAt' | 'status'> & { status?: ProcurementRequest['status'] }): ProcurementRequest {
    const next: ProcurementRequest = {
      id: (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      createdAt: new Date().toISOString(),
      status: input.status ?? 'draft',
      title: input.title,
      department: input.department,
      description: input.description,
      estimatedAmount: input.estimatedAmount,
    };
    const merged = [next, ...safeRead()];
    safeWrite(merged);
    setRows(merged);
    return next;
  }

  return { rows, add, loading };
}
