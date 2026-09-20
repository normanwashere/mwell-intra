import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  PLAN, SCOPE, assertGate, assertHealth, assertIdentity, assertOutputRoot,
  assertComplete, requestAllowed, loadAuditHelpers, manilaDate,
} from './sep21-hotspot-retest.mjs';
import * as runner from './sep21-hotspot-retest.mjs';

const env = { APP_ENV: 'uat', AUDIT_MUTATIONS: 'false', AUDIT_PASSWORD: 'local-test-only' };
const health = { status: 'ok', commit: SCOPE.commit,
  deployment: { appEnv: 'uat', supabaseProjectRef: SCOPE.project } };
const actor = PLAN[0];
const backend = `https://${SCOPE.project}.supabase.co`;
const read = (method, pathname, schema = 'warehouse', body = {}) => ({
  method, url: `${backend}${pathname}`, schema, body, resourceType: 'fetch',
});
const allowed = request => requestAllowed(request, { actor, password: env.AUDIT_PASSWORD, loginAllowed: true });

test('matrix is exactly the six requested persona/routes at all three widths', () => {
  assert.equal(PLAN.length, 18);
  assert.equal(new Set(PLAN.map(item => `${item.role}:${item.route}:${item.width}`)).size, 18);
  for (const width of [320, 360, 390]) {
    assert.deepEqual(PLAN.filter(item => item.width === width).map(item => `${item.role}:${item.route}`), [
      'operations_associate:/warehouse/receiving', 'operations_associate:/warehouse/returns',
      'operations_associate:/warehouse/fulfillment', 'operations_associate:/warehouse/cycle-counts',
      'operations_lead:/warehouse/receiving', 'operations_lead:/warehouse/cycle-counts',
    ]);
  }
  assert.deepEqual([...new Set(PLAN.map(item => item.email))].sort(), [
    'intra.test.operations.associate@mwell.com.ph', 'intra.test.operations.lead@mwell.com.ph',
  ]);
  assert(Object.isFrozen(PLAN));
  assert(PLAN.every(Object.isFrozen));
});

test('date is Manila, not UTC, and expiry is closed', () => {
  assert.equal(manilaDate(new Date('2026-09-20T16:00:00Z')), '2026-09-21');
  assert.doesNotThrow(() => assertGate(env, new Date('2026-09-21T15:59:59Z')));
  assert.throws(() => assertGate(env, new Date('2026-09-21T16:00:00Z')));
});

test('explicit non-mutating UAT environment and ephemeral password are required', () => {
  for (const patch of [{ APP_ENV: 'production' }, { AUDIT_MUTATIONS: 'true' }, { AUDIT_MUTATIONS: undefined }, { AUDIT_PASSWORD: '' }]) {
    assert.throws(() => assertGate({ ...env, ...patch }, new Date('2026-09-21T00:00:00Z')));
  }
});

test('canonical health requires exact full SHA, UAT backend and healthy status', () => {
  assert.doesNotThrow(() => assertHealth(health));
  for (const patch of [{ status: 'degraded' }, { commit: '9ec7311' }, { commit: 'other' },
    { deployment: { appEnv: 'production', supabaseProjectRef: SCOPE.project } },
    { deployment: { appEnv: 'uat', supabaseProjectRef: 'other' } }]) {
    assert.throws(() => assertHealth({ ...health, ...patch }));
  }
});

test('output is bounded to the approved evidence root', () => {
  assert.doesNotThrow(() => assertOutputRoot(SCOPE.outputRoot));
  for (const value of [SCOPE.outputRoot + '-other', SCOPE.outputRoot + '/..', 'C:/tmp']) {
    assert.throws(() => assertOutputRoot(value));
  }
});

test('auth response must identify the exact known account and a real UUID', () => {
  assert.doesNotThrow(() => assertIdentity({ email: actor.email, id: '60bdca8a-14dd-4297-b9a8-be64e9e7a1cc' }, actor));
  for (const user of [{ email: 'other@mwell.com.ph', id: '60bdca8a-14dd-4297-b9a8-be64e9e7a1cc' }, { email: actor.email, id: 'bad' }, null]) {
    assert.throws(() => assertIdentity(user, actor));
  }
});

