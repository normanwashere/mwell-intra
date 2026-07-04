// Ops health check (spec §9). Cheap, no-cache, safe to poll from load balancers.
// Reports supabase reachability without leaking credentials or user data.

import { NextResponse } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@shell/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SupabaseStatus = 'reachable' | 'unreachable' | 'not-configured';

async function pingSupabase(): Promise<SupabaseStatus> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 'not-configured';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export async function GET() {
  const supabase = await pingSupabase();
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      supabase,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    {
      status: 200,
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
