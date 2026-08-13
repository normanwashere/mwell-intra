import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const createServerClient = vi.fn();
const createSignedUrl = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();
const createAdminClient = vi.fn();

vi.mock('@shell/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createServerClient(...args),
}));
vi.mock('@shell/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => createAdminClient(),
}));

function userClient() {
  const docQuery = {
    select: () => docQuery,
    eq: () => docQuery,
    maybeSingle,
  };
  return {
    auth: { getUser },
    schema: () => ({ from: () => docQuery, rpc }),
  };
}

let POST: typeof import('@shell/app/api/legal/documents/access/route').POST;

describe('POST /api/legal/documents/access', () => {
  beforeAll(async () => {
    ({ POST } = await import('@shell/app/api/legal/documents/access/route'));
  });

  beforeEach(() => {
    getUser.mockReset();
    createServerClient.mockReset();
    createSignedUrl.mockReset();
    maybeSingle.mockReset();
    rpc.mockReset();
    createAdminClient.mockReset();
    createServerClient.mockResolvedValue(userClient());
    createAdminClient.mockReturnValue({ storage: { from: () => ({ createSignedUrl }) } });
    maybeSingle.mockResolvedValue({
      data: { filename: 'registration.pdf' },
      error: null,
    });
    rpc.mockResolvedValue({
      data: {
        storage_path: 'vendor/ven-1/legal/accreditation/case-1/registration.pdf',
        expires_in: 300,
        access_audit_id: 'audit-1',
      },
      error: null,
    });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/document' }, error: null });
  });

  it('denies an unauthenticated request before reading document metadata', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"doc-1"}',
    }) as never);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when server-only private document delivery is not configured', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'legal-1' } }, error: null });
    createAdminClient.mockReturnValue(null);

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"doc-1"}',
    }) as never);

    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when the document is not visible through the authenticated legal schema', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'vendor-1' } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorized' } });

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"foreign-doc"}',
    }) as never);

    expect(response.status).toBe(403);
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('issues a bounded download URL only after governed access is audited', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'legal-1' } }, error: null });

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"doc-1","disposition":"download"}',
    }) as never);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('prepare_document_signed_access', {
      payload: { document_id: 'doc-1', purpose: 'download' },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      'vendor/ven-1/legal/accreditation/case-1/registration.pdf',
      300,
      { download: 'registration.pdf' },
    );
    await expect(response.json()).resolves.toEqual({ url: 'https://signed.example/document' });
  });
});
