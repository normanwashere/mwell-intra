// Ops health check (spec §9). Cheap, no-cache, safe to poll from load balancers.
// Reports supabase reachability without leaking credentials or user data.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@shell/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SupabaseStatus = 'reachable' | 'unreachable' | 'not-configured';
type StaticAssetsStatus =
  | 'reachable'
  | 'missing-page-assets'
  | 'http-unreachable'
  | 'http-bad-status'
  | 'http-bad-content-type';

interface StaticAssetProbe {
  readonly status: StaticAssetsStatus;
  readonly asset?: string;
  readonly statusCode?: number;
  readonly contentType?: string;
}

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

async function probeStaticAssets(request: NextRequest): Promise<StaticAssetProbe> {
  let asset: string | undefined;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const page = await fetch(new URL('/login', request.url), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!page.ok) {
      clearTimeout(timer);
      return { status: 'http-bad-status', asset: '/login', statusCode: page.status };
    }
    const html = await page.text();
    asset = html.match(/\/_next\/static\/[^"'<>]+\.(?:js|css)/)?.[0];
    if (!asset) {
      clearTimeout(timer);
      return { status: 'missing-page-assets' };
    }
    const res = await fetch(new URL(asset, request.url), {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return { status: 'http-bad-status', asset, statusCode: res.status, contentType };
    }
    if (asset.endsWith('.js') && !contentType.includes('javascript')) {
      return { status: 'http-bad-content-type', asset, statusCode: res.status, contentType };
    }
    if (asset.endsWith('.css') && !contentType.includes('text/css')) {
      return { status: 'http-bad-content-type', asset, statusCode: res.status, contentType };
    }
    return { status: 'reachable', asset, statusCode: res.status, contentType };
  } catch {
    return { status: 'http-unreachable', asset };
  }
}

export async function GET(request: NextRequest) {
  const [supabase, staticAssets] = await Promise.all([
    pingSupabase(),
    probeStaticAssets(request),
  ]);
  return NextResponse.json(
    {
      status: staticAssets.status === 'reachable' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      supabase,
      staticAssets,
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
