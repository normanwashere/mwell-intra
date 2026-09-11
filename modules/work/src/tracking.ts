'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@intra/auth';
import type { WorkSource } from './types';

export interface TrackingItem {
  id: string;
  source: WorkSource;
  title: string;
  status: string;
  href: string;
  /** Workflow role, not a claim that a named person has been assigned. */
  owner: string;
  nextStep: string;
  bucket: 'action' | 'waiting' | 'completed';
  updatedAt?: string;
}

type TrackingSource = 'procurement' | 'warehouse';
type Row = Record<string, unknown>;
type Client = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
type Result = { items: TrackingItem[]; errors: string[] };
type Workflow = Pick<TrackingItem, 'status' | 'owner' | 'nextStep' | 'bucket'>;
export const TRACKING_LIMIT = 100;
const SOURCES: readonly TrackingSource[] = ['procurement', 'warehouse'];
// Existing adapters: procurement/localStore.ts and data-kit/supabase/SupabaseRepository.ts.
// Owner reads: 20260815154702_procurement_finance_requester_privacy.sql and
// 20260721210000_cross_department_wms_advisor_remediation.sql. RLS still applies.
const READS = {
  procurement: {
    table: 'requests', owner: 'requester_id', newest: 'updated_at',
    columns: 'id,title,status,requester_id,created_at,updated_at',
    label: 'Procurement requests',
  },
  warehouse: {
    table: 'department_stock_requests', owner: 'requested_by', newest: 'requested_at',
    columns: 'id,purpose,status,requested_by,requested_at',
    label: 'Warehouse department stock requests',
  },
} as const;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const date = (value: unknown) => {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
};

function workflow(source: TrackingSource, raw: string): Workflow {
  const waiting = (status: string, owner: string, nextStep: string): Workflow => ({ status, owner, nextStep, bucket: 'waiting' });
  if (raw === 'rejected' || raw === 'cancelled') {
    return {
      status: raw === 'rejected' ? 'Rejected request' : 'Cancelled request',
      owner: 'Requester', bucket: 'completed',
      nextStep: `Final request disposition: ${raw}; not proof of fulfillment. Review the source record and any recovery obligations.`,
    };
  }
  if (raw === 'draft') return { status: 'Draft', owner: 'Requester', nextStep: 'Review and submit the request in its source module.', bucket: 'action' };
  if (source === 'procurement') {
    switch (raw) {
      case 'submitted':
      case 'under_review':
        return waiting(raw === 'submitted' ? 'Submitted' : 'Under review', 'Procurement / authorized approver', 'Check the request for its current review and approval step.');
      case 'approved':
        return waiting('Approved request', 'Procurement', 'Follow sourcing and the linked purchase order in Procurement. Approval is not fulfillment or payment completion.');
    }
  } else {
    switch (raw) {
      case 'pending_approval':
        return waiting('Awaiting approval', 'Authorized warehouse / procurement reviewer', 'An authorized reviewer other than the requester must approve or reject the request.');
      case 'approved':
      case 'allocated':
        return waiting(raw === 'approved' ? 'Approved request' : 'Allocated', 'Warehouse', 'Check the linked fulfillment order for picking, release, and receipt progress. Request approval or allocation is not fulfillment.');
      case 'issued':
        return waiting('Issued; receipt unverified', 'Warehouse / recipient', 'Check delivery and recipient acknowledgment in the linked order. Stock issue alone does not confirm receipt.');
      case 'closed':
        return { status: 'Closed request', owner: 'No further request handoff', bucket: 'completed', nextStep: 'The request is explicitly closed. Consult the linked order for receipt evidence; this projection does not verify delivery or financial completion.' };
    }
  }
  return { status: `Unknown request status: ${raw || 'missing'}`, owner: 'Requester', nextStep: 'Verify the request status and next step in its source module. Completion cannot be determined from this status.', bucket: 'action' };
}

export function projectTrackingRows(source: TrackingSource, rows: readonly unknown[], actorId: string): TrackingItem[] {
  if (!actorId) return [];
  const contract = READS[source];
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Row;
    const id = text(row.id);
    // Defense in depth even if the client receives a broader RLS-visible result.
    if (!id || row[contract.owner] !== actorId) return [];
    return [{ row, id, newest: Date.parse(date(row[contract.newest]) ?? '') || 0 }];
  }).sort((a, b) => b.newest - a.newest || b.id.localeCompare(a.id))
    .slice(0, TRACKING_LIMIT)
    .map(({ row, id }) => ({
      id: `${source}:${id}`, source,
      title: text(source === 'procurement' ? row.title : row.purpose) || READS[source].label,
      href: source === 'procurement'
        ? `/procurement/requests/${encodeURIComponent(id)}`
        : `/warehouse/fulfillment?tab=requests&request=${encodeURIComponent(id)}`,
      ...workflow(source, text(row.status)),
      // Warehouse requests have no last-updated field. Do not relabel requested_at.
      ...(source === 'procurement' ? { updatedAt: date(row.updated_at) } : {}),
    }));
}

