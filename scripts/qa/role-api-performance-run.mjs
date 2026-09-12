import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { auditPersonas } from './uat-audit-identities.mjs';

export const PERFORMANCE_ORIGIN = 'https://mwell-intra-uat.vercel.app';
export const PERFORMANCE_PROJECT = 'kkoitlvydytdhlpxhuah';
export const CONCURRENCY_STAGES = Object.freeze([1, 3, 5]);

export function performanceConfig(env) {
  assert.equal(env.APP_ENV, 'uat', 'APP_ENV must explicitly be uat');
  assert(typeof env.PERF_RUN === 'string' && /^[a-z0-9-]+$/.test(env.PERF_RUN), 'Provide a safe PERF_RUN');
  assert(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length > 0, 'Provide AUDIT_PASSWORD');
  const expectedCommit = env.PERF_EXPECTED_COMMIT ?? env.GITHUB_SHA;
  assert(typeof expectedCommit === 'string' && /^[a-f0-9]{40}$/.test(expectedCommit),
    'PERF_EXPECTED_COMMIT (or GITHUB_SHA) must be the exact 40-character deployed commit');
  const bounded = (name, fallback, max) => {
    const value = Number(env[name] ?? fallback);
    assert(Number.isSafeInteger(value) && value >= 100 && value <= max, `${name} must be an integer between 100 and ${max} ms`);
    return value;
  };
  const identityScope = env.AUDIT_IDENTITY_SCOPE ?? '';
  const personas = auditPersonas(identityScope);
  assert.equal(personas.length, 11, 'This bounded benchmark requires exactly 11 personas');
  assert.equal(new Set(personas.map(persona => persona.role)).size, 11);
  return { run: env.PERF_RUN, expectedCommit, identityScope, personas,
    requestTimeoutMs: bounded('PERF_REQUEST_TIMEOUT_MS', 15000, 60000),
    runTimeoutMs: bounded('PERF_RUN_TIMEOUT_MS', 300000, 600000) };
}

export async function boundedOperation(label, timeoutMs, work) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs)} ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function validateHealth(health, expectedCommit) {
  assert.equal(health?.status, 'ok', 'Deployment health status must be ok');
  assert.equal(health?.supabase, 'reachable', 'Deployment Supabase must be reachable');
  assert.equal(health?.deployment?.appEnv, 'uat', 'Deployed APP_ENV must be uat');
  assert.equal(health?.deployment?.supabaseProjectRef, PERFORMANCE_PROJECT, 'Deployed project must be the exact UAT project');
  assert.equal(health?.commit, expectedCommit, 'Deployed commit must exactly match the expected commit');
}

export function snapshotFingerprint(snapshot) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Missing capability snapshot');
  for (const key of ['roleCapabilities', 'userCapabilities']) {
    const projection = snapshot[key];
    assert(projection && typeof projection === 'object' && !Array.isArray(projection), `Missing ${key} projection`);
    assert(Object.values(projection).every(caps => Array.isArray(caps) && caps.every(cap => typeof cap === 'string' && cap.trim())),
      `Malformed ${key} projection`);
  }
  // Object order is not authority; capability arrays are sets. Retain all
  // fields and values, normalizing only their serialization order.
  const canonical = value => Array.isArray(value)
    ? value.every(item => typeof item === 'string') ? [...value].sort() : value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value;
  return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}

export async function runRoleApiPerformance({ env, readHealth, login, readSnapshot }) {
  const config = performanceConfig(env);
  const { personas, ...publicConfig } = config;
  const report = { ...publicConfig, origin: PERFORMANCE_ORIGIN, project: PERFORMANCE_PROJECT,
    plannedReads: 99, health: null, endHealth: null, results: [], logins: [], stages: [], errors: [],
    roleStability: [], complete: false, startedAt: new Date().toISOString(),
    hashAlgorithm: 'sha256-canonical-json-capability-sets-v1',
    methodology: '99 authenticated read-only capability snapshots: 11 personas, 3 samples each at concurrency 1, 3 and 5. Stop dispatching on the first error or inconsistent role result; in-flight reads settle within deadlines. Not sustained-load, write-load or maximum-capacity certification.' };
  const deadline = performance.now() + config.runTimeoutMs;
  const operation = (label, work) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('Performance run deadline exceeded');
    return boundedOperation(label, Math.min(config.requestTimeoutMs, remaining), work);
  };
  const message = error => (error instanceof Error ? error.message : String(error)).replaceAll(env.AUDIT_PASSWORD, '[redacted]');
  const hashes = new Map();
  let started = false;
  let phase = 'start-health';
  try {
    report.health = await operation(phase, readHealth);
    validateHealth(report.health, config.expectedCommit);
    started = true;
    const clients = [];
    phase = 'login';
    for (const persona of personas) {
      const start = performance.now();
      try {
        clients.push({ role: persona.role, client: await operation(`login ${persona.role}`, signal => login(persona, signal)) });
        report.logins.push({ role: persona.role, ms: Math.round(performance.now() - start), error: null });
      } catch (error) {
        report.logins.push({ role: persona.role, ms: Math.round(performance.now() - start), error: message(error) });
        throw error;
      }
    }
    phase = 'snapshot';
    for (const concurrency of CONCURRENCY_STAGES) {
      const jobs = clients.flatMap(item => Array.from({ length: 3 }, (_, sample) => ({ ...item, sample })));
      let next = 0;
      let stopped = false;
      const start = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (!stopped && next < jobs.length) {
          const { client, role, sample } = jobs[next++];
          const t = performance.now();
          const row = { role, concurrency, sample, ms: null, error: null, hash: null };
          try {
            const data = await operation(`snapshot ${role}`, signal => readSnapshot(client, signal));
            row.hash = snapshotFingerprint(data);
            if (!hashes.has(role)) hashes.set(role, row.hash);
            assert.equal(row.hash, hashes.get(role), `Capability result changed for ${role} at concurrency ${concurrency}`);
          } catch (error) {
            stopped = true;
            row.error = message(error);
            report.errors.push({ phase, role, concurrency, sample, message: row.error });
          } finally {
            row.ms = Math.round(performance.now() - t);
            report.results.push(row);
          }
        }
      }));
      report.stages.push({ concurrency, requests: next, plannedRequests: 33,
        elapsedMs: Math.round(performance.now() - start), complete: !stopped && next === 33 });
      if (stopped) break;
    }
  } catch (error) {
    report.errors.push({ phase, message: message(error) });
  } finally {
    if (started) {
      try {
        report.endHealth = await operation('end-health', readHealth);
        validateHealth(report.endHealth, config.expectedCommit);
      } catch (error) {
        report.errors.push({ phase: 'end-health', message: message(error) });
      }
    }
    report.roleStability = personas.map(({ role }) => {
      const rows = report.results.filter(row => row.role === role);
      return { role, samples: rows.length, stable: rows.length === 9 && rows.every(row => !row.error && row.hash === hashes.get(role)) };
    });
    report.complete = report.errors.length === 0 && report.results.length === 99 && report.roleStability.every(row => row.stable);
    report.completedAt = new Date().toISOString();
  }
  return report;
}
