import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), upload: vi.fn(), signed: vi.fn() }));
vi.mock('@shell/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: state.getUser }, schema: () => ({ rpc: state.rpc }) }) }));
vi.mock('@shell/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ storage: { from: (bucket: string) => {
  expect(bucket).toBe('documents');
  return { upload: state.upload, createSignedUrl: state.signed };
} } }) }));
import { POST } from '@shell/app/api/evidence/route';
const id = '11111111-1111-4111-8111-111111111111';
const path = `business-evidence/${id}.pdf`;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_MULTIPART = MAX_FILE + 64 * 1024;
function sizedPdf(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.4'));
  return new File([bytes], 'proof.pdf', { type: 'application/pdf' });
}
function request(file = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' })) {
  const body = new FormData();
  body.set('file', file); body.set('source_type', 'event_reconciliation'); body.set('source_id', 'event-A');
  return new Request('https://intra.test/api/evidence', { method: 'POST', headers: { origin: 'https://intra.test' }, body });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.getUser.mockResolvedValue({ data: { user: { id: 'actor-A' } }, error: null });
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'prepare_action_evidence'
    ? { id, storage_path: path }
    : name === 'complete_action_evidence' ? { reference: `evidence://${id}`, document_id: id, filename: 'proof.pdf' }
      : { storage_path: path, filename: 'proof.pdf', expires_in: 300 }, error: null }));
  state.upload.mockResolvedValue({ error: null });
  state.signed.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null });
});
it('fails closed before storage for an unauthorized record', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'Forbidden' } });
  expect((await POST(request())).status).toBe(403);
  expect(state.upload).not.toHaveBeenCalled();
});
it('reports an exhausted upload limit without mislabeling it as missing authority', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'Evidence upload limit reached. Try again later' } });
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: 'Evidence upload limit reached. Try again later.' });
  expect(state.upload).not.toHaveBeenCalled();
});
it('uploads only to a server-assigned path and returns durable registration, not a signed URL', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(state.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false });
  expect(state.rpc).toHaveBeenCalledWith('complete_action_evidence', { payload: { id } });
  expect(await response.json()).toMatchObject({ reference: `evidence://${id}`, document_id: id });
  expect(state.signed).not.toHaveBeenCalled();
});
it('does not register failed uploads', async () => {
  state.upload.mockResolvedValue({ error: { message: 'Unavailable' } });
  expect((await POST(request())).status).toBe(502);
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
it('rejects MIME spoofing and invalid file sizes', async () => {
  expect((await POST(request(new File(['<script>'], 'fake.pdf', { type: 'application/pdf' })))).status).toBe(400);
  expect((await POST(request(new File([], 'empty.pdf', { type: 'application/pdf' })))).status).toBe(400);
  expect(state.upload).not.toHaveBeenCalled();
});
it('requires same-origin authenticated requests', async () => {
  const foreign = request();
  foreign.headers.set('origin', 'https://foreign.test');
  expect((await POST(foreign)).status).toBe(403);
  state.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  expect(state.upload).not.toHaveBeenCalled();
});
it('resolves previews only after authorized record lookup with a five-minute expiry', async () => {
  const response = await POST(new Request('https://intra.test/api/evidence', { method: 'POST',
    headers: { origin: 'https://intra.test', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'open', reference: `evidence://${id}` }) }));
  expect(response.status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('action_evidence_access', { payload: { reference: `evidence://${id}` } });
  expect(state.signed).toHaveBeenCalledWith(path, 300, { download: 'proof.pdf' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

function preview(body: unknown = { action: 'open', reference: `evidence://${id}` }) {
  return new Request('https://intra.test/api/evidence', { method: 'POST',
    headers: { origin: 'https://intra.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
it('never signs a client-provided path, public URL, or unknown reference', async () => {
  for (const reference of [path, 'https://storage.test/public/file.pdf', 'evidence://not-an-id']) {
    expect((await POST(preview({ action: 'open', reference, storage_path: path }))).status).toBe(400);
  }
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.signed).not.toHaveBeenCalled();
});
it('does not sign when the record authorization RPC denies access', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'Forbidden' } });
  expect((await POST(preview())).status).toBe(403);
  expect(state.signed).not.toHaveBeenCalled();
});
it('fails closed for malformed RPC paths and never trusts returned expiry', async () => {
  state.rpc.mockResolvedValue({ data: { storage_path: '../other/secret.pdf', filename: 'secret', expires_in: 999999 }, error: null });
  expect((await POST(preview())).status).toBe(403);
  expect(state.signed).not.toHaveBeenCalled();
  state.rpc.mockResolvedValue({ data: { storage_path: path, filename: 'proof.pdf', expires_in: 999999 }, error: null });
  expect((await POST(preview())).status).toBe(200);
  expect(state.signed).toHaveBeenCalledWith(path,300,{ download: 'proof.pdf' });
});
it('requires registration success and matching identity before returning an upload', async () => {
  state.rpc.mockResolvedValueOnce({ data: { id, storage_path: path }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'Registration failed' } });
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).not.toHaveProperty('reference');
  state.rpc.mockResolvedValueOnce({ data: { id, storage_path: path }, error: null })
    .mockResolvedValueOnce({ data: { reference: 'https://storage.test/signed', document_id: id }, error: null });
  expect((await POST(request())).status).toBe(502);
});
it('rejects a prepared path that is not bound to the prepared ID and MIME', async () => {
  state.rpc.mockResolvedValue({ data: { id, storage_path: `business-evidence/${id}.png` }, error: null });
  expect((await POST(request())).status).toBe(403);
  expect(state.upload).not.toHaveBeenCalled();
});
it('rejects oversized files and oversized streams before preparing storage', async () => {
  const response = await POST(request(sizedPdf(MAX_FILE + 1)));
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: 'File is larger than the 4 MB limit.' });
  const oversized = preview();
  oversized.headers.set('content-length','5000');
  expect((await POST(oversized)).status).toBe(413);
  expect((await POST(preview({ action:'open', reference:'x'.repeat(5000) }))).status).toBe(413);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.upload).not.toHaveBeenCalled();
});
it('accepts an exact 4 MiB file including multipart overhead below the platform limit', async () => {
  const upload = request(sizedPdf(MAX_FILE));
  const bodySize = (await upload.clone().arrayBuffer()).byteLength;
  expect(bodySize).toBeGreaterThan(MAX_FILE);
  expect(bodySize).toBeLessThanOrEqual(MAX_MULTIPART);
  expect(MAX_MULTIPART).toBeLessThan(4_500_000);
  expect((await POST(upload)).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith('prepare_action_evidence', { payload: expect.objectContaining({ size_bytes: MAX_FILE }) });
});
it('rejects multipart bodies above 4 MiB plus 64 KiB, with or without Content-Length', async () => {
  const original = request(sizedPdf(MAX_FILE));
  const bytes = new Uint8Array(MAX_MULTIPART + 1);
  bytes.set(new Uint8Array(await original.arrayBuffer()));
  for (const declared of [true, false]) {
    const headers = new Headers(original.headers);
    if (declared) headers.set('content-length', String(bytes.byteLength));
    const response = await POST(new Request(original.url, { method: 'POST', headers, body: bytes }));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('4 MB');
  }
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.upload).not.toHaveBeenCalled();
});
it('rejects malformed bodies and unsupported source types without server writes', async () => {
  expect((await POST(preview(null))).status).toBe(400);
  const malformed = new Request('https://intra.test/api/evidence',{method:'POST',headers:{origin:'https://intra.test','content-type':'application/json'},body:'{'});
  expect((await POST(malformed)).status).toBe(400);
  const form = new FormData();
  form.set('file',new File(['%PDF-1.4'],'proof.pdf',{type:'application/pdf'}));
  form.set('source_type','unrestricted'); form.set('source_id','PO-A');
  expect((await POST(new Request('https://intra.test/api/evidence',{method:'POST',headers:{origin:'https://intra.test'},body:form}))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it('fails closed for signing and service failures without leaking internal errors', async () => {
  state.signed.mockResolvedValue({ data:null,error:{message:'internal credentials'} });
  let response = await POST(preview());
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain('credentials');
  state.getUser.mockRejectedValue(new Error('internal auth error'));
  response = await POST(request());
  expect(response.status).toBe(502);
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it.each([
  ['image/png','png',[137,80,78,71,13,10,26,10]],
  ['image/jpeg','jpg',[255,216,255,224]],
  ['image/webp','webp',[82,73,70,70,0,0,0,0,87,69,66,80]],
] as const)('accepts signature-checked %s uploads', async (mime,extension,signature) => {
  state.rpc.mockResolvedValueOnce({ data:{ id,storage_path:`business-evidence/${id}.${extension}` },error:null })
    .mockResolvedValueOnce({ data:{ reference:`evidence://${id}`,document_id:id },error:null });
  expect((await POST(request(new File([new Uint8Array(signature)],`proof.${extension}`,{type:mime})))).status).toBe(200);
});
