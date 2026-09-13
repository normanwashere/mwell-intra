import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPersonas } from './uat-audit-identities.mjs';
import { boundedOperation } from './role-api-performance-run.mjs';

export const TARGET = Object.freeze({ origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah',
  backend: 'https://kkoitlvydytdhlpxhuah.supabase.co' });
export const PUBLIC_KEY = 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const sha = x => createHash('sha256').update(x).digest('hex');
class AuditError extends Error { constructor(code) { super(code); this.code = code; } }
const check = (value, code) => { if (!value) throw new AuditError(code); };
const keys = (x, expected) => x && typeof x === 'object' && !Array.isArray(x)
  && isDeepStrictEqual(Object.keys(x).sort(), [...expected].sort());
const sameSet = (a, b) => isDeepStrictEqual([...a].sort(), [...b].sort());
const timestamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const modules = ['core', 'warehouse', 'procurement', 'legal', 'events', 'insights', 'product'];
const tsFiles = ['contracts.ts', 'registry.ts', ...modules.map(m => `modules/${m}.ts`)];
const semantics = [
  'supabase/migrations/20260721200000_cross_department_wms_persistence.sql',
  'supabase/migrations/20260812200000_learning_authority.sql',
  'supabase/migrations/20260813203240_task_1_database_authority_remediation.sql',
  'supabase/migrations/20260815183000_leadership_insights_launch_blockers.sql',
  'supabase/migrations/20260816090000_security_database_launch_blocker_convergence.sql',
  'supabase/migrations/20260816203000_scope_certification_pathways_to_assigned_roles.sql',
  'supabase/migrations/20260911171901_learning_authority_plan_reuse.sql',
  'supabase/migrations/20260912131000_vendor_certification_scope_authority.sql',
  'packages/auth/src/SessionProvider.tsx', 'scripts/qa/uat-audit-identities.mjs', 'scripts/qa/live-e2e-scenarios.mjs',
  'scripts/qa/role-api-performance-run.mjs', 'scripts/qa/wms-role-session-readback.mjs',
];

