import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PERFORMANCE_PROJECT, performanceConfig, boundedOperation, snapshotFingerprint, runRoleApiPerformance } from './role-api-performance-run.mjs';
import { main, performanceTransport } from './role-api-performance.mjs';

const commit = 'a'.repeat(40);
const env = { APP_ENV: 'uat', PERF_RUN: 'isolated-test', AUDIT_PASSWORD: 'local-test-secret',
  PERF_EXPECTED_COMMIT: commit, AUDIT_IDENTITY_SCOPE: 'checkpoint-v1' };
const health = () => ({ status: 'ok', supabase: 'reachable', commit, deployment: { appEnv: 'uat', supabaseProjectRef: 'kkoitlvydytdhlpxhuah' } });
const snapshot = role => ({ roleCapabilities: { warehouse: ['read', role] }, userCapabilities: { warehouse: ['read'] } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('target project is the independently observed UAT literal, not the duplicate-yt typo', () => {
  assert.equal(PERFORMANCE_PROJECT, 'kkoitlvydytdhlpxhuah');
});

for (const boundary of ['start', 'end']) {
  for (const unhealthy of [{ status: 'degraded' }, { status: undefined }, { supabase: 'unreachable' }, { supabase: undefined }]) {
    test(`${boundary} health rejects same-commit unhealthy status ${JSON.stringify(unhealthy)}`, async () => {
      let reads = 0;
      const h = fixture({ readHealth: async () => ++reads === (boundary === 'start' ? 1 : 2) ? { ...health(), ...unhealthy } : health() });
      const report = await h.run();
      assert.equal(report.complete, false);
      assert.equal(report.errors.at(-1).phase, `${boundary}-health`);
      assert.equal(report.results.length, boundary === 'start' ? 0 : 99);
    });
  }
}

function fixture(overrides = {}) {
  const calls = { health: 0, logins: [], reads: 0, active: 0, peak: [0, 0, 0] };
  const transport = {
    async readHealth() { calls.health++; return health(); },
    async login(persona) { calls.logins.push(persona); return persona.role; },
    async readSnapshot(role, signal) {
      assert.equal(signal.aborted, false);
      const stage = Math.floor(calls.reads++ / 33);
      calls.active++;
      calls.peak[stage] = Math.max(calls.peak[stage], calls.active);
      await delay(1);
      calls.active--;
      return snapshot(role);
    },
    ...overrides,
  };
  return { calls, transport, run: extraEnv => runRoleApiPerformance({ env: { ...env, ...extraEnv }, ...transport }) };
}

test('successful scoped run performs exactly 99 reads, 33 per stage, with peaks 1/3/5 and nine stable samples per role', async () => {
  const h = fixture();
  const report = await h.run();
  assert.equal(report.complete, true);
  assert.equal(h.calls.health, 2);
  assert.equal(h.calls.reads, 99);
  assert.deepEqual(h.calls.peak, [1, 3, 5]);
  assert.equal(h.calls.logins.length, 11);
  assert.ok(h.calls.logins.every(persona => persona.email.startsWith('intra.ci.checkpoint-v1.')));
  assert.deepEqual(report.stages.map(row => [row.concurrency, row.requests, row.complete]), [[1, 33, true], [3, 33, true], [5, 33, true]]);
  assert.ok(report.roleStability.every(row => row.samples === 9 && row.stable));
  assert.equal(JSON.stringify(report).includes(env.AUDIT_PASSWORD), false);
  assert.match(report.methodology, /Not sustained-load/);
});

test('canonical identities remain the explicit no-scope default and GITHUB_SHA is supported', () => {
  const config = performanceConfig({ ...env, AUDIT_IDENTITY_SCOPE: undefined, PERF_EXPECTED_COMMIT: undefined, GITHUB_SHA: commit });
  assert.ok(config.personas.every(persona => persona.email.startsWith('intra.test.')));
  assert.equal(config.expectedCommit, commit);
});

for (const override of [{ APP_ENV: undefined }, { APP_ENV: 'production' }, { AUDIT_IDENTITY_SCOPE: 'unknown' },
  { PERF_EXPECTED_COMMIT: undefined }, { PERF_EXPECTED_COMMIT: 'aaaaaaa' }, { PERF_RUN: '../escape' },
  { AUDIT_PASSWORD: '' }, { PERF_REQUEST_TIMEOUT_MS: 'Infinity' }, { PERF_REQUEST_TIMEOUT_MS: '60001' },
  { PERF_RUN_TIMEOUT_MS: '600001' }, { PERF_RUN_TIMEOUT_MS: '-1' }]) {
  test(`invalid ${JSON.stringify(override)} fails before any network or login`, async () => {
    const h = fixture();
    await assert.rejects(h.run(override));
    assert.equal(h.calls.health, 0);
    assert.equal(h.calls.logins.length, 0);
  });
}

for (const wrong of [{ ...health(), commit: 'b'.repeat(40) }, { deployment: health().deployment },
  { ...health(), deployment: { appEnv: 'production', supabaseProjectRef: 'kkoitlvydytdhlpxhuah' } },
  { ...health(), deployment: { appEnv: 'uat', supabaseProjectRef: 'other' } }]) {
  test(`start identity mismatch ${JSON.stringify(wrong)} is recorded without login`, async () => {
    const h = fixture({ readHealth: async () => wrong });
    const report = await h.run();
    assert.equal(report.complete, false);
    assert.equal(report.errors[0].phase, 'start-health');
    assert.equal(h.calls.logins.length, 0);
    assert.equal(report.results.length, 0);
  });
}

test('end deployment drift invalidates an otherwise successful 99-read run', async () => {
  let n = 0;
  const h = fixture({ readHealth: async () => ({ ...health(), commit: ++n === 1 ? commit : 'b'.repeat(40) }) });
  const report = await h.run();
  assert.equal(report.results.length, 99);
  assert.equal(report.complete, false);
  assert.equal(report.errors.at(-1).phase, 'end-health');
  assert.equal(report.endHealth.commit, 'b'.repeat(40));
});

test('login failure stops additional accounts and all reads, preserves evidence and rechecks end identity', async () => {
  let logins = 0;
  const h = fixture({ login: async () => { logins++; throw new Error(`denied ${env.AUDIT_PASSWORD}`); } });
  const report = await h.run();
  assert.equal(report.complete, false);
  assert.equal(logins, 1);
  assert.equal(h.calls.reads, 0);
  assert.equal(h.calls.health, 2);
  assert.equal(report.logins.length, 1);
  assert.equal(JSON.stringify(report).includes(env.AUDIT_PASSWORD), false);
});

for (const behavior of ['error', 'null', 'drift']) {
  test(`stage-3 ${behavior} stops new dispatch and stage 5 while retaining settled in-flight reads`, async () => {
    let reads = 0;
    const h = fixture({ readSnapshot: async role => {
      const n = ++reads;
      if (n === 34) {
        if (behavior === 'error') throw new Error('read denied');
        if (behavior === 'null') return null;
        return snapshot('different-authority');
      }
      await delay(2);
      return snapshot(role);
    } });
    const report = await h.run();
    assert.equal(report.complete, false);
    assert.ok(reads >= 34 && reads <= 36);
    assert.equal(report.results.length, reads);
    assert.deepEqual(report.stages.map(row => row.concurrency), [1, 3]);
    assert.equal(report.errors[0].concurrency, 3);
    assert.equal(h.calls.health, 2);
  });
}

test('fingerprints ignore object-key and capability-set order but reject missing or changed authority', () => {
  const value = snapshot('receive_stock');
  const reordered = { userCapabilities: value.userCapabilities,
    roleCapabilities: { warehouse: ['receive_stock', 'read'] } };
  assert.equal(snapshotFingerprint(value), snapshotFingerprint(reordered));
  assert.notEqual(snapshotFingerprint(value), snapshotFingerprint(snapshot('inspect_quality')));
  for (const invalid of [null, [], {}, { roleCapabilities: {}, userCapabilities: null },
    { roleCapabilities: { warehouse: [''] }, userCapabilities: {} }]) assert.throws(() => snapshotFingerprint(invalid));
});

test('timeout rejects a hung operation and aborts its transport signal', async () => {
  let signal;
  await assert.rejects(boundedOperation('hung read', 10, value => {
    signal = value;
    return new Promise(() => {});
  }), /hung read timed out/);
  assert.equal(signal.aborted, true);
});

test('run deadline records incomplete evidence rather than fabricating end-health success', async t => {
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const h = fixture({ readSnapshot: async () => {
    // The real request timer still expires and aborts; end-health must see an
    // exhausted monotonic budget, independent of sub-millisecond timer rounding.
    clock = 101;
    return new Promise(() => {});
  } });
  const report = await h.run({ PERF_RUN_TIMEOUT_MS: '100' });
  assert.equal(report.complete, false);
  assert.equal(report.results.length, 1);
  assert.match(report.results[0].error, /timed out/);
  assert.ok(report.errors.some(row => row.phase === 'end-health'));
  assert.equal(report.endHealth, null);
  assert.equal(h.calls.health, 1);
});

test('installed SDK transport uses scoped auth, abort signals and only the capability snapshot RPC', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, init });
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.redirect, 'error');
    if (parsed.hostname === 'mwell-intra-uat.vercel.app') {
      assert.equal(parsed.pathname, '/api/health');
      assert.equal(init.cache, 'no-store');
      return Response.json(health());
    }
    assert.equal(parsed.hostname, 'kkoitlvydytdhlpxhuah.supabase.co');
    if (parsed.pathname === '/auth/v1/token') {
      assert.equal(parsed.search, '?grant_type=password');
      const body = JSON.parse(init.body);
      assert.ok(body.email.startsWith('intra.ci.checkpoint-v1.'));
      const user = { id: body.email, email: body.email, role: 'authenticated' };
      return Response.json({ access_token: 'test-only-token', refresh_token: 'test-only-refresh', expires_in: 3600, user, token_type: 'bearer' });
    }
    assert.equal(parsed.pathname, '/rest/v1/rpc/my_capability_snapshot');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('content-profile'), 'core');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-only-token');
    return Response.json(snapshot('test-role'));
  };
  const report = await runRoleApiPerformance({ env, ...performanceTransport(env, fetchImpl) });
  assert.equal(report.complete, true, JSON.stringify(report.errors));
  assert.equal(requests.filter(row => row.url.pathname === '/api/health').length, 2);
  assert.equal(requests.filter(row => row.url.pathname === '/auth/v1/token').length, 11);
  assert.equal(requests.filter(row => row.url.pathname === '/rest/v1/rpc/my_capability_snapshot').length, 99);
  assert.equal(JSON.stringify(report).includes('test-only-token'), false);
});

