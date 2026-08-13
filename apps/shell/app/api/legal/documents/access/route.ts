import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 480;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const userClient = await createSupabaseServerClient('legal');
  if (!userClient) return jsonError('Supabase is not configured.', 503);

  const { data: verified, error: authError } = await userClient.auth.getUser();
  if (authError || !verified.user) return jsonError('Authentication required.', 401);

  let body: { document_id?: unknown; disposition?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON request.', 400);
  }
  const documentId = typeof body.document_id === 'string' ? body.document_id.trim() : '';
  if (!documentId) return jsonError('A document_id is required.', 400);

  const { data: document, error } = await userClient
    .schema('legal')
    .from('accreditation_docs')
    .select('id,filename,storage_path')
    .eq('id', documentId)
    .maybeSingle();
  if (error) return jsonError('Document access could not be verified.', 403);
  if (!document?.storage_path) return jsonError('Document not found.', 404);

  const { data: signed, error: signedError } = await userClient.storage
    .from('documents')
    .createSignedUrl(
      String(document.storage_path),
      SIGNED_URL_TTL_SECONDS,
      body.disposition === 'download' ? { download: String(document.filename) } : undefined,
    );
  if (signedError || !signed?.signedUrl) {
    return jsonError('Document access could not be prepared.', 502);
  }
  return NextResponse.json({ url: signed.signedUrl });
}