test('ordinary password login is exact-account, exact-secret and one phase only', () => {
  const request = read('POST', '/auth/v1/token?grant_type=password', '', { email: actor.email, password: env.AUDIT_PASSWORD, gotrue_meta_security: {} });
  assert.equal(allowed(request), true);
  assert.equal(requestAllowed(request, { actor, password: env.AUDIT_PASSWORD, loginAllowed: false }), false);
  for (const body of [{ ...request.body, email: 'other@mwell.com.ph' }, { ...request.body, password: 'wrong' }, { ...request.body, provider: 'github' }]) {
    assert.equal(allowed({ ...request, body }), false);
  }
});

test('logout, refresh, admin endpoints and credential query strings are denied', () => {
  for (const pathname of ['/auth/v1/logout?scope=global', '/auth/v1/logout?scope=local', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/admin/users']) {
    assert.equal(allowed(read('POST', pathname)), false);
  }
  assert.equal(allowed(read('GET', '/rest/v1/products?access_token=secret')), false);
});

test('table reads retain ordinary RLS but every table write is denied', () => {
  assert.equal(allowed(read('GET', '/rest/v1/products?select=id')), true);
  assert.equal(allowed(read('HEAD', '/rest/v1/stock_levels?select=id')), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(allowed(read(method, '/rest/v1/products')), false);
  }
});

test('only reviewed read RPCs and payload shapes pass', () => {
  assert.equal(allowed(read('POST', '/rest/v1/rpc/my_capability_snapshot', 'core')), true);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/my_learning_snapshot', 'learning')), true);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/stock_conversion_workspace', 'warehouse', { payload: {} })), true);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/list_stock_change_requests', 'warehouse', { payload: { limit: 50 } })), true);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/list_stock_change_requests', 'warehouse', { payload: { limit: 50, action: 'approve' } })), false);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/my_capability_snapshot', 'warehouse')), false);
  assert.equal(allowed(read('POST', '/rest/v1/rpc/my_capability_snapshot', 'core', { user_id: 'other' })), false);
});

test('mutation RPCs, misleading names and GET RPC execution cannot bypass guard', () => {
  for (const name of ['evaluate_certifications', 'mark_notification_read', 'reserve_batch', 'issue', 'receive_stock', 'has_admin_and_write', 'my_mutator']) {
    for (const method of ['POST', 'GET']) assert.equal(allowed(read(method, `/rest/v1/rpc/${name}`)), false);
  }
});

test('ordinary learning bootstrap is argumentless, self-scoped and never a supplied completion', () => {
  const request = read('POST', '/rest/v1/rpc/resolve_assignments', 'learning');
  assert.equal(allowed(request), true);
  for (const body of [{ payload: {} }, { user_id: 'other' }, { actor_id: 'other' }, { completed: true }, { requirements: [] }]) {
    assert.equal(allowed({ ...request, body }), false);
  }
  assert.equal(allowed({ ...request, schema: 'core' }), false);
  assert.equal(allowed({ ...request, method: 'GET' }), false);
  assert.equal(requestAllowed(request, { actor: { role: 'vendor', email: 'other@mwell.com.ph' } }), false);
});

test('own wordmark optimizer read and root fetch prefetch do not authorize navigation or arbitrary fetches', () => {
  const image = { method: 'GET', url: SCOPE.origin + '/_next/image?url=%2Fmwell-wordmark.png&w=640&q=75', resourceType: 'image' };
  assert.equal(allowed(image), true);
  for (const query of ['url=https%3A%2F%2Fexample.com%2Fimage&w=640&q=75', 'url=%2Fapi%2Fmutate&w=640&q=75',
    'url=%2Fmwell-wordmark.png&w=0&q=75', 'url=%2Fmwell-wordmark.png&w=640&q=75&action=write']) {
    assert.equal(allowed({ ...image, url: SCOPE.origin + '/_next/image?' + query }), false);
  }
  const prefetch = { method: 'GET', url: SCOPE.origin + '/?_rsc=test', resourceType: 'fetch' };
  assert.equal(allowed(prefetch), true);
  assert.equal(allowed({ ...prefetch, resourceType: 'document' }), false);
  assert.equal(allowed({ ...prefetch, method: 'POST' }), false);
  assert.equal(allowed({ ...prefetch, url: SCOPE.origin + '/?action=mutate' }), false);
});

