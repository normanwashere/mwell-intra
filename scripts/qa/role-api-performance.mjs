import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PERFORMANCE_ORIGIN, PERFORMANCE_PROJECT, runRoleApiPerformance } from './role-api-performance-run.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

export function performanceTransport(env, fetchImpl = fetch) {
  return {
    async readHealth(signal) {
      const response = await fetchImpl(`${PERFORMANCE_ORIGIN}/api/health`, { signal, cache: 'no-store', redirect: 'error' });
      assert(response.ok, `Deployment health returned HTTP ${response.status}`);
      return response.json();
    },
    async login(persona, signal) {
      const client = createClient(`https://${PERFORMANCE_PROJECT}.supabase.co`,
        'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: (url, init) => fetchImpl(url, { ...init, redirect: 'error',
            signal: AbortSignal.any([signal, init?.signal].filter(Boolean)) }) },
        });
      const { data, error } = await client.auth.signInWithPassword({ email: persona.email, password: env.AUDIT_PASSWORD });
      assert(!error, `Login failed (${error?.code ?? error?.status ?? 'request error'})`);
      assert(data?.user?.email === persona.email && data.user.role === 'authenticated' &&
        data.session?.access_token && data.session.user?.id === data.user.id,
      'Login did not return the exact authenticated audit identity');
      return client;
    },
    async readSnapshot(client, signal) {
      const { data, error, status } = await client.schema('core').rpc('my_capability_snapshot').abortSignal(signal);
      assert(!error, `Capability read failed (HTTP ${status}; ${error?.code ?? 'request error'})`);
      return data;
    },
  };
}

export async function main(env = process.env, { fetchImpl = fetch, log = console.log,
  persist = async report => {
    const output = path.resolve('outputs/sep12-performance', env.PERF_RUN);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'api.json'), JSON.stringify(report, null, 2));
  },
} = {}) {
  assert(typeof env.PERF_RUN === 'string' && /^[a-z0-9-]+$/.test(env.PERF_RUN), 'Provide a safe PERF_RUN');
  let report;
  try {
    report = await runRoleApiPerformance({ env, ...performanceTransport(env, fetchImpl) });
  } catch (error) {
    report = { complete: false, results: [], errors: [{ phase: 'configuration', message: error.message }] };
  }
  const output = path.resolve('outputs/sep12-performance', env.PERF_RUN);
  await persist(report);
  log(JSON.stringify({ complete: report.complete, reads: report.results.length, output, errors: report.errors }));
  if (!report.complete) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
