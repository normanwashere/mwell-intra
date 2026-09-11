import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { sessionAuditReader } from './adminAuditReader';
import { parseAuditQuery } from './adminAuditQuery';
import type { ShellDatabase } from './supabase/types';

it('uses typed source filters, deterministic cursor bounds and inclusive local end dates without raw OR syntax', async () => {
  const requests: URL[] = [];
  const client = createClient<ShellDatabase, string>('https://example.test', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      requests.push(new URL(String(input)));
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const params = new URLSearchParams({ module: 'core"),or(id.gt.0', from: '2026-09-01', to: '2026-09-11', before: '800', snapshot: '900' });
  const reader = sessionAuditReader(client);
  await reader.events(parseAuditQuery(params));
  const request = requests[0];
  expect(request).toBeDefined();
  expect(request?.searchParams.get('module')).toBe('eq.core"),or(id.gt.0');
  expect(request?.searchParams.has('or')).toBe(false);
  expect(request?.searchParams.getAll('id')).toEqual(['lt.800', 'lte.900']);
  expect(request?.searchParams.getAll('created_at')).toEqual(['gte.2026-09-01T00:00:00+08:00', 'lt.2026-09-12T00:00:00+08:00']);
  expect(request?.searchParams.get('order')).toBe('id.desc');
  expect(request?.searchParams.get('limit')).toBe('250');
  await reader.actors([]);
  expect(requests).toHaveLength(1);
});
