import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RUN_ID, PROJECT, ORIGIN, EMAIL, DISPLAY_NAME, createManifest, validateManifest,
  prepareSellerRun, provisionSeller,
} from './sep20-seller-user-provision.mjs';

const SHA = 'a'.repeat(40);
const ID = '11111111-1111-4111-8111-111111111111';
const MARKETING_ID = '7e55e54e-86cd-4157-9fdb-7616be83e340';
const MEMBER_SCOPE = { departmentId: MARKETING_ID, departmentCode: 'marketing', scopeType: 'member', effectiveFrom: '2026-09-20', effectiveTo: null };
const PASSWORD = 'mock-password-never-persist';
const token = (project = PROJECT) => `header.${Buffer.from(JSON.stringify({ role: 'service_role', ref: project })).toString('base64url')}.signature`;
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

async function fixture(t, settings = {}) {
  const tempRoot = await realpath(tmpdir());
  const runDirectory = await mkdtemp(path.join(tempRoot, 'sep20-seller-user-test-'));
  t.after(async () => {
    assert.equal(path.dirname(await realpath(runDirectory)), tempRoot);
    assert.ok(path.basename(runDirectory).startsWith('sep20-seller-user-test-'));
    await rm(runDirectory, { recursive: true });
  });
  await prepareSellerRun(SHA, { runDirectory });
  const requests = [];
  const cliCalls = [];
  const state = { user: null, profiles: [], user_roles: [], profile_department_scopes: [] };
  const env = { AUDIT_PASSWORD: PASSWORD };
  const options = { runDirectory, apply: true, allowCliCredential: true, confirmRun: RUN_ID, releaseAfterRlsFix: SHA };
  const dependencies = {
    env,
    invokeCli: async args => { cliCalls.push(args); return JSON.stringify([{ name: 'service_role', api_key: token(settings.keyProject) }]); },
    fetcher: async (url, init) => {
      const u = new URL(url);
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ url, method, body, headers: init.headers });
      assert.equal(init.redirect, 'error');
      if (u.origin === ORIGIN) {
        assert.equal(u.pathname, '/api/health');
        assert.equal(init.headers?.Authorization, undefined);
        return json({ status: 'ok', commit: settings.healthSha ?? SHA, deployment: { appEnv: 'uat', supabaseProjectRef: settings.healthProject ?? PROJECT } });
      }
      assert.equal(u.origin, `https://${PROJECT}.supabase.co`);
      assert.equal(init.headers.Authorization, `Bearer ${token()}`);
      if (u.pathname === '/auth/v1/admin/users' && method === 'GET') {
        const page = Number(u.searchParams.get('page'));
        const users = settings.inventory?.[page - 1] ?? [];
        return json({ users }, 200, { 'x-total-count': String(settings.total ?? users.length) });
      }
      if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
        if (settings.createThrows) throw new Error(`${PASSWORD} ${token()}`);
        if (settings.createFails) return json({ message: `${PASSWORD} ${token()}` }, 422);
        state.user = { ...body, id: ID, created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString() };
        delete state.user.password;
        settings.afterCreate?.(state);
        return json(settings.emptyCreate ? {} : settings.wrappedUser ? { user: state.user } : state.user);
      }
      if (u.pathname === `/auth/v1/admin/users/${ID}` && method === 'GET') return json(settings.wrappedUser ? { user: state.user } : state.user);
      assert.equal(init.headers['Accept-Profile'], 'core');
      const table = u.pathname.replace('/rest/v1/', '');
      if (method === 'POST') {
        assert.ok(['profiles', 'user_roles', 'profile_department_scopes'].includes(table), 'No other identity/operational writes');
        assert.equal(init.headers['Content-Profile'], 'core');
        assert.ok(!String(init.headers.Prefer).includes('resolution='), 'No upsert');
        if (settings.profileFails && table === 'profiles') return json({ message: PASSWORD }, 409);
        if ((settings.roleFails && table === 'user_roles') || (settings.scopeFails && table === 'profile_department_scopes')) return json({ message: PASSWORD }, 409);
        state[table].push(...(Array.isArray(body) ? body : [body]));
        if (table === 'user_roles') {
          state.user_roles = state.user_roles.map(r => ({ ...r, id: ID, effective_at: new Date().toISOString(), expires_at: null }));
          settings.afterRoles?.(state);
        }
        if (table === 'profile_department_scopes') {
          state.profile_department_scopes = state.profile_department_scopes.map(s => ({ ...s, id: ID }));
          settings.afterScope?.(state);
        }
        return json(null, 201);
      }
      assert.equal(method, 'GET', 'Never patch, put, or delete an account');
      let rows;
      if (table === 'departments') {
        assert.equal(u.searchParams.get('id'), `eq.${MARKETING_ID}`);
        assert.equal(u.searchParams.get('code'), 'eq.marketing');
        rows = settings.departments ?? [{ id: MARKETING_ID, code: 'marketing', name: 'Marketing', is_active: true }];
      }
      else if (table === 'roles') rows = [{ module: 'events', role: 'seller', is_active: true }];
      else if (table === 'role_capabilities') rows = (settings.capabilities ?? ['view_event_custody', 'record_event_outcome']).map(cap => ({ module: 'events', role: 'seller', cap }));
      else if (table === 'profiles' && u.searchParams.has('email')) rows = settings.existingProfile ? [{ id: ID, email: EMAIL }] : state.profiles;
      else rows = state[table];
      assert.ok(Array.isArray(rows), `Unexpected API table ${table}`);
      return json(rows, 200, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${settings.incompleteCore ? 50 : rows.length}` });
    },
  };
  return { runDirectory, options, dependencies, requests, cliCalls, state, env,
    run: () => provisionSeller(options, dependencies),
    writes: () => requests.filter(r => r.method !== 'GET'),
    artifacts: async () => (await Promise.all((await readdir(runDirectory)).map(f => readFile(path.join(runDirectory, f), 'utf8')))).join('\n'),
  };
}

test('fixed manifest has only synthetic seller identity and no secrets', () => {
  const m = createManifest(SHA);
  assert.equal(m.runId, RUN_ID);
  assert.equal(m.project, 'kkoitlvydytdhlpxhuah');
  assert.equal(m.origin, 'https://mwell-intra-uat.vercel.app');
  assert.equal(m.email, 'intra.seller.uat.sep20@mwell.com.ph');
  assert.equal(m.displayName, 'UAT Event Seller Sep20');
  assert.deepEqual(m.roles, { events: ['seller'] });
  assert.deepEqual(m.departmentScopes, [MEMBER_SCOPE]);
  assert.equal(m.operationalWrites, 'none');
  assert.equal(m.smtp, false);
  assert.throws(() => createManifest('HEAD'), /DEPLOYED_SHA_REQUIRED/);
  for (const change of [{ project: 'wrongproject' }, { email: 'intra.test.seller@mwell.com.ph' }, { email: 'real.person@mwell.com.ph' },
    { origin: 'https://example.com' }, { runId: 'another-run' }, { roles: { events: ['admin'] } }, { roles: { events: ['seller'], core: ['staff'] } }, { password: PASSWORD }, { smtp: true },
    { departmentScopes: [] }, { departmentScopes: [{ ...MEMBER_SCOPE, scopeType: 'owner' }] },
    { departmentScopes: [{ ...MEMBER_SCOPE, departmentId: ID }] }]) {
    assert.throws(() => validateManifest({ ...m, ...change }), /MANIFEST_REFUSED/);
  }
});

test('prepare is offline and never overwrites an existing manifest', async t => {
  const f = await fixture(t);
  assert.deepEqual(await readdir(f.runDirectory), ['manifest.json']);
  await assert.rejects(prepareSellerRun('b'.repeat(40), { runDirectory: f.runDirectory }), /MANIFEST_EXISTS/);
  assert.equal(JSON.parse(await readFile(path.join(f.runDirectory, 'manifest.json'), 'utf8')).deployedSha, SHA);
});

for (const field of ['apply', 'allowCliCredential', 'confirmRun', 'releaseAfterRlsFix']) {
  test(`requires explicit ${field} before credential access or attempt`, async t => {
    const f = await fixture(t); delete f.options[field];
    await assert.rejects(f.run(), /APPROVAL_REQUIRED/);
    assert.equal(f.cliCalls.length, 0); assert.equal(f.requests.length, 0);
    assert.deepEqual(await readdir(f.runDirectory), ['manifest.json']);
  });
}

test('release is SHA-bound and password must come from AUDIT_PASSWORD', async t => {
  const f = await fixture(t); f.options.releaseAfterRlsFix = 'b'.repeat(40);
  await assert.rejects(f.run(), /APPROVAL_REQUIRED/);
  f.options.releaseAfterRlsFix = SHA; delete f.env.AUDIT_PASSWORD;
  await assert.rejects(f.run(), /AUDIT_PASSWORD_REQUIRED/);
  assert.equal(f.requests.length, 0); assert.equal(f.cliCalls.length, 0);
});

test('tampered saved project or email is refused before any side effect', async t => {
  for (const change of [{ project: 'otherproject' }, { email: 'other@mwell.com.ph' }]) {
    const f = await fixture(t);
    await writeFile(path.join(f.runDirectory, 'manifest.json'), JSON.stringify({ ...createManifest(SHA), ...change }));
    await assert.rejects(f.run(), /MANIFEST_REFUSED/);
    assert.equal(f.cliCalls.length, 0); assert.equal(f.writes().length, 0);
  }
});

for (const settings of [{ keyProject: 'otherproject' }, { healthSha: 'b'.repeat(40) }, { healthProject: 'otherproject' }]) {
  test(`refuses mismatched credential/deployment ${JSON.stringify(settings)}`, async t => {
    const f = await fixture(t, settings);
    await assert.rejects(f.run(), /CREDENTIAL_REFUSED|HEALTH_REFUSED/);
    assert.equal(f.writes().length, 0);
    assert.ok(!(await f.artifacts()).includes(token(settings.keyProject)));
  });
}

test('creates once without SMTP; verifies seller-only authority and exact Marketing member scope', async t => {
  const f = await fixture(t);
  const receipt = await f.run();
  assert.equal(receipt.status, 'verified'); assert.equal(receipt.userId, ID);
  assert.equal(receipt.operationalWrites, 0); assert.equal(receipt.smtp, false);
  assert.deepEqual(f.cliCalls, [['projects', 'api-keys', '--project-ref', PROJECT, '--reveal', '--output', 'json', '--log-level', 'none']]);
  assert.deepEqual(f.writes().map(r => new URL(r.url).pathname), ['/auth/v1/admin/users', '/rest/v1/profiles', '/rest/v1/user_roles', '/rest/v1/profile_department_scopes']);
  const body = f.writes()[0].body;
  assert.equal(body.email, EMAIL); assert.equal(body.password, PASSWORD); assert.equal(body.email_confirm, true);
  assert.deepEqual(body.app_metadata.roles, { events: ['seller'] });
  assert.equal(body.user_metadata.full_name, DISPLAY_NAME);
  assert.equal(f.state.profiles[0].status, 'active'); assert.equal(f.state.profiles[0].vendor_id, null);
  assert.equal(f.state.user_roles.length, 1);
  assert.deepEqual(receipt.departmentScopes, [MEMBER_SCOPE]);
  assert.deepEqual(f.state.profile_department_scopes, [{ id: ID, profile_id: ID, department_id: MARKETING_ID,
    scope_type: 'member', effective_from: '2026-09-20', effective_to: null }]);
  const artifacts = await f.artifacts();
  assert.ok(!artifacts.includes(PASSWORD)); assert.ok(!artifacts.includes(token()));
  assert.ok(!artifacts.includes('service_role'));
  const before = f.requests.length;
  await assert.rejects(f.run(), /ATTEMPT_EXISTS/);
  assert.equal(f.requests.length, before); assert.equal(f.cliCalls.length, 1);
});

test('supports the Auth user envelope used by existing provisioners', async t => {
  const f = await fixture(t, { wrappedUser: true });
  assert.equal((await f.run()).status, 'verified');
});

test('an incomplete create response remains uncertain and cannot be retried', async t => {
  const f = await fixture(t, { emptyCreate: true });
  await assert.rejects(f.run(), /AUTH_READBACK_REFUSED/);
  assert.equal(f.writes().length, 1);
  assert.equal(JSON.parse(await readFile(path.join(f.runDirectory, 'failure.json'), 'utf8')).identityWritesMayHaveOccurred, true);
  await assert.rejects(f.run(), /ATTEMPT_EXISTS/);
});

test('simultaneous callers share one exclusive attempt marker', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.run(), f.run()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /ATTEMPT_EXISTS/);
  assert.equal(f.cliCalls.length, 1);
  assert.equal(f.writes().filter(r => r.url.endsWith('/auth/v1/admin/users')).length, 1);
});

test('raw CLI errors never escape into returned errors or persisted artifacts', async t => {
  const f = await fixture(t);
  f.dependencies.invokeCli = async () => { throw new Error(`${PASSWORD} ${token()}`); };
  await assert.rejects(f.run(), error => error.message === 'CREDENTIAL_REFUSED' && !error.cause);
  assert.equal(f.writes().length, 0);
  assert.ok(!(await f.artifacts()).includes(PASSWORD)); assert.ok(!(await f.artifacts()).includes(token()));
});

test('a returned ID belonging to a preexisting different account cannot receive core inserts', async t => {
  const f = await fixture(t, { inventory: [[{ id: ID, email: 'other@invalid.test' }]] });
  await assert.rejects(f.run(), /AUTH_READBACK_REFUSED/);
  assert.equal(f.writes().length, 1);
  assert.equal(f.state.profiles.length, 0);
});

for (const settings of [{ createFails: true }, { createThrows: true }, { profileFails: true }, { roleFails: true }, { scopeFails: true }]) {
  test(`failed or uncertain create/insert never retries, overwrites, or deletes ${JSON.stringify(settings)}`, async t => {
    const f = await fixture(t, settings);
    await assert.rejects(f.run(), /REQUEST_FAILED/);
    assert.equal(f.writes().filter(r => r.url.endsWith('/auth/v1/admin/users')).length, 1);
    const before = f.requests.length;
    await assert.rejects(f.run(), /ATTEMPT_EXISTS/); assert.equal(f.requests.length, before);
    const failure = JSON.parse(await readFile(path.join(f.runDirectory, 'failure.json'), 'utf8'));
    assert.equal(failure.identityWritesMayHaveOccurred, true);
    assert.equal(failure.operationalWrites, 0);
    assert.ok(!(await f.artifacts()).includes(PASSWORD)); assert.ok(!(await f.artifacts()).includes(token()));
  });
}

test('existing Auth user or core profile stops with zero writes', async t => {
  for (const settings of [{ inventory: [[{ id: ID, email: EMAIL.toUpperCase() }]] }, { existingProfile: true }]) {
    const f = await fixture(t, settings);
    await assert.rejects(f.run(), /EXISTING_IDENTITY/); assert.equal(f.writes().length, 0);
  }
});

test('scans bounded continuation and finds an existing user after page one', async t => {
  const page = Array.from({ length: 100 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, email: `mock-${n}@invalid.test` }));
  const f = await fixture(t, { inventory: [page, [{ id: ID, email: EMAIL }]], total: 101 });
  await assert.rejects(f.run(), /EXISTING_IDENTITY/);
  assert.equal(f.writes().length, 0);
  assert.equal(f.requests.filter(r => new URL(r.url).pathname === '/auth/v1/admin/users').length, 2);
});

for (const settings of [{ total: 2001 }, { total: 2 }, { incompleteCore: true }, { capabilities: ['view_event_custody', 'record_event_outcome', 'admin'] }]) {
  test(`incomplete inventory/counts or broadened role fails before create ${JSON.stringify(settings)}`, async t => {
    const f = await fixture(t, settings);
    await assert.rejects(f.run(), /INVENTORY_INCOMPLETE|CORE_READ_INCOMPLETE|ROLE_REFUSED/);
    assert.equal(f.writes().length, 0);
  });
}

for (const settings of [
  { afterCreate: s => { s.user.app_metadata.roles.warehouse = ['admin']; } },
  { afterCreate: s => { s.user.created_at = '2020-01-01T00:00:00Z'; } },
  { afterRoles: s => { s.user_roles.push({ user_id: ID, module: 'core', role: 'admin' }); } },
  { afterScope: s => { s.profile_department_scopes[0].scope_type = 'owner'; } },
  { afterScope: s => { s.profile_department_scopes.push({ profile_id: ID, department_id: ID, scope_type: 'member' }); } },
]) {
  test('rejects unexpected returned/readback authority without repair or cleanup', async t => {
    const f = await fixture(t, settings);
    await assert.rejects(f.run(), /AUTH_READBACK_REFUSED|CORE_READBACK_REFUSED/);
    assert.ok(f.writes().every(r => r.method === 'POST'));
    assert.ok(!(await readdir(f.runDirectory)).includes('receipt.json'));
  });
}

for (const departments of [[], [{ id: MARKETING_ID, code: 'marketing', name: 'Marketing', is_active: false }],
  [{ id: ID, code: 'marketing', name: 'Marketing', is_active: true }],
  [{ id: MARKETING_ID, code: 'finance', name: 'Finance', is_active: true }]]) {
  test('missing, inactive, or mismatched Marketing department blocks Auth creation', async t => {
    const f = await fixture(t, { departments });
    await assert.rejects(f.run(), /DEPARTMENT_REFUSED/);
    assert.equal(f.writes().length, 0);
  });
}