for (const failure of ['health HTTP', 'health JSON', 'login HTTP', 'wrong user', 'snapshot HTTP']) {
  test(`installed SDK ${failure} is not treated as a successful read`, async () => {
    const fetchImpl = async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/health') {
        if (failure === 'health HTTP') return Response.json({}, { status: 503 });
        if (failure === 'health JSON') return new Response('bad json');
        return Response.json(health());
      }
      if (pathname === '/auth/v1/token') {
        if (failure === 'login HTTP') return Response.json({ error_code: 'invalid_credentials', msg: 'denied' }, { status: 400 });
        const email = failure === 'wrong user' ? 'other@example.test' : JSON.parse(init.body).email;
        return Response.json({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600,
          user: { id: email, email, role: 'authenticated' }, token_type: 'bearer' });
      }
      assert.equal(pathname, '/rest/v1/rpc/my_capability_snapshot');
      return Response.json({ code: '42501', message: 'denied' }, { status: 403 });
    };
    const report = await runRoleApiPerformance({ env, ...performanceTransport(env, fetchImpl) });
    assert.equal(report.complete, false);
    assert.ok(report.errors.length > 0);
    assert.ok(report.results.length <= 1);
  });
}

test('performance entry point is import-safe and fails the process on an incomplete report', () => {
  const source = readFileSync(new URL('./role-api-performance.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('pathToFileURL(process.argv[1]).href'), 'Do not log in merely by importing the harness');
  assert.ok(source.includes('runRoleApiPerformance'));
  assert.ok(source.includes('report.complete'));
  assert.ok(source.includes('process.exitCode = 1'));
});

test('actual entry point persists failure evidence and sets failing exit status without logging credentials', async () => {
  const previous = process.exitCode;
  const reports = [], logs = [];
  try {
    process.exitCode = 0;
    const report = await main(env, {
      fetchImpl: async url => {
        assert.equal(new URL(url).pathname, '/api/health');
        return Response.json({ ...health(), status: 'degraded' });
      },
      persist: async value => reports.push(structuredClone(value)),
      log: value => logs.push(value),
    });
    assert.equal(process.exitCode, 1);
    assert.equal(report.complete, false);
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], report);
    assert.equal(report.errors[0].phase, 'start-health');
    assert.equal(logs.join('').includes(env.AUDIT_PASSWORD), false);
  } finally {
    process.exitCode = previous;
  }
});

for (const endpoint of ['health body', 'login', 'snapshot']) {
  test(`installed SDK ${endpoint} hang aborts within request budget and records failure`, async () => {
    let hungSignal;
    const fetchImpl = async (url, init) => {
      const pathname = new URL(url).pathname;
      const hang = () => {
        hungSignal = init.signal;
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      };
      if (pathname === '/api/health') {
        if (endpoint === 'health body') return { ok: true, json: hang };
        return Response.json(health());
      }
      if (pathname === '/auth/v1/token') {
        if (endpoint === 'login') return hang();
        const email = JSON.parse(init.body).email;
        return Response.json({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600,
          user: { id: email, email, role: 'authenticated' }, token_type: 'bearer' });
      }
      assert.equal(pathname, '/rest/v1/rpc/my_capability_snapshot');
      return hang();
    };
    const testEnv = { ...env, PERF_REQUEST_TIMEOUT_MS: '100' };
    const report = await runRoleApiPerformance({ env: testEnv, ...performanceTransport(testEnv, fetchImpl) });
    assert.equal(report.complete, false);
    assert.equal(hungSignal.aborted, true);
    assert.ok(report.errors.length > 0);
    assert.ok(report.results.length <= 1);
  });
}
