import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import { parseAuditQuery, readAuditPage } from '@shell/lib/adminAuditQuery';
import { sessionAuditReader } from '@shell/lib/adminAuditReader';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerClient('core');
    if (!client) return NextResponse.json({ error: 'Audit history is unavailable in this environment.' }, { status: 503, headers });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ error: 'Sign in to view audit history.' }, { status: 401, headers });
    const capability = await client.schema('core').rpc('has_live_cap', { p_module: 'core', p_cap: 'view_audit' });
    if (capability.error) throw capability.error;
    if (capability.data !== true) return NextResponse.json({ error: 'Audit access is not available for this account.' }, { status: 403, headers });
    let query;
    try { query = parseAuditQuery(new URL(request.url).searchParams); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400, headers }); }
    return NextResponse.json(await readAuditPage(sessionAuditReader(client, request.signal), query), { headers });
  } catch {
    // Never expose database diagnostics or partial authorized batches to clients.
    return NextResponse.json({ error: 'Audit history could not be loaded. Retry with the same filters.' }, { status: 503, headers });
  }
}