async function readSource(client: Client, source: TrackingSource, actorId: string): Promise<Result> {
  const contract = READS[source];
  try {
    const { data, error } = await client.schema(source).from(contract.table)
      .select(contract.columns).eq(contract.owner, actorId)
      .order(contract.newest, { ascending: false, nullsFirst: false })
      .order('id', { ascending: false }).limit(TRACKING_LIMIT);
    if (error || (data !== null && !Array.isArray(data))) throw new Error('Tracking read failed');
    return { items: projectTrackingRows(source, data ?? [], actorId), errors: [] };
  } catch {
    // Database exception text may contain record details; expose only source context.
    return { items: [], errors: [`${contract.label} tracking unavailable. Refresh to retry or open the source module.`] };
  }
}

function coverageFor(sources: readonly TrackingSource[], mode: string) {
  if (mode === 'memory') return 'Memory mode: no tracking history is loaded.';
  if (!sources.length) return 'No supported tracking sources are enabled. Other modules are not included.';
  const scope = sources.map(source => source === 'procurement'
    ? `latest ${TRACKING_LIMIT} purchase requests by last update`
    : `latest ${TRACKING_LIMIT} stock requests by request date`).join(' and ');
  return `Your ${scope}. Closed, rejected, or cancelled requests are not proof of delivery or payment. Other modules are not included.`;
}

export function useWorkTracking(allowedSources: readonly WorkSource[]): {
  items: TrackingItem[]; loading: boolean; errors: string[];
  refresh: () => Promise<void>; coverage: string;
} {
  const { mode, profile, supabaseClient, userCapabilities = {}, loading: authLoading } = useSession();
  const actorId = profile?.id ?? '';
  const kind = profile?.kind ?? '';
  const vendorId = profile?.vendorId ?? '';
  const sourceKey = SOURCES.filter(source => allowedSources.includes(source)).join(',');
  const authorityKey = JSON.stringify(Object.entries(userCapabilities).sort(([a], [b]) => a.localeCompare(b))
    .map(([module, capabilities]) => [module, [...new Set(capabilities)].sort()]));
  const scope = useMemo(() => ({
    actorId, kind, vendorId, mode, authorityKey, authLoading: Boolean(authLoading),
    client: mode === 'supabase' ? supabaseClient : null,
    sources: sourceKey ? sourceKey.split(',') as TrackingSource[] : [],
  }), [actorId, kind, vendorId, mode, authorityKey, authLoading, supabaseClient, sourceKey]);
  const [state, setState] = useState<Result & { scope: typeof scope | null; loading: boolean }>({
    scope: null, items: [], errors: [], loading: false,
  });
  const active = useRef<typeof scope | null>(null);
  const generation = useRef(0);
  const canRead = !scope.authLoading && Boolean(actorId) && kind === 'employee' && mode === 'supabase' && scope.sources.length > 0;

  const refresh = useCallback(async (): Promise<void> => {
    if (active.current !== scope) return;
    const token = ++generation.current;
    const accepts = () => active.current === scope && generation.current === token;
    setState({ scope, items: [], errors: [], loading: canRead });
    if (!canRead) return;
    if (!scope.client) {
      setState({ scope, items: [], errors: ['Tracking unavailable: authenticated data client is not ready.'], loading: false });
      return;
    }
    const results = await Promise.all(scope.sources.map(source => readSource(scope.client!, source, scope.actorId)));
    if (!accepts()) return;
    setState({ scope, items: results.flatMap(result => result.items), errors: results.flatMap(result => result.errors), loading: false });
  }, [scope, canRead]);

  useEffect(() => {
    active.current = scope;
    void refresh();
    return () => { active.current = null; generation.current += 1; };
  }, [scope, refresh]);

  // Hide old rows during render, before effect cleanup when actor/authority changes.
  const current = state.scope === scope;
  return {
    items: current ? state.items : [], errors: current ? state.errors : [],
    loading: Boolean(authLoading) || (current ? state.loading : canRead),
    refresh, coverage: coverageFor(scope.sources, mode),
  };
}
