import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shell/lib/supabase/env', () => ({
  DATA_SOURCE: 'supabase',
  SUPABASE_ANON_KEY: 'anon-secret-value',
  SUPABASE_URL: 'https://uatref123.supabase.co',
}));

let GET: typeof import('@shell/app/api/health/route').GET;

describe('GET /api/health', () => {
  beforeAll(async () => {
    ({ GET } = await import('@shell/app/api/health/route'));
  });

  beforeEach(() => {
    process.env.APP_ENV = 'uat';
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/health')) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith('/login')) {
        return new Response(
          '<script src="/_next/static/chunks/app.js"></script>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (url.endsWith('/_next/static/chunks/app.js')) {
        return new Response('console.log("ok")', {
          status: 200,
          headers: { 'content-type': 'application/javascript' },
        });
      }
      throw new Error(`Unexpected health probe URL: ${url}`);
    }));
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    vi.unstubAllGlobals();
  });

  it('reports the safe deployed environment and exact Supabase project ref', async () => {
    const response = await GET(
      new Request('https://uat.example.com/api/health') as never,
    );
    const body = await response.json();

    expect(body.deployment).toEqual({
      appEnv: 'uat',
      supabaseProjectRef: 'uatref123',
    });
    expect(JSON.stringify(body)).not.toContain('anon-secret-value');
  });
});
