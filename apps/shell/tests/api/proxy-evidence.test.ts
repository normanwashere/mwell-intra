import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ sessionUser: vi.fn(), evidenceUser: vi.fn(), admin: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: state.sessionUser } }),
}));
vi.mock('@shell/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: state.evidenceUser } }),
}));
vi.mock('@shell/lib/supabase/admin', () => ({ createSupabaseAdminClient: state.admin }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DATA_SOURCE', 'supabase');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-public-key');
  state.sessionUser.mockResolvedValue({ data: { user: null } });
  state.evidenceUser.mockResolvedValue({ data: { user: null }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ['https://intra.test', 401, 'Authentication required.'],
  ['https://foreign.test', 403, 'Same-origin request required.'],
])('preserves evidence JSON denial through the page proxy for origin %s', async (origin, status, error) => {
  const request = new NextRequest('https://intra.test/api/evidence', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}',
  });
  const { proxy } = await import('@shell/proxy');
  const gate = await proxy(request);
  expect(gate.headers.get('location')).toBeNull();
  expect(gate.headers.get('x-middleware-next')).toBe('1');
  const { POST } = await import('@shell/app/api/evidence/route');
  const response = await POST(request);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(state.admin).not.toHaveBeenCalled();
  expect(state.sessionUser).not.toHaveBeenCalled();
});

it.each(['/warehouse/allocations', '/api/evidence-other', '/api/evidence/private']) (
  'retains the existing session gate outside the exact self-authenticating route: %s', async (path) => {
    const { proxy } = await import('@shell/proxy');
    const response = await proxy(new NextRequest(`https://intra.test${path}`));
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get('location')!);
    expect(destination.pathname).toBe('/login');
    expect(destination.searchParams.get('redirect')).toBe(path);
  },
);

it('continues to admit authenticated page requests', async () => {
  state.sessionUser.mockResolvedValue({ data: { user: { id: 'actor-A' } } });
  const { proxy } = await import('@shell/proxy');
  const response = await proxy(new NextRequest('https://intra.test/warehouse/allocations'));
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBe('1');
});
