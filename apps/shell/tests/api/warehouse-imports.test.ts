import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const getUser = vi.fn();
const hasCapability = vi.fn();
const createServerClient = vi.fn();
const stageImport = vi.fn();
const uploadImport = vi.fn();
const removeImport = vi.fn();
let job = {
  id: 'job-1', import_kind: 'locations_bins_v1', schema_version: '1',
  storage_path: 'user/source.csv', checksum_sha256: 'a'.repeat(64),
  status: 'ready', created_by: 'creator-1',
};

vi.mock('@shell/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createServerClient(...args),
}));

function userClient() {
  const jobQuery = {
    select: () => jobQuery,
    eq: () => jobQuery,
    single: async () => ({ data: job, error: null }),
  };
  return {
    auth: { getUser },
    schema: (schema: string) => schema === 'core'
      ? { rpc: hasCapability }
      : { from: () => jobQuery, rpc: stageImport },
    rpc: vi.fn(),
    storage: { from: () => ({ download: vi.fn(), remove: removeImport, upload: uploadImport }) },
  };
}

let POST: typeof import('@shell/app/api/warehouse/imports/route').POST;

describe('POST /api/warehouse/imports', () => {
  beforeAll(async () => {
    ({ POST } = await import('@shell/app/api/warehouse/imports/route'));
  }, 15_000);

  beforeEach(() => {
    getUser.mockReset();
    hasCapability.mockReset();
    createServerClient.mockReset();
    stageImport.mockReset();
    uploadImport.mockReset();
    removeImport.mockReset();
    createServerClient.mockResolvedValue(userClient());
    stageImport.mockResolvedValue({ data: job, error: null });
    uploadImport.mockResolvedValue({ error: null });
    removeImport.mockResolvedValue({ error: null });
    job = { ...job, created_by: 'creator-1', status: 'ready' };
  });

  it('denies anonymous requests', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }) as never);
    expect(response.status).toBe(401);
  });

  it.each(['business-unit', 'bi-analyst'])('denies users without import capability (%s)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@mwell.test' } }, error: null });
    hasCapability.mockResolvedValue({ data: false, error: null });
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }) as never);
    expect(response.status).toBe(403);
  });

  it('denies creator-as-reviewer apply requests', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'creator-1', email: 'creator@mwell.test' } }, error: null });
    hasCapability.mockResolvedValue({ data: true, error: null });
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
    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', body: form,
    }) as never);
    expect(response.status).toBe(413);
  });

  it('uploads and stages a valid import through the authenticated session', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'operator@mwell.test' } },
      error: null,
    });
    hasCapability.mockResolvedValue({ data: true, error: null });
    const csv = [
      'template_version,location_external_id,location_name,location_type,bin_code,bin_label,zone,active',
      '1,LOC-UAT,UAT Warehouse,warehouse,GEN-001,General,General,true',
    ].join('\n');
    const form = new FormData();
    form.set('action', 'validate');
    form.set('kind', 'locations_bins_v1');
    form.set('file', new File([csv], 'locations.csv', { type: 'text/csv' }));

    const response = await POST(new Request('http://localhost/api/warehouse/imports', {
      method: 'POST', body: form,
    }) as never);

    expect(response.status).toBe(201);
    expect(uploadImport).toHaveBeenCalledOnce();
    expect(stageImport).toHaveBeenCalledWith('stage_import_job', {
      payload: expect.objectContaining({
        import_kind: 'locations_bins_v1',
        accepted_rows: 1,
        rejected_rows: 0,
        status: 'ready',
      }),
    });
  });

  it('uses authenticated staging without an application service-role secret', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'app/api/warehouse/imports/route.ts'),
      'utf8',
    );
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260806093000_user_scoped_warehouse_import_staging.sql',
      ),
      'utf8',
    );

    expect(route).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(route).not.toContain('SUPABASE_SECRET_KEY');
    expect(route).toContain("rpc('stage_import_job'");
    expect(migration).toContain('warehouse.stage_import_job');
    expect(migration).toContain("bucket_id = 'warehouse-imports'");
    expect(migration).toContain("core.has_cap('warehouse', 'import_warehouse_data')");
  });
});