export async function loadSessionCatalogue() {
  const ts = createRequire(new URL('../../package.json', import.meta.url))('typescript');
  const source = {}, sourceHashes = {}, loaded = {};
  for (const file of tsFiles) {
    const ref = `packages/rbac/src/${file}`; const bytes = await readFile(path.join(repo, ref));
    sourceHashes[ref] = sha(bytes);
    const result = ts.transpileModule(bytes.toString('utf8'), { fileName: file, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    check(!result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), 'catalogue-typescript-error');
    source[file] = result.outputText;
  }
  // Resolve the fixed local registry graph after TypeScript transpilation.
  // Reviewed repository TypeScript is trusted code; vm is not a security sandbox.
  const load = file => {
    check(tsFiles.includes(file), 'catalogue-import-not-allowed');
    if (loaded[file]) return loaded[file];
    const exports = loaded[file] = {};
    const localRequire = specifier => {
      check(typeof specifier === 'string' && specifier.startsWith('.'), 'catalogue-import-not-allowed');
      return load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))}.ts`);
    };
    new Script(source[file], { filename: file }).runInNewContext({ exports, require: localRequire }, { timeout: 1000 });
    return exports;
  };
  const registry = load('registry.ts');
  for (const ref of semantics) sourceHashes[ref] = sha(await readFile(path.join(repo, ref)));
  const result = JSON.parse(JSON.stringify({ modules: registry.MODULES, classifications: registry.CAPABILITY_CLASSIFICATIONS,
    warehouseRows: registry.roleCapabilities.filter(r => r.module === 'warehouse'), capabilities: registry.MODULES.warehouse.capabilities, sourceHashes }));
  check(result.capabilities.length > 0 && new Set(result.capabilities).size === result.capabilities.length, 'invalid-capability-catalogue');
  return result;
}

export function sessionConfig(env, bindings) {
  check(env.APP_ENV === 'uat', 'explicit-uat-required');
  check(typeof env.WMS_SESSION_EXPECTED_COMMIT === 'string' && /^[a-f0-9]{40}$/.test(env.WMS_SESSION_EXPECTED_COMMIT), 'exact-build-required');
  check(!env.AUDIT_IDENTITY_SCOPE || env.AUDIT_IDENTITY_SCOPE === 'checkpoint-v1', 'fixed-roster-required');
  check(UUID.test(env.WMS_SESSION_RUN_ID), 'full-run-uuid-required');
  check(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length > 0, 'ephemeral-password-required');
  const personas = auditPersonas('checkpoint-v1');
  check(Array.isArray(bindings) && bindings.length === 11 && new Set(bindings.map(b => b.id)).size === 11, 'exact-identity-bindings-required');
  for (const [i, b] of bindings.entries()) check(keys(b, ['role', 'email', 'id']) && b.role === personas[i].role && b.email === personas[i].email && UUID.test(b.id), 'exact-identity-bindings-required');
  const bound = (key, fallback, max) => { const n = Number(env[key] ?? fallback); check(Number.isSafeInteger(n) && n >= 100 && n <= max, 'invalid-deadline'); return n; };
  return { runId: env.WMS_SESSION_RUN_ID, buildId: env.WMS_SESSION_EXPECTED_COMMIT, identityScope: 'checkpoint-v1',
    requestTimeoutMs: bound('WMS_SESSION_REQUEST_TIMEOUT_MS', 15000, 60000), runTimeoutMs: bound('WMS_SESSION_RUN_TIMEOUT_MS', 600000, 900000),
    personas, bindings: structuredClone(bindings) };
}

const SELECT = Object.freeze({
  profiles: 'id,email,kind,status',
  user_roles: 'id,user_id,module,role,effective_at,expires_at',
  profile_department_scopes: 'id,profile_id,department_id,scope_type,effective_from,effective_to,created_at,updated_at,created_by,updated_by',
  role_capabilities: 'module,role,cap',
});
const FILTER = { profiles: 'id', user_roles: 'user_id', profile_department_scopes: 'profile_id', role_capabilities: 'module' };
function tableUrl(table, actorId) {
  const params = new URLSearchParams({ select: SELECT[table], [FILTER[table]]: `eq.${table === 'role_capabilities' ? 'warehouse' : actorId}`, limit: '1001' });
  return `${TARGET.backend}/rest/v1/${table}?${params}`;
}

export function assertAllowedSessionRequest(request, ctx) {
  let url; try { url = new URL(request.url); } catch { throw new AuditError('forbidden-request'); }
  check(!url.username && !url.password && !url.hash && [TARGET.origin, TARGET.backend].includes(url.origin), 'forbidden-request');
  const headers = new Headers(request.headers), method = request.method ?? 'GET';
  const noQuery = () => check(!url.search, 'forbidden-request');
  if (request.url === `${TARGET.origin}/api/health`) {
    check(method === 'GET' && !request.body && [...headers].length === 0, 'forbidden-request'); return;
  }
  check(url.origin === TARGET.backend && headers.get('apikey') === PUBLIC_KEY, 'forbidden-request');
  let body; try { body = request.body ? JSON.parse(request.body) : null; } catch { throw new AuditError('forbidden-request'); }
  if (url.pathname === '/auth/v1/token') {
    check(method === 'POST' && url.search === '?grant_type=password' && keys(body, ['email', 'password'])
      && body.email === ctx.email && body.password === ctx.password && !headers.has('authorization'), 'forbidden-request');
  } else {
    check(UUID.test(ctx.actorId) && typeof ctx.accessToken === 'string' && ctx.accessToken.length > 0
      && headers.get('authorization') === `Bearer ${ctx.accessToken}`, 'forbidden-request');
    if (url.pathname === '/auth/v1/user') { noQuery(); check(method === 'GET' && !body, 'forbidden-request'); }
    else {
      check(headers.get('accept-profile') === 'core', 'forbidden-request');
      const table = Object.keys(SELECT).find(t => url.pathname === `/rest/v1/${t}`);
      if (table) {
        check(method === 'GET' && !body && request.url === tableUrl(table, ctx.actorId) && headers.get('prefer') === 'count=exact', 'forbidden-request');
      } else {
        noQuery(); check(method === 'POST' && headers.get('content-profile') === 'core', 'forbidden-request');
        if (url.pathname === '/rest/v1/rpc/my_capability_snapshot') check(keys(body, []), 'forbidden-request');
        else check(url.pathname === '/rest/v1/rpc/has_live_cap' && keys(body, ['p_module', 'p_cap'])
          && body.p_module === 'warehouse' && ctx.capabilities.includes(body.p_cap), 'forbidden-request');
      }
    }
  }
  check([...headers.keys()].every(k => ['apikey', 'authorization', 'content-type', 'accept-profile', 'content-profile', 'prefer'].includes(k)), 'forbidden-request');
}

function safeSnapshot(raw, catalogue) {
  check(keys(raw, ['roleCapabilities', 'userCapabilities']), 'unknown-snapshot-shape');
  for (const projection of Object.values(raw)) {
    check(projection && typeof projection === 'object' && !Array.isArray(projection), 'unknown-snapshot-shape');
    for (const [module, caps] of Object.entries(projection)) check(modules.includes(module) && Array.isArray(caps)
      && new Set(caps).size === caps.length && caps.every(c => catalogue.modules[module].capabilities.includes(c)), 'unknown-snapshot-capability');
  }
  return structuredClone(raw);
}

function validateUser(user, persona, binding) {
  check(user?.id === binding.id && user.email === persona.email && user.role === 'authenticated', 'unexpected-auth-identity');
  check(user.app_metadata?.kind === persona.kind, 'unexpected-auth-kind');
  const roles = user.app_metadata?.roles;
  check(roles && keys(roles, Object.keys(persona.assignments)) && Object.entries(persona.assignments)
    .every(([module, expected]) => Array.isArray(roles[module]) && sameSet(roles[module], expected)), 'unexpected-auth-assignments');
  return { id: user.id, email: user.email, role: user.role, kind: user.app_metadata.kind, assignments: structuredClone(roles) };
}

function ownRows(table, rows, actorId, persona, catalogue) {
  const fields = SELECT[table].split(',');
  for (const r of rows) {
    check(keys(r, fields), 'unknown-own-read-shape');
    if (table === 'profiles') check(r.id === actorId && r.email === persona.email && r.kind === persona.kind
      && ['active', 'inactive', 'suspended'].includes(r.status), 'foreign-own-profile');
    if (table === 'user_roles') check(r.user_id === actorId && UUID.test(r.id) && modules.includes(r.module)
      && Object.hasOwn(catalogue.modules[r.module].roles, r.role) && timestamp(r.effective_at)
      && (r.expires_at === null || timestamp(r.expires_at) && Date.parse(r.expires_at) > Date.parse(r.effective_at)), 'unknown-own-read-shape');
    if (table === 'profile_department_scopes') check(r.profile_id === actorId && UUID.test(r.id) && UUID.test(r.department_id)
      && typeof r.scope_type === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(r.scope_type)
      && timestamp(r.effective_from) && (r.effective_to === null || timestamp(r.effective_to))
      && timestamp(r.created_at) && timestamp(r.updated_at)
      && [r.created_by, r.updated_by].every(id => id === null || UUID.test(id)), 'unknown-own-read-shape');
    if (table === 'role_capabilities') check(r.module === 'warehouse' && Object.hasOwn(catalogue.modules.warehouse.roles, r.role)
      && catalogue.capabilities.includes(r.cap), 'unknown-installed-catalogue');
  }
  return structuredClone(rows);
}

function observedAuthority(actor, catalogue) {
  const toleranceMs = 5000;
  const first = Date.parse(actor.observedAt), last = Math.max(Date.parse(actor.snapshotObservedAt),
    ...actor.liveCapabilities.map(c => Date.parse(c.observedAt)));
  const lower = first - toleranceMs, upper = last + toleranceMs;
  const grants = [...new Set([...(actor.snapshot.userCapabilities.warehouse ?? []),
    ...actor.liveCapabilities.filter(c => c.value).map(c => c.capability)])].sort();
  const mismatches = [], uncertainties = [];
  const profile = actor.own.profile.status === 'available' && actor.own.profile.rows.length === 1 ? actor.own.profile.rows[0] : null;
  if (profile && profile.status !== 'active' && grants.length) mismatches.push({
    code: 'inactive-profile-effective-grant', classification: 'observed-authority-contradiction',
    profileStatus: profile.status, capabilities: grants,
  });
  const assignments = actor.own.roles.status === 'available' ? actor.own.roles.rows.filter(r => r.module === 'warehouse') : [];
  const assignmentWindows = assignments.map(row => {
    const effective = Date.parse(row.effective_at), expires = row.expires_at === null ? Infinity : Date.parse(row.expires_at);
    const state = expires <= lower ? 'expired' : effective > upper ? 'future'
      : effective <= lower && expires > upper ? 'current' : 'boundary-uncertain';
    return { assignmentId: row.id, role: row.role, effectiveAt: row.effective_at, expiresAt: row.expires_at, state };
  });
  if (assignmentWindows.some(row => row.state === 'boundary-uncertain')) uncertainties.push('assignment-window-boundary-uncertain');
  // Check each grant's supporting roles: an expired role does not invalidate a
  // shared capability that another visible, clearly current role can supply.
  for (const capability of grants) {
    const supporting = assignmentWindows.filter(r => catalogue.modules.warehouse.roles[r.role].capabilities.includes(capability));
    if (supporting.length && supporting.every(r => ['expired', 'future'].includes(r.state))) mismatches.push({
      code: 'noncurrent-assignment-effective-grant', classification: 'observed-authority-contradiction', capability,
      supportingAssignmentIds: supporting.map(r => r.assignmentId),
    });
  }
  return { profileStatus: profile?.status ?? 'unverified', assignmentWindows, mismatches, uncertainties,
    observationWindow: { startedAt: actor.observedAt, finishedAt: new Date(last).toISOString(), toleranceMs },
    basis: 'Visible profile and assignment rows plus reviewed local role matrix; sequential observations, not an atomic authority proof.',
    reconciliation: 'Any contradiction requires fresh reconciliation; timing tolerance is not measured server-clock synchronization. No learning cause inferred.' };
}

function compareActor(actor, persona, catalogue) {
  const raw = actor.snapshot.roleCapabilities.warehouse ?? [], effective = actor.snapshot.userCapabilities.warehouse ?? [];
  // The reviewed SQL has no ordinary platform-admin wildcard. Core grants stay in core.
  const expected = [...new Set((persona.assignments.warehouse ?? []).flatMap(role => catalogue.modules.warehouse.roles[role].capabilities))].sort();
  const extra = raw.filter(c => !expected.includes(c)), missing = expected.filter(c => !raw.includes(c));
  const findings = [];
  if (extra.length || missing.length) findings.push('role-union-difference');
  if (effective.some(c => !raw.includes(c))) findings.push('effective-outside-role-union');
  if (actor.liveCapabilities.some(c => c.value !== effective.includes(c.capability))) findings.push('snapshot-live-rpc-difference');
  const effectiveRestrictions = raw.filter(c => !effective.includes(c)).map(capability => ({ capability,
    classification: catalogue.classifications.find(c => c.module === 'warehouse' && c.capability === capability).access,
    explanation: 'Effective authority denied: learning, role-window/profile state or concurrent change requires separate evidence; not raw role-matrix drift.' }));
  const authority = observedAuthority(actor, catalogue);
  findings.push(...new Set(authority.mismatches.map(m => m.code)));
  return { findings, observedAuthority: authority, roleUnion: extra.length || missing.length ? 'differs' : 'matches', expected, extra, missing,
    effectiveRestrictions, certificationCauseVerified: false, installedRoleDefinitionStatusVerified: false };
}

export async function runSessionReadback({ env, bindings, fetchImpl = globalThis.fetch }) {
  const config = sessionConfig(env, bindings), catalogue = await loadSessionCatalogue();
  const { personas, ...publicConfig } = config;
  const report = { version: 1, kind: 'wms-role-session-readback', ...publicConfig, origin: TARGET.origin, project: TARGET.project,
    sourceHashes: catalogue.sourceHashes, sourceCatalogue: { capabilities: catalogue.capabilities, warehouseRows: catalogue.warehouseRows },
    startedAt: new Date().toISOString(), health: null, endHealth: null, actors: [], requests: [], findings: [], evidenceLimits: [],
    collectionComplete: false, preliminaryConsistent: false, wmsSignoff: false, roleCheckpointEvidence: [],
    preliminaryConsistencyScope: 'Observed identity and WMS capability/authority consistency only; excludes department-scope identity/currentness and certification validation.',
    limits: ['Read-only application RPCs and own-row projections only. Ordinary password login creates normal Auth session/audit state.',
      'No SMTP delivery, full RLS, cross-record denial, business transaction, role-switch, concurrency or WMS role-checkpoint certification. Normal Auth sessions are not revoked by this read-only helper.',
      'Exact HTTP counts describe rows visible through this session, not a privileged exhaustive inventory. No privileged fallback.',
      'Snapshot raw roles do not filter role-assignment windows; effective capabilities do. Learning state is not queried or inferred as certified.',
      'Department-scope rows are retained, but their department identity mapping, active department status and currentness remain unverified.',
      'Local source hashes describe reviewed source, not independent proof of installed SQL. Independent deployment/source review remains necessary.'] };
  const deadline = performance.now() + config.runTimeoutMs; let timedOut = false, startHealthOk = false;
  let context = { capabilities: catalogue.capabilities }, phase = 'health-pre';
  const request = async (url, method = 'GET', body, table = null) => {
    const headers = {};
    if (url.startsWith(TARGET.backend)) {
      headers.apikey = PUBLIC_KEY;
      if (context.accessToken) headers.Authorization = `Bearer ${context.accessToken}`;
      if (body) headers['Content-Type'] = 'application/json';
      if (url.includes('/rest/v1/')) {
        headers['Accept-Profile'] = 'core';
        if (method === 'POST') headers['Content-Profile'] = 'core';
        else headers.Prefer = 'count=exact';
      }
    }
    const outgoing = { url, method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
    assertAllowedSessionRequest(outgoing, context);
    const remaining = deadline - performance.now(); check(remaining > 0 && !timedOut, 'run-deadline');
    const evidence = { phase, actorId: context.actorId ?? null, method, path: new URL(url).pathname,
      schema: url.includes('/rest/v1/') ? 'core' : null, table, capability: body?.p_cap ?? null,
      filter: table ? { column: FILTER[table], value: table === 'role_capabilities' ? 'warehouse' : context.actorId } : null,
      startedAt: new Date().toISOString(), status: null };
    report.requests.push(evidence);
    try {
      const result = await boundedOperation('session-readback', Math.min(config.requestTimeoutMs, remaining), async signal => {
        const response = await fetchImpl(url, { ...outgoing, signal, redirect: 'error', cache: 'no-store' });
        check(!signal.aborted, 'request-timeout');
        evidence.status = response.status;
        check(!response.redirected && (response.url === '' || response.url === url), 'redirect-refused');
        if (table && [401, 403].includes(response.status)) return { status: 'unavailable', httpStatus: response.status, reason: 'ordinary-session-denied', rows: [] };
        check(response.ok, 'http-read-failed');
        check(Number(response.headers.get('content-length') ?? 0) <= 2 * 1024 * 1024, 'response-too-large');
        const text = await response.text(); check(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'response-too-large');
        let data; try { data = JSON.parse(text); } catch { throw new AuditError('invalid-json'); }
        if (!url.includes('/auth/v1/')) evidence.responseSha256 = sha(text);
        if (!table) return data;
        check(Array.isArray(data) && data.length <= 1001, 'invalid-row-result');
        const range = response.headers.get('content-range');
        const parsed = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(range ?? '');
        const complete = parsed && Number(parsed[3]) === data.length && data.length <= 1000
          && (data.length === 0 ? parsed[0] === '*/0' : Number(parsed[1]) === 0 && Number(parsed[2]) === data.length - 1);
        evidence.returnedCount = data.length; evidence.visibleTotal = parsed ? Number(parsed[3]) : null;
        return { status: complete ? 'available' : 'partial', httpStatus: response.status, rows: data,
          returnedCount: data.length, visibleTotal: evidence.visibleTotal, exhaustiveness: 'session-visible-only' };
      });
      return result;
    } catch (error) {
      if (!(error instanceof AuditError)) {
        timedOut = performance.now() >= deadline || /timed out/.test(error?.message ?? '') || error?.name === 'AbortError';
      }
      const code = error instanceof AuditError ? error.code : timedOut ? 'request-timeout' : 'transport-failure';
      evidence.failure = code; throw new AuditError(code);
    } finally { evidence.finishedAt = new Date().toISOString(); }
  };
  const health = async () => {
    const data = await request(`${TARGET.origin}/api/health`);
    check(data?.status === 'ok' && data.supabase === 'reachable' && data.deployment?.appEnv === 'uat'
      && data.deployment.supabaseProjectRef === TARGET.project && data.commit === config.buildId, 'health-build-mismatch');
    return { status: data.status, supabase: data.supabase, commit: data.commit,
      deployment: { appEnv: data.deployment.appEnv, supabaseProjectRef: data.deployment.supabaseProjectRef } };
  };
  try {
    report.health = await health(); startHealthOk = true;
    for (const [index, persona] of personas.entries()) {
      const binding = bindings[index];
      context = { capabilities: catalogue.capabilities, email: persona.email, password: env.AUDIT_PASSWORD, actorId: binding.id };
      phase = 'password-login';
      const login = await request(`${TARGET.backend}/auth/v1/token?grant_type=password`, 'POST', { email: persona.email, password: env.AUDIT_PASSWORD });
      validateUser(login.user, persona, binding); check(typeof login.access_token === 'string' && login.access_token.length > 0, 'missing-session');
      context.accessToken = login.access_token;
      phase = 'auth-getUser'; const identity = validateUser(await request(`${TARGET.backend}/auth/v1/user`), persona, binding);
      const actor = { persona: persona.role, actorId: identity.id, email: identity.email, authenticatedRole: identity.role,
        authenticatedKind: identity.kind,
        departmentScopeVerification: { identity: 'unverified', currentness: 'unverified',
          reason: 'No approved department UUID mapping or department-status read; rows retained without full scope consistency credit.' },
        assignments: identity.assignments, observedAt: new Date().toISOString(), own: {}, snapshot: null, liveCapabilities: [], installedCatalogue: null, comparison: null };
      report.actors.push(actor);
      for (const [table, key] of [['profiles', 'profile'], ['user_roles', 'roles'], ['profile_department_scopes', 'scopes']]) {
        phase = `own-${key}`; const read = await request(tableUrl(table, identity.id), 'GET', undefined, table);
        read.rows = ownRows(table, read.rows, identity.id, persona, catalogue); actor.own[key] = read;
        if (read.status !== 'available' || table !== 'profile_department_scopes' && read.rows.length === 0)
          report.evidenceLimits.push({ actorId: identity.id, source: table, reason: read.status === 'available' ? 'empty-own-read' : read.status });
        if (table === 'profile_department_scopes' && read.status === 'available' && !read.rows.length && persona.departmentCode)
          report.evidenceLimits.push({ actorId: identity.id, source: table, reason: 'empty-expected-department-scope' });
        if (table === 'profiles' && read.rows.length > 1) throw new AuditError('duplicate-own-profile');
        if (table === 'user_roles' && read.status === 'available' && read.rows.length) {
          const actual = read.rows.map(r => `${r.module}:${r.role}`);
          const expected = Object.entries(persona.assignments).flatMap(([module, roles]) => roles.map(r => `${module}:${r}`));
          check(sameSet(actual, expected), 'unexpected-persisted-assignments');
        }
      }
      phase = 'capability-snapshot';
      actor.snapshot = safeSnapshot(await request(`${TARGET.backend}/rest/v1/rpc/my_capability_snapshot`, 'POST', {}), catalogue);
      actor.snapshotObservedAt = new Date().toISOString();
      for (const capability of catalogue.capabilities) {
        phase = 'has-live-cap'; const value = await request(`${TARGET.backend}/rest/v1/rpc/has_live_cap`, 'POST', { p_module: 'warehouse', p_cap: capability });
        check(typeof value === 'boolean', 'nonboolean-live-capability');
        actor.liveCapabilities.push({ capability, value, observedAt: new Date().toISOString() });
      }
      phase = 'installed-visible-catalogue';
      const installed = await request(tableUrl('role_capabilities', identity.id), 'GET', undefined, 'role_capabilities');
      installed.rows = ownRows('role_capabilities', installed.rows, identity.id, persona, catalogue);
      actor.installedCatalogue = installed;
      if (installed.status !== 'available' || !installed.rows.length) report.evidenceLimits.push({ actorId: identity.id, source: 'core.role_capabilities', reason: installed.status === 'available' ? 'empty-visible-catalogue' : installed.status });
      else {
        const rowKey = r => `${r.module}:${r.role}:${r.cap}`;
        installed.sourceComparison = sameSet(installed.rows.map(rowKey), catalogue.warehouseRows.map(rowKey)) ? 'matches-visible' : 'differs-visible';
        if (installed.sourceComparison === 'differs-visible') report.findings.push({ actorId: identity.id, code: 'visible-installed-catalogue-difference' });
      }
      actor.comparison = compareActor(actor, persona, catalogue);
      for (const code of actor.comparison.findings) report.findings.push({ actorId: identity.id, code });
      for (const reason of actor.comparison.observedAuthority.uncertainties)
        report.evidenceLimits.push({ actorId: identity.id, source: 'core.user_roles', reason });
      actor.finishedAt = new Date().toISOString();
      context = { capabilities: catalogue.capabilities };
    }
  } catch (error) {
    report.findings.push({ phase, actorId: context.actorId ?? null, code: error instanceof AuditError ? error.code : 'unclassified-readback-failure' });
  } finally {
    context = { capabilities: catalogue.capabilities };
    if (startHealthOk && !timedOut && performance.now() < deadline) {
      phase = 'health-post';
      try { report.endHealth = await health(); }
      catch (error) { report.findings.push({ phase, code: error instanceof AuditError ? error.code : 'health-read-failed' }); }
    } else report.evidenceLimits.push({ source: 'post-health', reason: 'not-dispatched-after-timeout-or-failed-preflight' });
  }
  report.collectionComplete = report.actors.length === 11 && report.actors.every(a => a.finishedAt) && report.endHealth !== null;
  report.preliminaryConsistent = report.collectionComplete && !report.findings.length && !report.evidenceLimits.length;
  report.finishedAt = new Date().toISOString();
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 2, 'configuration-is-env-only');
    const bytes = await readFile(process.env.WMS_SESSION_BINDINGS_FILE);
    check(bytes.length < 32768 && HASH.test(process.env.WMS_SESSION_BINDINGS_SHA256) && sha(bytes) === process.env.WMS_SESSION_BINDINGS_SHA256, 'independently-pinned-bindings-required');
    const bindings = JSON.parse(bytes); const config = sessionConfig(process.env, bindings);
    const root = path.join(repo, 'outputs/wms-signoff', `role-session-${config.runId}`);
    await mkdir(root, { recursive: false });
    const report = await runSessionReadback({ env: process.env, bindings });
    await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ root, collectionComplete: report.collectionComplete, preliminaryConsistent: report.preliminaryConsistent,
      actors: report.actors.length, findings: report.findings, evidenceLimits: report.evidenceLimits, wmsSignoff: false }));
    process.exitCode = report.preliminaryConsistent ? 0 : 1;
  } catch (error) { console.error(error instanceof AuditError ? error.code : 'session-readback-failed: sanitized configuration or local artifact error'); process.exitCode = 1; }
}
