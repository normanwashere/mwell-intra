import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.fn();
const createServerClient = vi.fn();
const createSignedUrl = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@shell/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createServerClient(...args),
}));

function userClient() {
  const docQuery = {
    select: () => docQuery,
    eq: () => docQuery,
    maybeSingle,
  };
  return {
    auth: { getUser },
    schema: () => ({ from: () => docQuery }),
    storage: { from: () => ({ createSignedUrl }) },
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
    createServerClient.mockResolvedValue(userClient());
    maybeSingle.mockResolvedValue({
      data: { id: 'doc-1', filename: 'registration.pdf', storage_path: 'vendor/ven-1/legal/accreditation/case-1/registration.pdf' },
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
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when the document is not visible through the authenticated legal schema', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'vendor-1' } }, error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"foreign-doc"}',
    }) as never);

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('issues an eight-minute download URL only after the authenticated RLS-scoped lookup', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'legal-1' } }, error: null });

    const response = await POST(new Request('http://localhost/api/legal/documents/access', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document_id":"doc-1","disposition":"download"}',
    }) as never);

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith(
      'vendor/ven-1/legal/accreditation/case-1/registration.pdf',
      480,
      { download: 'registration.pdf' },
    );
    await expect(response.json()).resolves.toEqual({ url: 'https://signed.example/document' });
  });
});
