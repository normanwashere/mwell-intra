'use client';
import { useSession } from '@intra/auth';
import { useReadQuery } from './useReadQuery';
import { mapProcurementRequest } from './localStore';
import { classifyRecord } from '../../../packages/data-kit/src/domain/testFixtures';
import type { RequestListRow } from './requestList';

type Client = NonNullable<ReturnType<typeof useSession>['supabaseClient']>;
export const REQUEST_PAGE_SIZE = 100;
const COLUMNS = 'id,title,description,compliance,status,department,requester_id,vendor_name,estimated_amount,needed_by,created_at,lines,purchase_orders(id,po_number)';

export async function readRequestListRows(client: Client): Promise<RequestListRow[]> {
  const result = new Map<string, RequestListRow>();
  let after = '';
  for (;;) {
    let query = client.schema('procurement').from('requests').select(COLUMNS).order('id', { ascending: true });
    if (after) query = query.gt('id', after);
    const { data, error } = await query.limit(REQUEST_PAGE_SIZE);
    if (error || !Array.isArray(data)) throw new Error('Request list unavailable');
    if (!data.length) break;
    const next = data[data.length - 1]?.id;
    if (typeof next !== 'string' || !next || next === after || result.has(next)) throw new Error('Request cursor did not advance');
    for (const row of data) {
      if (!row || typeof row.id !== 'string') throw new Error('Invalid request list row');
      const orders: unknown = row.purchase_orders;
      result.set(row.id, {
        ...mapProcurementRequest(row as unknown as Parameters<typeof mapProcurementRequest>[0]),
        classification: classifyRecord(row),
        references: Array.isArray(orders) ? orders.flatMap(order => typeof order?.po_number === 'string' ? [order.po_number] : []) : [],
      });
    }
    after = next;
  }
  return [...result.values()];
}

export function useRequestListRead() {
  const { mode, profile, supabaseClient, userCapabilities, loading: authLoading } = useSession();
  const client = mode === 'supabase' && !authLoading && profile?.kind === 'employee' ? supabaseClient : null;
  const [rows, loading, refresh, error] = useReadQuery(client, `${profile?.id}:${JSON.stringify(userCapabilities)}`, () => readRequestListRows(client!));
  return { rows, loading: loading || Boolean(authLoading), refresh, error: client || authLoading ? error : 'Authenticated request list unavailable.' };
}
