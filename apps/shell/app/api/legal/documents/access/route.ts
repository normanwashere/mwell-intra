import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import { createSupabaseAdminClient } from '@shell/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function isPreparedAccess(value: unknown): value is {
  storage_path: string;
  expires_in: number;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.storage_path === 'string' &&
    candidate.storage_path.length > 0 &&
    typeof candidate.expires_in === 'number' &&
    candidate.expires_in > 0
  );
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

  const purpose = body.disposition === 'download' ? 'download' : 'open';
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) return jsonError('Private document delivery is not configured.', 503);
  const { data: prepared, error } = await userClient
    .schema('legal')
    .rpc('prepare_document_signed_access', {
      payload: { document_id: documentId, purpose },
    });
  if (error || !isPreparedAccess(prepared)) {
    return jsonError('Document access could not be verified.', 403);
  }

  const { data: document, error: documentError } = await userClient
    .schema('legal')
    .from('accreditation_docs')
    .select('filename')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError || !document?.filename) return jsonError('Document not found.', 404);

  const { data: signed, error: signedError } = await adminClient.storage
    .from('documents')
    .createSignedUrl(
      String(prepared.storage_path),
      Number(prepared.expires_in),
      body.disposition === 'download' ? { download: String(document.filename) } : undefined,
    );
  if (signedError || !signed?.signedUrl) {
    return jsonError('Document access could not be prepared.', 502);
  }
  return NextResponse.json({ url: signed.signedUrl });
}
