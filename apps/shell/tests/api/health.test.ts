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
    delete process.env.LEGAL_DOCUMENT_EDGE_FUNCTION;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.APP_ENV = 'uat';
    process.env.NEXT_PUBLIC_ENABLE_NOTIFICATIONS = 'true';
    process.env.GITHUB_SHA = 'audit-commit-sha';
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
    delete process.env.NEXT_PUBLIC_ENABLE_NOTIFICATIONS;
    delete process.env.GITHUB_SHA;
    delete process.env.LEGAL_DOCUMENT_EDGE_FUNCTION;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.DEPLOYMENT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
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
    expect(body.features.notifications).toBe('configured');
    expect(body.features.legalDocumentDelivery).toBe('missing');
    expect(body.commit).toBe('audit-commit-sha');
    expect(JSON.stringify(body)).not.toContain('anon-secret-value');
  });

  it('reports private Legal delivery only when a server delivery path is configured', async () => {
    process.env.LEGAL_DOCUMENT_EDGE_FUNCTION = 'legal-document-access';

    const response = await GET(
      new Request('https://uat.example.com/api/health') as never,
    );
    const body = await response.json();

    expect(body.features.legalDocumentDelivery).toBe('configured');
    expect(JSON.stringify(body)).not.toContain('legal-document-access');
  });

  it('recognizes the current server-only Supabase secret key without exposing it', async () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_private-value';

    const response = await GET(
      new Request('https://uat.example.com/api/health') as never,
    );
    const body = await response.json();

    expect(body.features.legalDocumentDelivery).toBe('configured');
    expect(JSON.stringify(body)).not.toContain('sb_secret_private-value');
  });

  it('falls back to the CI commit when the Vercel commit variable is blank', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '   ';

    const response = await GET(
      new Request('https://uat.example.com/api/health') as never,
    );
    const body = await response.json();

    expect(body.commit).toBe('audit-commit-sha');
  });

  it('uses the explicit deployment commit when provider commit variables are unavailable', async () => {
    delete process.env.GITHUB_SHA;
    process.env.DEPLOYMENT_COMMIT_SHA = 'deployed-commit-sha';

    const response = await GET(
      new Request('https://uat.example.com/api/health') as never,
    );
    const body = await response.json();

    expect(body.commit).toBe('deployed-commit-sha');
  });
});
