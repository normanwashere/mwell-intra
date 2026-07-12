import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const hasCapability = vi.fn();
const createServerClient = vi.fn();
const createAdminClient = vi.fn();
let job = {
  id: 'job-1', import_kind: 'locations_bins_v1', schema_version: '1',
  storage_path: 'user/source.csv', checksum_sha256: 'a'.repeat(64),
  status: 'ready', created_by: 'creator-1',
};

vi.mock('@shell/lib/supabase/env', () => ({ SUPABASE_URL: 'https://test.supabase.co' }));
vi.mock('@shell/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createServerClient(...args),
}));
vi.mock('@supabase/supabase-js', async (original) => {
  const actual = await original<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: (...args: unknown[]) => createAdminClient(...args) };
});

function userClient() {
  return {
    auth: { getUser },
    schema: () => ({ rpc: hasCapability }),
    rpc: vi.fn(),
  };
}

function adminClient() {
  const jobQuery = {
    select: () => jobQuery,
    eq: () => jobQuery,
    single: async () => ({ data: job, error: null }),
  };
  return {
    schema: () => ({ from: () => jobQuery }),
    storage: { from: () => ({ download: vi.fn() }) },
  };
}

async function route() {
  return import('@shell/app/api/warehouse/imports/route');
}

describe('POST /api/warehouse/imports', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
    getUser.mockReset();
    hasCapability.mockReset();
    createServerClient.mockReset();
    createAdminClient.mockReset();
    createServerClient.mockResolvedValue(userClient());
    createAdminClient.mockReturnValue(adminClient());
    job = { ...job, created_by: 'creator-1', status: 'ready' };
  });

  it('denies anonymous requests', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await route();
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }) as never);
    expect(response.status).toBe(401);
  });

  it.each(['business-unit', 'bi-analyst'])('denies users without import capability (%s)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@mwell.test' } }, error: null });
    hasCapability.mockResolvedValue({ data: false, error: null });
    const { POST } = await route();
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }) as never);
    expect(response.status).toBe(403);
  });

  it('denies creator-as-reviewer apply requests', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'creator-1', email: 'creator@mwell.test' } }, error: null });
    hasCapability.mockResolvedValue({ data: true, error: null });
    const { POST } = await route();
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'apply', job_id: 'job-1', idempotency_key: 'import-apply-001' }),
    }) as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/creator/i) });
  });

  it('rejects oversized CSV uploads before storage', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@mwell.test' } }, error: null });
    hasCapability.mockResolvedValue({ data: true, error: null });
    const form = new FormData();
    form.set('action', 'validate');
    form.set('kind', 'locations_bins_v1');
    form.set('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.csv', { type: 'text/csv' }));
    const { POST } = await route();
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', body: form,
    }) as never);
    expect(response.status).toBe(413);
  });
});
