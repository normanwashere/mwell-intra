// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkTracking } from './tracking';
import type { WorkSource } from './types';

const auth = vi.hoisted(() => ({ session: {
  mode: 'supabase', profile: { id: 'actor-a', kind: 'employee' } as { id: string; kind: string } | null,
  supabaseClient: null as unknown, loading: false,
  userCapabilities: {} as Record<string, string[]>,
} }));
vi.mock('@intra/auth', () => ({ useSession: () => auth.session }));

type Reply = { data: unknown[] | null; error: { message: string } | null };
const record = (id: string, actor = 'actor-a') => ({
  id, requester_id: actor, requested_by: actor, title: id, purpose: id,
  status: 'approved', updated_at: '2026-09-11T00:00:00Z', requested_at: '2026-09-10T00:00:00Z',
});
const ok = (...rows: unknown[]): Reply => ({ data: rows, error: null });
function deferred() {
  let resolve!: (value: Reply) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Reply>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clientFor(read: (source: string, owner: string) => Promise<Reply>) {
  const calls: { source: string; table: string; columns: string; ownerColumn: string; owner: string; orders: [string, unknown][]; limit: number }[] = [];
  return {
    calls,
    schema(source: string) {
      return { from(table: string) {
        const call = { source, table, columns: '', ownerColumn: '', owner: '', orders: [] as [string, unknown][], limit: 0 };
        let closed = false, after = '';
        const query = {
          or() { return query; },
          in() { closed = true; return query; },
          gt(_column: string, value: string) { after = value; return query; },
          select(columns: string) { call.columns = columns; return query; },
          eq(column: string, owner: string) { call.ownerColumn = column; call.owner = owner; return query; },
          order(column: string, options: unknown) { call.orders.push([column, options]); return query; },
          limit(limit: number) {
            call.limit = limit;
            if (closed || after) return Promise.resolve(ok());
            calls.push(call);
            return read(source, call.owner);
          },
        };
        return query;
      } };
    },
  };
}

let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useWorkTracking>;
let renders: ReturnType<typeof useWorkTracking>[];
function Probe({ sources = ['procurement', 'warehouse'] }: { sources?: readonly WorkSource[] }) {
  latest = useWorkTracking(sources);
  renders.push(latest);
  return createElement('p', null, latest.items.map(item => item.title).join(','));
}
async function render(sources?: readonly WorkSource[]) {
  await act(async () => root.render(createElement(Probe, { sources })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  auth.session = { mode: 'supabase', profile: { id: 'actor-a', kind: 'employee' }, supabaseClient: null, loading: false, userCapabilities: {} };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); renders = [];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('useWorkTracking read boundary', () => {
  it('uses only narrow owner-scoped open reads with stable ID cursors and bounded pages', async () => {
    const client = clientFor(async () => ok(record('own'), record('foreign', 'other')));
    auth.session.supabaseClient = client;
    await render();
    expect(latest.items.map(item => item.id)).toEqual(['procurement:own', 'warehouse:own']);
    expect(client.calls).toEqual([
      { source: 'procurement', table: 'requests', columns: 'id,title,description,compliance,status,requester_id,created_at,updated_at', ownerColumn: 'requester_id', owner: 'actor-a', orders: [['id', { ascending: true }]], limit: 100 },
      { source: 'warehouse', table: 'department_stock_requests', columns: 'id,purpose,lines,status,requested_by,requested_at', ownerColumn: 'requested_by', owner: 'actor-a', orders: [['id', { ascending: true }]], limit: 100 },
    ]);
    expect(latest.coverage).toContain('All your open purchase requests and stock requests');
    expect(latest.coverage).toContain('latest 100 closed');
    expect(latest.errors).toEqual([]);
    expect(latest.loading).toBe(false);
  });

  it('honors source restrictions without requiring mutation or broad-reader capabilities', async () => {
    const client = clientFor(async () => ok(record('own')));
    auth.session.supabaseClient = client;
    await render(['warehouse', 'finance', 'warehouse']);
    expect(client.calls.map(call => call.source)).toEqual(['warehouse']);
    expect(latest.items.map(item => item.source)).toEqual(['warehouse']);
    expect(latest.coverage).toContain('All your open stock requests');
    expect(latest.coverage).not.toContain('purchase requests');
    await render(['finance', 'legal']);
    expect(latest.items).toEqual([]);
    expect(client.calls).toHaveLength(1);
    expect(latest.coverage).toContain('No supported tracking sources');
  });

  it('keeps dependencies stable for fresh equivalent profiles, capabilities, and allowed-source arrays', async () => {
    const client = clientFor(async () => ok(record('own')));
    auth.session.supabaseClient = client;
    auth.session.userCapabilities = { procurement: ['b', 'a'], warehouse: ['c'] };
    await render();
    const refresh = latest.refresh;
    auth.session.profile = { id: 'actor-a', kind: 'employee' };
    auth.session.userCapabilities = { warehouse: ['c'], procurement: ['a', 'b', 'a'] };
    await render(['warehouse', 'procurement', 'warehouse']);
    expect(client.calls).toHaveLength(2);
    expect(latest.refresh).toBe(refresh);
  });

  it('preserves a successful source on failure, sanitizes errors, and recovers on refresh', async () => {
    let fail = true;
    const client = clientFor(async source => {
      if (source === 'procurement' && fail) return { data: [record('must-not-render')], error: { message: 'private requester secret' } };
      return ok(record(source));
    });
    auth.session.supabaseClient = client;
    await render();
    expect(latest.items.map(item => item.source)).toEqual(['warehouse']);
    expect(latest.errors).toHaveLength(1);
    expect(latest.errors[0]).toContain('Procurement requests tracking unavailable');
    expect(latest.errors.join()).not.toContain('secret');
    fail = false;
    await act(async () => latest.refresh());
    expect(latest.errors).toEqual([]);
    expect(latest.items).toHaveLength(2);
  });

  it('catches thrown transport errors and clears previously loaded data on failed refresh', async () => {
    let fail = false;
    auth.session.supabaseClient = clientFor(async () => { if (fail) throw new Error('sensitive transport detail'); return ok(record('old')); });
    await render(['procurement']);
    fail = true;
    await act(async () => latest.refresh());
    expect(latest.items).toEqual([]);
    expect(latest.errors).toHaveLength(1);
    expect(latest.errors.join()).not.toContain('sensitive');
    expect(latest.loading).toBe(false);
  });

  it('hides old actor rows on the first render and ignores in-flight responses after actor changes', async () => {
    const stale = deferred();
    const next = deferred();
    let reads = 0;
    const client = clientFor(async (_source, actor) => actor === 'actor-b' ? next.promise : ++reads === 1 ? ok(record('private-a')) : stale.promise);
    auth.session.supabaseClient = client;
    await render(['procurement']);
    const oldRefresh = latest.refresh;
    let pending!: Promise<void>;
    await act(async () => { pending = latest.refresh(); });
    auth.session.profile = { id: 'actor-b', kind: 'employee' };
    renders = [];
    await render(['procurement']);
    expect(renders[0]!.items).toEqual([]);
    expect(latest.loading).toBe(true);
    await act(async () => { stale.resolve(ok(record('private-a'))); await pending; });
    expect(latest.items).toEqual([]);
    await act(async () => { next.resolve(ok(record('private-b', 'actor-b'))); });
    expect(latest.items.map(item => item.title)).toEqual(['private-b']);
    const count = client.calls.length;
    await act(async () => oldRefresh());
    expect(client.calls).toHaveLength(count);
    expect(latest.items.map(item => item.title)).toEqual(['private-b']);
  });

  it('ignores an older request after a newer refresh succeeds', async () => {
    const stale = deferred();
    let count = 0;
    auth.session.supabaseClient = clientFor(async () => ++count === 1 ? stale.promise : ok(record('new')));
    await render(['procurement']);
    await act(async () => latest.refresh());
    await act(async () => stale.resolve(ok(record('stale'))));
    expect(latest.items.map(item => item.title)).toEqual(['new']);
  });

  it('clears prior data on capability revocation and ignores a delayed denied response', async () => {
    const stale = deferred();
    let count = 0;
    auth.session.supabaseClient = clientFor(async () => ++count === 1 ? ok(record('old')) : stale.promise);
    auth.session.userCapabilities = { procurement: ['view_requests'] };
    await render(['procurement']);
    auth.session.userCapabilities = {};
    renders = [];
    await render(['procurement']);
    expect(renders[0]!.items).toEqual([]);
    await render([]);
    await act(async () => stale.resolve({ data: null, error: { message: 'denied' } }));
    expect(latest.items).toEqual([]);
    expect(latest.errors).toEqual([]);
    expect(latest.loading).toBe(false);
  });

  it.each(['signed-out', 'vendor', 'auth-loading', 'memory', 'missing-client'])('fails closed for %s without a demo fallback', async state => {
    const client = clientFor(async () => ok(record('old')));
    auth.session.supabaseClient = client;
    await render(['procurement']);
    if (state === 'signed-out') auth.session.profile = null;
    if (state === 'vendor') auth.session.profile = { id: 'actor-a', kind: 'vendor' };
    if (state === 'auth-loading') auth.session.loading = true;
    if (state === 'memory') auth.session.mode = 'memory';
    if (state === 'missing-client') auth.session.supabaseClient = null;
    renders = [];
    await render(['procurement']);
    expect(renders[0]!.items).toEqual([]);
    expect(latest.items).toEqual([]);
    expect(client.calls).toHaveLength(1);
    expect(latest.loading).toBe(state === 'auth-loading');
    expect(latest.errors.length).toBe(state === 'missing-client' ? 1 : 0);
    if (state === 'memory') expect(latest.coverage).toContain('Memory mode');
  });

  it('does not perform reads or accept delayed results after unmount', async () => {
    const pending = deferred();
    const client = clientFor(async () => pending.promise);
    auth.session.supabaseClient = client;
    await render(['procurement']);
    const refresh = latest.refresh;
    await act(async () => root.unmount());
    const count = renders.length;
    await act(async () => { pending.resolve(ok(record('stale'))); await refresh(); });
    expect(renders).toHaveLength(count);
    expect(client.calls).toHaveLength(1);
    root = createRoot(host);
  });
});
