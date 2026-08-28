import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import { createSupabaseAdminClient } from '@shell/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE = 4 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REFERENCE = new RegExp(`^evidence://${UUID}$`);
const PATH = new RegExp(`^business-evidence/${UUID}\\.(pdf|jpg|png|webp)$`);
const TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};
const SOURCES = new Set(['event_reconciliation', 'procurement_request', 'purchase_order',
  'payment_readiness_pack', 'payment_release', 'warehouse_receipt']);
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});
const fail = (error: string, status: number) => json({ error }, status);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesMime(bytes: Uint8Array, mime: string) {
  const starts = (values: number[], offset = 0) => values.every((value, i) => bytes[offset + i] === value);
  if (mime === 'application/pdf') return starts([37, 80, 68, 70, 45]);
  if (mime === 'image/jpeg') return starts([255, 216, 255]);
  if (mime === 'image/png') return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  return mime === 'image/webp' && starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8);
}

async function readBounded(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Empty body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return fail('Same-origin request required.', 403);
  try {
    const client = await createSupabaseServerClient('core');
    if (!client) return fail('Evidence service is not configured.', 503);
    const { data: verified, error: authError } = await client.auth.getUser();
    if (authError || !verified.user) return fail('Authentication required.', 401);
    const contentType = request.headers.get('content-type') ?? '';
    const opening = contentType.split(';')[0]?.trim() === 'application/json';
    if (!opening && !contentType.startsWith('multipart/form-data;')) return fail('Unsupported request type.', 400);
    const limit = opening ? 4096 : MAX_FILE + 64 * 1024;
    const sizeError = opening ? 'Evidence request is too large.'
      : 'Upload exceeds the 4 MB file limit or the multipart request limit.';
    if (Number(request.headers.get('content-length')) > limit) return fail(sizeError, 413);
    let bytes: Uint8Array;
    try { bytes = await readBounded(request, limit); }
    catch (cause) { return cause instanceof RangeError ? fail(sizeError, 413) : fail('Invalid evidence request.', 400); }

    const admin = createSupabaseAdminClient();
    if (!admin) return fail('Private evidence delivery is not configured.', 503);
    if (opening) {
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return fail('Invalid JSON request.', 400); }
      if (!body || body.action !== 'open' || typeof body.reference !== 'string' || !REFERENCE.test(body.reference)) {
        return fail('A registered evidence reference is required.', 400);
      }
      const { data, error } = await client.schema('core').rpc('action_evidence_access', { payload: { reference: body.reference } });
      if (error || !isRecord(data) || typeof data.storage_path !== 'string' || !PATH.test(data.storage_path)
        || typeof data.filename !== 'string' || !data.filename.trim()) return fail('Evidence access denied.', 403);
      const { data: signed, error: signError } = await admin.storage.from('documents')
        .createSignedUrl(data.storage_path, 300, { download: data.filename });
      if (signError || !signed?.signedUrl) return fail('Evidence preview could not be prepared. Try again.', 502);
      return json({ url: signed.signedUrl });
    }

    let form: FormData;
    try { form = await new Response(bytes as BodyInit, { headers: { 'content-type': contentType } }).formData(); }
    catch { return fail('Invalid upload request.', 400); }
    const file = form.get('file');
    const sourceType = form.get('source_type');
    const sourceId = form.get('source_id');
    if (file instanceof File && file.size > MAX_FILE) return fail('File is larger than the 4 MB limit.', 413);
    if (!(file instanceof File) || !TYPES[file.type] || file.size < 1
      || !file.name.trim() || file.name.length > 255
      || Array.from(file.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || typeof sourceType !== 'string' || !SOURCES.has(sourceType)
      || typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 255) {
      return fail('Choose a valid record and a non-empty JPEG, PNG, WebP or PDF up to 4 MB.', 400);
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesMime(fileBytes, file.type)) return fail('The file contents do not match its declared type.', 400);
    const { data: prepared, error: prepareError } = await client.schema('core').rpc('prepare_action_evidence', {
      payload: { source_type: sourceType, source_id: sourceId.trim(), filename: file.name, mime_type: file.type, size_bytes: file.size },
    });
    if (prepareError?.message === 'Evidence upload limit reached. Try again later') {
      return fail('Evidence upload limit reached. Try again later.', 429);
    }
    if (prepareError || !isRecord(prepared) || typeof prepared.id !== 'string' || !new RegExp(`^${UUID}$`).test(prepared.id)
      || prepared.storage_path !== `business-evidence/${prepared.id}.${TYPES[file.type]}`) return fail('Evidence upload is not authorized for this record.', 403);
    const { error: uploadError } = await admin.storage.from('documents').upload(prepared.storage_path, fileBytes, {
      contentType: file.type, upsert: false,
    });
    if (uploadError) return fail('Private evidence upload failed. Try again.', 502);
    const { data: registered, error: registerError } = await client.schema('core').rpc('complete_action_evidence', { payload: { id: prepared.id } });
    if (registerError || !isRecord(registered) || registered.reference !== `evidence://${prepared.id}` || registered.document_id !== prepared.id) {
      // Leave uncompleted objects private: an uncertain completion must never delete a committed document.
      return fail('Evidence registration could not be confirmed. Retry the upload.', 502);
    }
    return json({ reference: registered.reference, document_id: registered.document_id, filename: file.name });
  } catch {
    return fail('Evidence service is unavailable. Try again.', 502);
  }
}
