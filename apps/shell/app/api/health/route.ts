// Ops health check (spec §9). Cheap, no-cache, safe to poll from load balancers.
// Reports supabase reachability without leaking credentials or user data.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  DATA_SOURCE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from '@shell/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SupabaseStatus = 'reachable' | 'unreachable' | 'not-configured';
type FeatureStatus = 'configured' | 'missing';
type ClientAuthStatus =
  | 'supabase-configured'
  | 'forced-memory'
  | 'missing-public-env'
  | 'production-demo-escape-hatch';
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

function clientAuthStatus(): ClientAuthStatus {
  if (
    DATA_SOURCE === 'memory' &&
    process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PROD === 'true'
  ) {
    return 'production-demo-escape-hatch';
  }
  if (DATA_SOURCE === 'memory') return 'forced-memory';
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 'missing-public-env';
  return 'supabase-configured';
}

function forwardedSelfFetchHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const key of ['authorization', 'cookie', 'x-vercel-protection-bypass']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
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
    const headers = forwardedSelfFetchHeaders(request);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const page = await fetch(new URL('/login', request.url), {
      cache: 'no-store',
      headers,
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
      headers,
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
  const clientAuth = clientAuthStatus();
  const healthy =
    supabase === 'reachable' &&
    staticAssets.status === 'reachable' &&
    clientAuth === 'supabase-configured';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      supabase,
      clientAuth,
      staticAssets,
      features: {
        vendorInviteDelivery: (
          process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
        ) ? 'configured' as FeatureStatus : 'missing' as FeatureStatus,
        serviceWorker: process.env.NEXT_PUBLIC_ENABLE_SW === 'false'
          ? 'missing' as FeatureStatus
          : 'configured' as FeatureStatus,
      },
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
