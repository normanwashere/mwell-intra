import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '../app/api/admin/audit/route';

const state = vi.hoisted(() => ({ client: true, user: true, cap: true, capError: false, readError: false, reads: vi.fn() }));
vi.mock('@shell/lib/supabase/server', () => ({ createSupabaseServerClient: async () => state.client ? {
  auth: { getUser: async () => ({ data: { user: state.user ? { id: 'caller', user_metadata: { roles: ['platform_admin'] } } : null }, error: null }) },
  schema: () => ({ rpc: async () => ({ data: state.cap, error: state.capError ? new Error('private diagnostic') : null }) }),
} : null }));
vi.mock('@shell/lib/adminAuditReader', () => ({ sessionAuditReader: () => ({
  events: async () => { state.reads(); if (state.readError) throw new Error('private diagnostic'); return []; }, actors: async () => ({}),
}) }));
beforeEach(() => { Object.assign(state, { client: true, user: true, cap: true, capError: false, readError: false }); state.reads.mockClear(); });
const request = () => new Request('http://localhost/api/admin/audit?role=platform_admin');
it.each(['user', 'cap'] as const)('denies missing %s before any source read', async key => {
  state[key] = false;
  const response = await GET(request());
  expect(response.status).toBe(key === 'user' ? 401 : 403);
  expect(state.reads).not.toHaveBeenCalled();
});
it.each(['client', 'capError', 'readError'] as const)('fails closed on %s', async key => {
  state[key] = key !== 'client';
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private diagnostic');
});
it('validates cursors and dates before reading', async () => {
  expect((await GET(new Request('http://localhost/api/admin/audit?before=abc'))).status).toBe(400);
  expect(state.reads).not.toHaveBeenCalled();
});
it('returns genuine empty success with no-store, not an unavailable response', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ rows: [], actors: {}, next: null, snapshot: null, searchPending: false, scanned: 0 });
});
