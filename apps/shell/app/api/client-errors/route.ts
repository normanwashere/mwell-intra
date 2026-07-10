import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SAFE_SCOPE = /^[a-z0-9_-]{1,40}$/i;
const SAFE_DIGEST = /^[a-z0-9_-]{1,120}$/i;

function safeRoute(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/unknown';
  }
  return value.split(/[?#]/, 1)[0]!.slice(0, 160);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 4096) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-origin reports are not accepted.' }, { status: 403 });
  }

  const client = await createSupabaseServerClient('core');
  if (!client) return NextResponse.json({ error: 'Telemetry is unavailable.' }, { status: 503 });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: { scope?: unknown; digest?: unknown; route?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }
  const scope = typeof body.scope === 'string' && SAFE_SCOPE.test(body.scope)
    ? body.scope.toLowerCase()
    : 'shell';
  const digest = typeof body.digest === 'string' && SAFE_DIGEST.test(body.digest)
    ? body.digest
    : null;
  const correlationId = crypto.randomUUID();

  // Structured deployment logs are the transport. Do not add stack traces,
  // raw messages, emails, URLs with query strings, or form content here.
  console.error(JSON.stringify({
    event: 'intra_client_route_error',
    correlationId,
    scope,
    digest,
    route: safeRoute(body.route),
    userId: data.user.id,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    timestamp: new Date().toISOString(),
  }));

  return NextResponse.json({ accepted: true, correlationId }, { status: 202 });
}
