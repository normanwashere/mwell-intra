// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionValue } from '@intra/auth';
import { useProcurementRequests, type ProcurementRequestsAPI } from './localStore';

let session: SessionValue, api: ProcurementRequestsAPI, root: Root, host: HTMLDivElement;
vi.mock('@intra/auth', () => ({ useSession: () => session, useCan: () => false }));
const calls: { table: string; equality?: [string, string]; limit?: number }[] = [];
let stepsOverflow = false, failed = false;
function Harness({ id = 'old-owned' }: { id?: string }) { api = useProcurementRequests(id); return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); calls.length = 0; stepsOverflow = false; failed = false;
  const client = { schema: () => ({ from: (table: string) => {
    const call: typeof calls[number] = { table }; calls.push(call);
    const query = { select: () => query, order: () => query,
      eq: (column: string, value: string) => { call.equality = [column, value]; return query; },
      limit: (limit: number) => { call.limit = limit; return query; },
      then: (resolve: (value: unknown) => void) => {
        const own = { id: 'old-owned', requester_id: 'actor', title: 'Older own request', status: 'approved', created_at: '2026-08-24' };
        const data = table === 'requests'
          ? (session.profile?.id === 'actor' && call.equality?.[1] === own.id ? [own] : [])
          : stepsOverflow ? Array.from({ length: 101 }, (_, i) => ({ id: `step-${i}`, request_id: 'old-owned', status: 'pending', step_order: i })) : [];
        resolve({ data: data.slice(0, call.limit), count: data.length, error: failed ? { message: 'private SQL detail' } : null });
      },
    }; return query;
  } }) };
  session = { mode: 'supabase', profile: { id: 'actor', kind: 'employee' }, userCapabilities: {}, supabaseClient: client } as unknown as SessionValue;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('reads a fixed request and its approval steps with bounded equality queries, keeping the RLS-visible empty result for another actor', async () => {
  await act(async () => root.render(<Harness />));
  expect(api.rows.map(row => row.id)).toEqual(['old-owned']);
  expect(calls).toEqual([{ table: 'requests', equality: ['id', 'old-owned'], limit: 2 }, { table: 'approval_steps', equality: ['request_id', 'old-owned'], limit: 101 }]);
  session = { ...session, profile: { ...session.profile!, id: 'foreign' } };
  await act(async () => root.render(<Harness />));
  expect(api.rows).toEqual([]);
  expect(api.error).toBeUndefined();
});
it('reports oversized approval projections or query errors instead of making a partial ladder actionable', async () => {
  stepsOverflow = true;
  await act(async () => root.render(<Harness />));
  expect(api.error).toBeTruthy();
  stepsOverflow = false; failed = true;
  await act(async () => api.refresh());
  expect(api.error).toBeTruthy();
  expect(api.error).not.toContain('private');
});