test('wordmark optimizer accepts only the observed canonical deployment tag', () => {
  const image = { method: 'GET', url: SCOPE.origin + '/_next/image?url=%2Fmwell-wordmark.png&w=1080&q=75&dpl=dpl_FqVCxKFPyosoguY2ScEkErQaNMk5', resourceType: 'image' };
  assert.equal(allowed(image), true);
  for (const patch of [{ url: image.url.replace('dpl_FqVCxKFPyosoguY2ScEkErQaNMk5', 'dpl_other') },
    { url: image.url + '&action=write' }, { url: image.url + '&dpl=dpl_other' },
    { resourceType: 'document' }, { method: 'POST' }]) assert.equal(allowed({ ...image, ...patch }), false);
});

test('login Flight prefetch is a GET read, not a second login or document navigation', () => {
  for (const query of ['', '?_rsc=flight', '?redirect=%2Fwarehouse%2Freceiving&_rsc=flight']) {
    const request = { method: 'GET', url: SCOPE.origin + '/login' + query, resourceType: 'fetch' };
    assert.equal(requestAllowed(request, { actor, loginAllowed: false }), true);
    assert.equal(requestAllowed({ ...request, resourceType: 'document' }, { actor, loginAllowed: false }), false);
    assert.equal(allowed({ ...request, method: 'POST' }), false);
  }
  for (const query of ['?redirect=https%3A%2F%2Fexample.com', '?redirect=%2Ffinance', '?scope=global', '?redirect=%2Fwarehouse%2Freceiving&redirect=%2Ffinance']) {
    assert.equal(allowed({ method: 'GET', url: SCOPE.origin + '/login' + query, resourceType: 'fetch' }), false);
  }
});

test('blocked-request diagnostics retain safe image/login query shape without credentials or arbitrary values', () => {
  const { safeRequestShape } = runner;
  const shape = safeRequestShape({ url: SCOPE.origin + '/_next/image?url=%2Fmwell-wordmark.png&w=1080&q=75&dpl=dpl_FqVCxKFPyosoguY2ScEkErQaNMk5', resourceType: 'image' });
  assert.deepEqual(shape, { resourceType: 'image', queryKeys: ['url', 'w', 'q', 'dpl'],
    safeQuery: { url: '/mwell-wordmark.png', w: '1080', q: '75', dpl: SCOPE.deploymentId } });
  const secret = 'never-print-this';
  for (const url of [SCOPE.origin + '/login?redirect=' + secret + '&_rsc=' + secret,
    SCOPE.origin + '/_next/image?url=' + secret + '&w=' + secret + '&dpl=' + secret,
    backend + '/storage/v1/object/sign/evidence/ref/file.png?token=' + secret]) {
    assert(!JSON.stringify(safeRequestShape({ url, resourceType: 'fetch' })).includes(secret));
  }
});

test('evidence read signing accepts only the current TTLs, no upload/sign-upload or alternate bucket', () => {
  const request = read('POST', '/storage/v1/object/sign/evidence/ref-test/0/photo.png', '', { expiresIn: 3600 });
  assert.equal(allowed(request), true);
  assert.equal(allowed({ ...request, body: { expiresIn: 300 } }), true);
  for (const body of [{ expiresIn: 86400 }, { expiresIn: 3600, upsert: true }, { expiresIn: 3600, paths: ['other'] }, {}]) {
    assert.equal(allowed({ ...request, body }), false);
  }
  for (const pathname of ['/storage/v1/object/upload/sign/evidence/ref-test/0/photo.png',
    '/storage/v1/object/sign/other/ref-test/0/photo.png', '/storage/v1/object/sign/evidence/ref-test/%2e%2e/photo.png']) {
    assert.equal(allowed({ ...request, url: backend + pathname }), false);
  }
});

