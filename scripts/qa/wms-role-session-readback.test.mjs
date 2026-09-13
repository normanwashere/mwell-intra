import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPersonas } from './uat-audit-identities.mjs';
import { loadSessionCatalogue, runSessionReadback, sessionConfig, assertAllowedSessionRequest, TARGET, PUBLIC_KEY } from './wms-role-session-readback.mjs';

const personas = auditPersonas('checkpoint-v1');
const bindings = personas.map((p, i) => ({ role: p.role, email: p.email, id: `a1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
const password = 'Offline-password-only!';
const env = { APP_ENV: 'uat', WMS_SESSION_EXPECTED_COMMIT: 'c285863112ff43531980a79b22c358dd2bb959a9',
  WMS_SESSION_RUN_ID: 'b1000000-0000-4000-8000-000000000001', AUDIT_PASSWORD: password };
const catalogue = await loadSessionCatalogue();
const snapshotFor = persona => {
  const caps = Object.fromEntries(Object.entries(persona.assignments).map(([module, roles]) => [module,
    [...new Set(roles.flatMap(r => catalogue.modules[module].roles[r].capabilities))].sort()]));
  return { roleCapabilities: structuredClone(caps), userCapabilities: structuredClone(caps) };
};

function fakeServer(change = () => {}) {
  const calls = []; let inFlight = 0, maxInFlight = 0;
  const fetchImpl = async (url, init) => {
    inFlight++; maxInFlight = Math.max(inFlight, maxInFlight);
    try {
      assert.equal(init.redirect, 'error');
      const u = new URL(url), headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
      const bearer = headers.get('authorization');
      const index = bearer ? Number(bearer.slice('Bearer token-'.length)) : body?.email ? personas.findIndex(p => p.email === body.email) : -1;
      const p = personas[index], b = bindings[index];
      const user = () => ({ id: b.id, email: p.email, role: 'authenticated', app_metadata: { roles: p.assignments, kind: p.kind },
        user_metadata: { ignored: 'private user data' } });
      let data, status = 200, contentRange;
      if (u.pathname === '/api/health') data = { status: 'ok', supabase: 'reachable', commit: env.WMS_SESSION_EXPECTED_COMMIT,
        deployment: { appEnv: 'uat', supabaseProjectRef: TARGET.project } };
      else if (u.pathname === '/auth/v1/token') data = { access_token: `token-${index}`, refresh_token: `refresh-${index}`, user: user() };
      else if (u.pathname === '/auth/v1/user') data = user();
      else if (u.pathname.endsWith('/my_capability_snapshot')) data = snapshotFor(p);
      else if (u.pathname.endsWith('/has_live_cap')) data = (snapshotFor(p).userCapabilities.warehouse ?? []).includes(body.p_cap);
      else if (u.pathname === '/rest/v1/profiles') data = [{ id: b.id, email: p.email, kind: p.kind, status: 'active' }];
      else if (u.pathname === '/rest/v1/user_roles') data = Object.entries(p.assignments).flatMap(([module, roles]) => roles.map((role, n) => ({
        id: `c1000000-0000-4000-8000-${String(index * 100 + Object.keys(p.assignments).indexOf(module) * 10 + n).padStart(12, '0')}`,
        user_id: b.id, module, role, effective_at: '2026-01-01T00:00:00Z', expires_at: null })));
      else if (u.pathname === '/rest/v1/profile_department_scopes') data = p.departmentCode ? [{
        id: `d1000000-0000-4000-8000-${String(index).padStart(12, '0')}`, profile_id: b.id,
        department_id: 'e1000000-0000-4000-8000-000000000001', scope_type: 'member', effective_from: '2026-01-01', effective_to: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', created_by: null, updated_by: null,
      }] : [];
      else if (u.pathname === '/rest/v1/role_capabilities') data = catalogue.warehouseRows;
      else throw Error('unexpected-request');
      if (Array.isArray(data)) contentRange = data.length ? `0-${data.length - 1}/${data.length}` : '*/0';
      const context = { u, init, body, index, data, status, contentRange, redirected: false }; change(context, calls);
      calls.push({ path: u.pathname, index, body });
      if (context.timeout) return await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error(`aborted ${password}`)), { once: true }));
      const response = new Response(JSON.stringify(context.data), { status: context.status, headers: context.contentRange ? { 'content-range': context.contentRange } : {} });
      Object.defineProperty(response, 'redirected', { value: context.redirected });
      return response;
    } finally { inFlight--; }
  };
  return { fetchImpl, calls, maxInFlight: () => maxInFlight };
}

test('TypeScript catalogue retains all 31 WMS capabilities and 11 canonical roles', () => {
  assert.equal(catalogue.capabilities.length, 31); assert.equal(Object.keys(catalogue.modules.warehouse.roles).length, 11);
  assert(catalogue.modules.warehouse.roles.operations.capabilities.includes('request_fulfillment'));
  assert(!catalogue.modules.warehouse.roles.marketing.capabilities.includes('request_fulfillment'));
  assert(catalogue.sourceHashes['packages/rbac/src/registry.ts']);
  for (const file of [
    '20260721200000_cross_department_wms_persistence.sql',
    '20260813203240_task_1_database_authority_remediation.sql',
    '20260815183000_leadership_insights_launch_blockers.sql',
  ]) assert.match(catalogue.sourceHashes[`supabase/migrations/${file}`], /^[a-f0-9]{64}$/);
  assert(catalogue.sourceHashes['supabase/migrations/20260912131000_vendor_certification_scope_authority.sql']);
});

for (const phase of ['login', 'getUser']) for (const kind of ['missing', 'employee-to-vendor', 'vendor-to-employee']) {
  test(`${phase} rejects ${kind} Auth kind claim before capability reads for that identity`, async () => {
    const index = kind === 'vendor-to-employee' ? 10 : 1;
    const server = fakeServer(c => {
      if (c.index !== index) return;
      const user = phase === 'login' && c.u.pathname === '/auth/v1/token' ? c.data.user
        : phase === 'getUser' && c.u.pathname === '/auth/v1/user' ? c.data : null;
      if (!user) return;
      if (kind === 'missing') delete user.app_metadata.kind;
      else user.app_metadata.kind = kind === 'employee-to-vendor' ? 'vendor' : 'employee';
    });
    const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
    assert(report.findings.some(f => f.code === 'unexpected-auth-kind'));
    assert.equal(report.preliminaryConsistent, false);
    assert(!server.calls.some(c => c.index === index && c.path.endsWith('/my_capability_snapshot')));
  });
}

test('validated Auth kind is retained and disagrees with a wrong own-profile kind', async () => {
  const server = fakeServer(c => { if (c.index === 2 && c.u.pathname.endsWith('/profiles')) c.data[0].kind = 'vendor'; });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.actors[2].authenticatedKind, 'employee');
  assert(report.findings.some(f => f.code === 'foreign-own-profile')); assert.equal(report.preliminaryConsistent, false);
});

for (const status of ['inactive', 'suspended']) test(`${status} profile with effective WMS grants is an observed authority mismatch`, async () => {
  const server = fakeServer(c => { if (c.index === 2 && c.u.pathname.endsWith('/profiles')) c.data[0].status = status; });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true); assert.equal(report.preliminaryConsistent, false);
  assert(report.findings.some(f => f.code === 'inactive-profile-effective-grant'));
  assert.equal(report.actors[2].comparison.roleUnion, 'matches');
  assert.equal(report.actors[2].comparison.certificationCauseVerified, false);
  assert(report.actors[2].comparison.observedAuthority.mismatches.every(m => m.classification === 'observed-authority-contradiction'));
});

for (const window of ['expired', 'future']) test(`fully ${window} assignments cannot support positive snapshot or RPC grants`, async () => {
  const server = fakeServer(c => {
    if (c.index === 2 && c.u.pathname.endsWith('/user_roles')) for (const row of c.data) {
      if (window === 'expired') row.expires_at = '2026-01-02T00:00:00Z';
      else row.effective_at = '2100-01-01T00:00:00Z';
    }
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.preliminaryConsistent, false);
  assert(report.findings.some(f => f.code === 'noncurrent-assignment-effective-grant'));
  assert(report.actors[2].comparison.observedAuthority.assignmentWindows.every(r => r.state === window));
  assert.equal(report.actors[2].comparison.roleUnion, 'matches');
});

for (const edge of ['just-expired', 'about-to-start']) test(`${edge} assignments are temporal uncertainty, not a clean verdict or definite contradiction`, async () => {
  const server = fakeServer(c => {
    if (c.index === 2 && c.u.pathname.endsWith('/user_roles')) for (const row of c.data) {
      if (edge === 'just-expired') row.expires_at = new Date(Date.now() - 1000).toISOString();
      else row.effective_at = new Date(Date.now() + 1000).toISOString();
    }
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.preliminaryConsistent, false);
  assert(!report.findings.some(f => f.code === 'noncurrent-assignment-effective-grant'));
  assert(report.evidenceLimits.some(l => l.actorId === bindings[2].id && l.reason === 'assignment-window-boundary-uncertain'));
});

test('a current alternate role can support shared grants without reviving an expired role', async () => {
  const allowed = catalogue.modules.warehouse.roles.operations.capabilities;
  const server = fakeServer(c => {
    if (c.index !== 2) return;
    if (c.u.pathname.endsWith('/user_roles')) c.data.find(r => r.role === 'warehouse_operator').expires_at = '2026-01-02T00:00:00Z';
    if (c.u.pathname.endsWith('/my_capability_snapshot')) c.data.userCapabilities.warehouse = [...allowed];
    if (c.u.pathname.endsWith('/has_live_cap')) c.data = allowed.includes(c.body.p_cap);
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.deepEqual(report.findings, []); assert.equal(report.preliminaryConsistent, true);
  assert.equal(report.actors[2].comparison.certificationCauseVerified, false);
});

test('inactive profile and expired assignments with no effective grants are not falsely called a matrix drift', async () => {
  const server = fakeServer(c => {
    if (c.index !== 2) return;
    if (c.u.pathname.endsWith('/profiles')) c.data[0].status = 'inactive';
    if (c.u.pathname.endsWith('/user_roles')) c.data.forEach(r => { r.expires_at = '2026-01-02T00:00:00Z'; });
    if (c.u.pathname.endsWith('/my_capability_snapshot')) c.data.userCapabilities.warehouse = [];
    if (c.u.pathname.endsWith('/has_live_cap')) c.data = false;
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.deepEqual(report.findings, []); assert.equal(report.actors[2].comparison.roleUnion, 'matches');
});

test('even nonempty scopes explicitly retain unverified department identity and currentness', async () => {
  const server = fakeServer(c => {
    if (c.u.pathname.endsWith('/profile_department_scopes')) for (const row of c.data) row.effective_to = '2026-01-02';
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert(report.actors.every(a => a.departmentScopeVerification.identity === 'unverified' && a.departmentScopeVerification.currentness === 'unverified'));
  assert.match(report.preliminaryConsistencyScope, /excludes department/);
});

test('ordinary serial sessions archive all snapshots and 341 true/false RPC values without signoff credit', async () => {
  const server = fakeServer(); const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true); assert.equal(report.findings.length, 0); assert.equal(report.actors.length, 11);
  assert.equal(report.actors.flatMap(a => a.liveCapabilities).length, 341);
  assert.equal(server.maxInFlight(), 1); assert.equal(report.wmsSignoff, false); assert.deepEqual(report.roleCheckpointEvidence, []);
  assert(report.actors[0].liveCapabilities.every(c => c.value === false), 'ordinary core admin has no WMS wildcard');
  assert.equal(server.calls.filter(c => c.path === '/api/health').length, 2);
  const archived = JSON.stringify(report);
  for (const secret of [password, 'token-', 'refresh-', PUBLIC_KEY, 'private user data']) assert(!archived.includes(secret));
});

test('training-restricted effective mutation is not role-matrix drift', async () => {
  const server = fakeServer(c => {
    if (c.index !== 2) return;
    if (c.u.pathname.endsWith('/my_capability_snapshot')) c.data.userCapabilities.warehouse = c.data.userCapabilities.warehouse.filter(cap => cap !== 'receive_stock');
    if (c.u.pathname.endsWith('/has_live_cap') && c.body.p_cap === 'receive_stock') c.data = false;
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true); assert.deepEqual(report.findings, []);
  assert.equal(report.actors[2].comparison.roleUnion, 'matches');
  assert(report.actors[2].comparison.effectiveRestrictions.some(r => r.capability === 'receive_stock' && r.classification === 'mutation'));
  assert.equal(report.actors[2].comparison.certificationCauseVerified, false);
});

for (const [name, mutate, expected] of [
  ['extra raw cap', c => { if (c.index === 1 && c.u.pathname.endsWith('/my_capability_snapshot')) c.data.roleCapabilities.warehouse.push('issue_items'); }, 'role-union-difference'],
  ['extra effective cap', c => { if (c.index === 1 && c.u.pathname.endsWith('/my_capability_snapshot')) c.data.userCapabilities.warehouse.push('issue_items'); }, 'effective-outside-role-union'],
  ['unexpected admin claim', c => { if (c.index === 1 && c.u.pathname === '/auth/v1/user') c.data.app_metadata.roles = { core: ['staff', 'platform_admin'] }; }, 'unexpected-auth-assignments'],
  ['wrong getUser ID', c => { if (c.u.pathname === '/auth/v1/user') c.data.id = bindings[1].id; }, 'unexpected-auth-identity'],
  ['service-role session', c => { if (c.u.pathname === '/auth/v1/user') c.data.role = 'service_role'; }, 'unexpected-auth-identity'],
  ['unknown learning shape', c => { if (c.u.pathname.endsWith('/my_capability_snapshot')) c.data.learning = { certified: true }; }, 'unknown-snapshot-shape'],
  ['boolean missing', c => { if (c.u.pathname.endsWith('/has_live_cap')) c.data = null; }, 'nonboolean-live-capability'],
  ['extra persisted role', c => { if (c.index === 1 && c.u.pathname.endsWith('/user_roles')) { c.data.push({ ...c.data[0], role: 'platform_admin' }); c.contentRange = `0-${c.data.length - 1}/${c.data.length}`; } }, 'unexpected-persisted-assignments'],
]) test(`${name} cannot be accepted`, async () => {
  const server = fakeServer(mutate); const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert(report.findings.some(f => f.code === expected), JSON.stringify(report.findings)); assert.equal(report.preliminaryConsistent, false);
});

test('post-health changed build invalidates collected results without historical relabeling', async () => {
  const server = fakeServer((c, calls) => { if (c.u.pathname === '/api/health' && calls.length) c.data.commit = 'f'.repeat(40); });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.preliminaryConsistent, false); assert(report.findings.some(f => f.code === 'health-build-mismatch'));
  assert.equal(report.buildId, env.WMS_SESSION_EXPECTED_COMMIT);
});

test('denied/partial ordinary reads remain evidence limits, never privileged fallback or pass', async () => {
  const server = fakeServer(c => {
    if (c.u.pathname.endsWith('/role_capabilities')) { c.status = 403; c.data = { message: `denied ${password}` }; }
    if (c.u.pathname.endsWith('/profile_department_scopes')) c.contentRange = '*/2';
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true); assert.equal(report.preliminaryConsistent, false);
  assert(report.actors.every(a => a.own.scopes.status === 'partial' && a.installedCatalogue.status === 'unavailable'));
  assert(!JSON.stringify(report).includes(password));
});

test('empty employee scopes are an evidence gap, not proven department coverage', async () => {
  const server = fakeServer(c => { if (c.u.pathname.endsWith('/profile_department_scopes')) { c.data = []; c.contentRange = '*/0'; } });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true); assert.equal(report.preliminaryConsistent, false);
  assert.equal(report.evidenceLimits.filter(l => l.reason === 'empty-expected-department-scope').length, 10);
});

test('an empty visible catalogue has an explicit evidence-limit reason without widening access', async () => {
  const server = fakeServer(c => {
    if (c.u.pathname.endsWith('/role_capabilities') && c.index !== 0) { c.data = []; c.contentRange = '*/0'; }
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, true);
  assert.equal(report.preliminaryConsistent, false);
  assert.deepEqual(report.findings, []);
  assert.equal(report.evidenceLimits.filter(l => l.reason === 'empty-visible-catalogue').length, 10);
  assert(report.actors.every(a => a.comparison.roleUnion === 'matches'));
  assert.equal(report.wmsSignoff, false);
});

test('all exact persisted scope dates, actors and role windows survive sanitized archiving', async () => {
  const report = await runSessionReadback({ env, bindings, fetchImpl: fakeServer().fetchImpl });
  const scope = report.actors[2].own.scopes.rows[0];
  assert.equal(scope.profile_id, bindings[2].id); assert.equal(scope.effective_from, '2026-01-01');
  assert.equal(scope.created_by, null); assert.equal(scope.updated_by, null); assert.equal(scope.effective_to, null);
  assert(report.actors[2].own.roles.rows.every(r => r.effective_at === '2026-01-01T00:00:00Z' && r.expires_at === null));
});

test('unrecognized capability/error content cannot retain credentials in partial report', async () => {
  const server = fakeServer(c => {
    if (c.u.pathname.endsWith('/my_capability_snapshot')) c.data.userCapabilities.core.push(`${password} token-0 ${PUBLIC_KEY}`);
  });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.actors[0].snapshot, null);
  for (const value of [password, 'token-0', PUBLIC_KEY]) assert(!JSON.stringify(report).includes(value));
});

test('bounded timeout stops serial dispatch without login or observation retry', async () => {
  const server = fakeServer(c => { if (c.u.pathname.endsWith('/my_capability_snapshot')) c.timeout = true; });
  const report = await runSessionReadback({ env: { ...env, WMS_SESSION_REQUEST_TIMEOUT_MS: '100' }, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, false); assert(report.findings.some(f => f.code === 'request-timeout'));
  assert.equal(server.calls.filter(c => c.path === '/auth/v1/token').length, 1);
  assert.equal(server.calls.filter(c => c.path === '/api/health').length, 1);
});

test('redirected responses stop before any later session request', async () => {
  const server = fakeServer(c => { c.redirected = true; });
  const report = await runSessionReadback({ env, bindings, fetchImpl: server.fetchImpl });
  assert.equal(report.collectionComplete, false); assert.equal(server.calls.length, 1);
});

test('transport refuses forbidden hosts, writes, wildcard own reads, admin Auth and learning RPCs', () => {
  const ctx = { actorId: bindings[0].id, email: bindings[0].email, capabilities: catalogue.capabilities, accessToken: 'ordinary-test-token' };
  const headers = { apikey: PUBLIC_KEY, Authorization: 'Bearer ordinary-test-token', 'Accept-Profile': 'core', 'Content-Profile': 'core' };
  assert.doesNotThrow(() => assertAllowedSessionRequest({ url: `${TARGET.backend}/rest/v1/rpc/my_capability_snapshot`, method: 'POST', body: '{}', headers }, ctx));
  for (const request of [
    { url: 'https://evil.invalid/rest/v1/profiles', method: 'GET' },
    { url: `${TARGET.backend}/auth/v1/admin/users`, method: 'POST', body: '{}' },
    { url: `${TARGET.backend}/rest/v1/profiles`, method: 'DELETE' },
    { url: `${TARGET.backend}/rest/v1/profiles?select=*`, method: 'GET' },
    { url: `${TARGET.backend}/rest/v1/rpc/evaluate_certifications`, method: 'POST', body: '{}' },
    { url: `${TARGET.backend}/rest/v1/rpc/has_live_cap`, method: 'POST', body: JSON.stringify({ p_module: 'core', p_cap: 'manage_rbac' }) },
  ]) assert.throws(() => assertAllowedSessionRequest({ ...request, headers }, ctx));
  for (const overrides of [{ 'Accept-Profile': 'learning' }, { 'Content-Profile': 'warehouse' }, { 'X-HTTP-Method-Override': 'DELETE' }]) {
    assert.throws(() => assertAllowedSessionRequest({ url: `${TARGET.backend}/rest/v1/rpc/my_capability_snapshot`, method: 'POST', body: '{}', headers: { ...headers, ...overrides } }, ctx));
  }
});

test('own read filter cannot be changed to another UUID even with otherwise valid headers', () => {
  const ctx = { actorId: bindings[0].id, email: bindings[0].email, capabilities: catalogue.capabilities, accessToken: 'ordinary-test-token' };
  const headers = { apikey: PUBLIC_KEY, Authorization: 'Bearer ordinary-test-token', 'Accept-Profile': 'core', Prefer: 'count=exact' };
  const query = new URLSearchParams({ select: 'id,email,kind,status', id: `eq.${ctx.actorId}`, limit: '1001' });
  const request = { url: `${TARGET.backend}/rest/v1/profiles?${query}`, method: 'GET', headers };
  assert.doesNotThrow(() => assertAllowedSessionRequest(request, ctx));
  assert.throws(() => assertAllowedSessionRequest({ ...request, url: request.url.replace(ctx.actorId, bindings[1].id) }, ctx));
  assert.throws(() => assertAllowedSessionRequest({ ...request, url: `${request.url}&or=(status.eq.active)` }, ctx));
});

test('timeout from an abort-ignoring transport dispatches no subsequent requests', async () => {
  const server = fakeServer(); let calls = 0;
  const fetchImpl = (url, init) => {
    calls++;
    if (url.endsWith('/my_capability_snapshot')) return new Promise(() => {});
    return server.fetchImpl(url, init);
  };
  const report = await runSessionReadback({ env: { ...env, WMS_SESSION_REQUEST_TIMEOUT_MS: '100' }, bindings, fetchImpl });
  const stoppedAt = calls;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(calls, stoppedAt); assert.equal(report.endHealth, null); assert.equal(report.collectionComplete, false);
  assert(report.findings.some(f => f.code === 'request-timeout'));
});

test('configuration cannot switch roster, project, build or expected UUID bindings', () => {
  for (const bad of [{ ...env, APP_ENV: 'production' }, { ...env, WMS_SESSION_EXPECTED_COMMIT: '' }, { ...env, AUDIT_IDENTITY_SCOPE: 'critical' }]) {
    assert.throws(() => sessionConfig(bad, bindings));
  }
  assert.throws(() => sessionConfig(env, bindings.slice(1)));
  assert.throws(() => sessionConfig(env, bindings.map((b, i) => i ? b : { ...b, email: 'foreign@invalid' })));
});