test('signed evidence bytes are readable but tokens cannot authorize unrelated requests', () => {
  const request = read('GET', '/storage/v1/object/sign/evidence/ref-test/0/photo.png?token=local.test.signature');
  assert.equal(allowed(request), true);
  assert.equal(allowed({ ...request, method: 'POST' }), false);
  assert.equal(allowed({ ...request, url: request.url + '&action=write' }), false);
  assert.equal(allowed(read('GET', '/rest/v1/products?token=local.test.signature')), false);
});

test('actor-name lookup has bounded valid UUIDs and cannot impersonate another actor', () => {
  const request = read('POST', '/rest/v1/rpc/department_request_actor_names', 'warehouse', { p_request_ids: ['60bdca8a-14dd-4297-b9a8-be64e9e7a1cc'] });
  assert.equal(allowed(request), true);
  for (const body of [{ p_request_ids: ['bad'] }, { ...request.body, actor_id: 'other' }, { p_request_ids: Array(201).fill(request.body.p_request_ids[0]) }]) {
    assert.equal(allowed({ ...request, body }), false);
  }
});

test('only this persona navigation is allowed; prefetches do not expand route scope', () => {
  const app = (pathname, resourceType = 'document') => ({ method: 'GET', url: SCOPE.origin + pathname, resourceType });
  assert.equal(allowed(app('/warehouse/receiving')), true);
  assert.equal(allowed(app('/login?redirect=%2Fwarehouse%2Freceiving')), true);
  assert.equal(allowed(app('/_next/static/chunks/app.js', 'script')), true);
  for (const request of [app('/warehouse/products'), app('/finance'), app('/warehouse/receiving?unexpected=true'),
    { ...app('/warehouse/receiving'), method: 'POST' }, app('/api/mutate', 'fetch'), app('/_next/static/chunks/app.js', 'document')]) {
    assert.equal(allowed(request), false);
  }
  assert.equal(requestAllowed(app('/warehouse/returns'), { actor: PLAN.find(item => item.role === 'operations_lead') }), false);
});

test('untrusted origins, storage writes, edge functions and schema tricks are denied', () => {
  for (const request of [{ ...read('GET', '/rest/v1/products'), url: 'https://example.com/collect' },
    read('POST', '/storage/v1/object/upload'), read('POST', '/functions/v1/test'), read('GET', '/rest/v1/products', 'private'),
    read('GET', '/rest/v1/rpc%2Fissue'), read('POST', '/rest/v1/rpc/my_capability_snapshot?x=1', 'core')]) {
    assert.equal(allowed(request), false);
  }
});

test('partial, duplicate, wrong-scope or failed evidence cannot claim all 18 passed', () => {
  const results = PLAN.map(item => ({ ...item, ok: true, screenshots: ['persistent.jpg'] }));
  assert.doesNotThrow(() => assertComplete(results));
  for (const values of [results.slice(1), [...results.slice(1), results[1]], results.map((item, index) => index ? item : { ...item, ok: false }),
    results.map((item, index) => index ? item : { ...item, screenshots: [] })]) assert.throws(() => assertComplete(values));
});

test('actual audit functions are extracted without importing full live bootstrap', async () => {
  const { helpers, hashes } = await loadAuditHelpers(SCOPE.outputRoot);
  assert.equal(typeof helpers.auditKeyboardAndHotspots, 'function');
  assert.equal(typeof helpers.captureRouteEvidence, 'function');
  assert.match(hashes.auditKeyboardAndHotspots, /^[a-f0-9]{64}$/);
  assert.equal(helpers.login, undefined);
  const source = await readFile(new URL('./sep21-hotspot-retest.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.signOut\s*\(|\.storageState\s*\(|\.tracing\s*\./);
  assert.match(source, /serviceWorkers: 'block'/);
  assert.match(source, /routeWebSocket/);
});
