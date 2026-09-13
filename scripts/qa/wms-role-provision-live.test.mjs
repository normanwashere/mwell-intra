import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRoleManifest, ROLE_ROSTER } from './wms-role-provision-plan.mjs';
import {
  prepareRoleExecution, executeRoleProvision, catalogDigest, digest, CORE_SQL,
  validateDatabaseUrl, createNetworkClients,
} from './wms-role-provision-live.mjs';

const { catalog } = JSON.parse(await readFile(new URL('./fixtures/wms-role-identity-catalog.json', import.meta.url)));
const department = { id: 'd1000000-0000-4000-8000-000000000001', code: 'operations.warehouse_logistics', approvalRef: 'offline-fixture-only' };
const manifest = createRoleManifest({ runId: 'b1000000-0000-4000-8000-000000000001', buildId: 'b'.repeat(40),
  effectiveFrom: '2026-09-13', baseline: { roles: ['staff'], approvalRef: 'offline-fixture-only' },
  departments: Object.fromEntries(ROLE_ROSTER.map(r => [r.key, department])) });
const baseline = {
  version: 1, kind: 'wms-role-preflight', project: manifest.project, runId: manifest.runId, buildId: manifest.buildId,
  manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), observedAt: '2026-09-13T15:00:00.000Z',
  namespaceAuthCount: 0, namespaceProfileCount: 0,
  candidates: manifest.identities.map(i => ({ key: i.key, authCollisions: 0, profileCollisions: 0 })),
  roles: [{ module: 'core', role: 'staff', activeMatches: 1 }, ...[...new Set(ROLE_ROSTER.flatMap(r => r.warehouseRoles))]
    .map(role => ({ module: 'warehouse', role, activeMatches: 1 }))],
  departments: manifest.identities.map(i => ({ key: i.key, id: department.id, code: department.code, activeMatches: 1 })),
  protectedProfiles: Array.from({ length: 11 }, (_, i) => ({ id: `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, kind: 'employee', status: 'active' })),
  protectedRoles: [], protectedScopes: [], ...catalog,
};
baseline.protectedRoles = baseline.protectedProfiles.map(p => ({ user_id: p.id, module: 'core', role: 'staff' }));
baseline.protectedScopes = baseline.protectedProfiles.map((p, i) => ({ id: `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  profile_id: p.id, department_id: department.id, scope_type: 'member', effective_from: '2026-09-13', effective_to: null }));
const time = '2026-09-13T16:00:00.000Z';
const password = 'Offline-only!Password123';
const uid = i => `a1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const copy = structuredClone;

async function harness(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wms-role-offline-'));
  t.after(() => {
    assert(path.resolve(directory).startsWith(`${path.resolve(tmpdir())}${path.sep}wms-role-offline-`));
    return rm(directory, { recursive: true, force: true });
  });
  const review = await prepareRoleExecution(manifest, baseline);
  const approval = { ...review.approvalTemplate, reviewed: true, reviewer: 'offline-test-only',
    ddlPaused: true, namespaceExclusive: true, approvedAt: time, expiresAt: '2026-09-13T17:00:00.000Z' };
  const state = { users: [], creates: 0, inserts: 0, commits: 0, closes: 0, core: false, calls: [], mutate: null };
  const snapshot = () => {
    const r = copy(baseline); r.observedAt = time;
    r.namespaceAuthCount = state.users.length; r.namespaceProfileCount = state.core ? 7 : 0;
    r.candidates.forEach((c, i) => { c.authCollisions = state.users[i] ? 1 : 0; c.profileCollisions = state.core ? 1 : 0; });
    state.mutate?.(r); return r;
  };
  const clients = {
    async target() { return { project: manifest.project, origin: manifest.origin, database: 'postgres', role: 'postgres' }; },
    async health() { return { status: 'ok', commit: manifest.buildId, deployment: { appEnv: 'uat', supabaseProjectRef: manifest.project } }; },
    async preflight() { return snapshot(); },
    async authIds() { return baseline.protectedProfiles.map(p => p.id); },
    async createUser(body) {
      assert.equal(body.role, 'authenticated');
      state.creates++; state.calls.push('create');
      const user = { id: uid(state.users.length), email: body.email, role: 'authenticated', created_at: time, email_confirmed_at: time,
        app_metadata: copy(body.app_metadata), user_metadata: copy(body.user_metadata) };
      state.users.push(user); return copy(user);
    },
    async getUser(id) { return copy(state.users.find(u => u.id === id)); },
    async assertNewCoreAbsent() { assert.equal(state.core, false); },
    async begin() { state.calls.push('begin'); },
    async lockReferences() { state.calls.push('lock'); },
    async insertCore(rows) { state.inserts++; state.rows = copy(rows); state.core = true; },
    async coreReadback() { return copy(state.rows); },
    async commit() { state.commits++; state.calls.push('commit'); },
    async close() { state.closes++; },
  };
  const args = { directory, manifest, baseline, approval, approvalSha256: digest(approval),
    password, clients, now: () => new Date(time) };
  const events = async () => {
    const files = (await readdir(directory)).filter(f => f.endsWith('.json')).sort();
    return Promise.all(files.map(async f => JSON.parse(await readFile(path.join(directory, f)))));
  };
  return { args, state, clients, events, review };
}

test('review pins actual catalog and generates insert-only seven-account contract without execution approval', async () => {
  const review = await prepareRoleExecution(manifest, baseline);
  assert.equal(catalogDigest(baseline), 'e0f2cfa63d9ed0bf0b3c84c44c1753c9b97cd2a0639f606cda9ed8cf294d6771');
  assert.equal(review.approvalTemplate.reviewed, false);
  assert.equal(review.authRequests.length, 7);
  assert(review.authRequests.every(r => r.method === 'POST' && r.body.email_confirm === true && r.body.role === 'authenticated'));
  assert.equal(review.claimSync, 'not-used: exact claims supplied at new Auth creation and verified afterward');
  assert.doesNotMatch(JSON.stringify(CORE_SQL), /on conflict|upsert|delete from|update (?:core|auth|learning)|sync_user_role_claims/i);
});

test('seven new Auth users journal first, then one core transaction; never human or SMTP acceptance', async t => {
  const h = await harness(t); const result = await executeRoleProvision(h.args);
  assert.equal(result.status, 'provisioned-awaiting-governed-onboarding');
  assert.equal(result.smtpVerified, false); assert.equal(result.humanPilotApproved, false);
  assert.equal(h.state.creates, 7); assert.equal(h.state.inserts, 1); assert.equal(h.state.commits, 1);
  assert.equal(h.state.rows.profiles.length, 7); assert.equal(h.state.rows.roles.length, 15); assert.equal(h.state.rows.scopes.length, 7);
  const events = await h.events(); assert.equal(events.filter(e => e.event === 'auth-returned').length, 7);
  assert.doesNotMatch(JSON.stringify(events), /Offline-only!Password123|access_token|refresh_token/);
  const count = h.state.creates;
  await assert.rejects(executeRoleProvision(h.args), /attempt-already-exists/); assert.equal(h.state.creates, count);
});

for (const [name, mutate] of [
  ['project', h => { h.args.manifest = { ...manifest, project: 'foreign' }; }],
  ['unreviewed', h => { h.args.approval.reviewed = false; }],
  ['approval hash', h => { h.args.approvalSha256 = '0'.repeat(64); }],
  ['catalog drift', h => { h.state.mutate = r => { r.columns[0].nullable = 'YES'; }; }],
  ['trigger drift', h => { h.state.mutate = r => { r.triggers[0].enabled = 'D'; }; }],
  ['constraint drift', h => { h.state.mutate = r => { r.constraints.pop(); }; }],
  ['protected role drift', h => { h.state.mutate = r => { r.protectedRoles.pop(); }; }],
  ['protected profile drift', h => { h.state.mutate = r => { r.protectedProfiles.pop(); }; }],
  ['protected scope drift', h => { h.state.mutate = r => { r.protectedScopes = []; }; }],
  ['namespace collision', h => { h.state.mutate = r => { r.namespaceAuthCount++; }; }],
  ['stale fresh preflight', h => { h.state.mutate = r => { r.observedAt = '2026-09-12T00:00:00Z'; }; }],
  ['old health', h => { h.clients.health = async () => ({ status: 'ok', commit: 'f'.repeat(40), deployment: { appEnv: 'uat', supabaseProjectRef: manifest.project } }); }],
  ['wrong connection', h => { h.clients.target = async () => ({ project: 'foreign', origin: manifest.origin, database: 'postgres', role: 'postgres' }); }],
]) test(`preflight ${name} prevents any create`, async t => {
  const h = await harness(t); mutate(h);
  await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 0); assert.equal(h.state.inserts, 0);
});

test('ambiguous remote Auth creation stops with intent, no retry or automatic deletion, raw error redacted', async t => {
  const h = await harness(t); const create = h.clients.createUser;
  h.clients.createUser = async body => { await create(body); throw new Error(`timeout ${password} secret-api-key`); };
  await assert.rejects(executeRoleProvision(h.args), /auth-outcome-unknown/);
  assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0);
  const events = await h.events(); assert(events.some(e => e.event === 'auth-intent'));
  assert.doesNotMatch(JSON.stringify(events), /secret-api-key|Offline-only/);
  await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 1);
});

for (const variant of ['wrong-email', 'preexisting-id', 'wrong-claims', 'duplicate-id', 'old-created-at']) {
  test(`Auth ${variant} persists returned UUID before rejecting and never inserts core`, async t => {
    const h = await harness(t); const create = h.clients.createUser;
    h.clients.createUser = async body => {
      const user = await create(body);
      if (variant === 'wrong-email') user.email = 'foreign@example.invalid';
      if (variant === 'preexisting-id') user.id = baseline.protectedProfiles[0].id;
      if (variant === 'wrong-claims') user.app_metadata.roles.core.push('platform_admin');
      if (variant === 'duplicate-id' && h.state.creates === 2) user.id = uid(0);
      if (variant === 'old-created-at') user.created_at = '2020-01-01T00:00:00Z';
      return user;
    };
    await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.inserts, 0);
    assert.equal((await h.events()).filter(e => e.event === 'auth-returned').length, variant === 'duplicate-id' ? 2 : 1);
  });
}

test('unexpected automatic profile blocks immediately after Auth UUID capture', async t => {
  const h = await harness(t); h.clients.assertNewCoreAbsent = async ids => { if (ids.length) throw new Error('existing core profile'); };
  await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0);
});

for (const role of [undefined, 'anon', 'service_role', 'custom']) test(`unexpected Auth role ${role} is rejected before core inserts`, async t => {
  const h = await harness(t); const create = h.clients.createUser;
  h.clients.createUser = async body => {
    const user = await create(body); user.role = role; h.state.users[0].role = role; return user;
  };
  await assert.rejects(executeRoleProvision(h.args), /unexpected-auth-role/);
  assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0); assert.equal(h.state.commits, 0);
  assert.equal((await h.events()).filter(e => e.event === 'auth-returned').length, 1);
});

test('Auth role elevation on later readback prevents any core insert', async t => {
  const h = await harness(t); const get = h.clients.getUser;
  h.clients.getUser = async id => ({ ...await get(id), role: 'service_role' });
  await assert.rejects(executeRoleProvision(h.args), /unexpected-auth-role/);
  assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0);
});

test('failed UUID journal publication retains observed ID in stop inventory and never creates the next identity', async t => {
  const h = await harness(t); const create = h.clients.createUser;
  h.clients.createUser = async body => {
    const u = await create(body);
    await writeFile(path.join(h.args.directory, '005-auth-returned.json'), 'existing-user-file', { flag: 'wx' });
    return u;
  };
  await assert.rejects(executeRoleProvision(h.args));
  assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0);
  assert.equal(await readFile(path.join(h.args.directory, '005-auth-returned.json'), 'utf8'), 'existing-user-file');
  const stopped = JSON.parse(await readFile(path.join(h.args.directory, '006-stopped.json')));
  assert.deepEqual(stopped.observedAuthIds, [{ key: 'op', id: uid(0) }]);
});

test('intent publication failure prevents Auth request entirely', async t => {
  const h = await harness(t);
  await writeFile(path.join(h.args.directory, '004-auth-intent.json'), 'do-not-overwrite', { flag: 'wx' });
  await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 0);
});

test('concurrent same-directory invocation cannot pass the exclusive attempt marker', async t => {
  const h = await harness(t);
  const outcomes = await Promise.allSettled([executeRoleProvision(h.args), executeRoleProvision(h.args)]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(o => o.status === 'rejected').reason.message, /attempt-already-exists/);
  assert.equal(h.state.creates, 7);
});

test('fresh namespace collision after first creation stops before second Auth request', async t => {
  const h = await harness(t); h.state.mutate = r => { if (h.state.creates === 1) r.namespaceAuthCount++; };
  await assert.rejects(executeRoleProvision(h.args), /namespace-collision/);
  assert.equal(h.state.creates, 1); assert.equal(h.state.inserts, 0);
});

test('protected drift inside transaction blocks COMMIT and retains Auth identities', async t => {
  const h = await harness(t); h.state.mutate = r => { if (h.state.core) r.protectedProfiles[0].status = 'inactive'; };
  await assert.rejects(executeRoleProvision(h.args), /protected-roster-drift/);
  assert.equal(h.state.creates, 7); assert.equal(h.state.commits, 0);
});

test('fresh readback cannot hide an additional new-user role', async t => {
  const h = await harness(t); const read = h.clients.coreReadback;
  h.clients.coreReadback = async () => { const r = await read(); r.roles.push({ user_id: uid(0), module: 'core', role: 'platform_admin' }); return r; };
  await assert.rejects(executeRoleProvision(h.args), /core-readback-mismatch/); assert.equal(h.state.commits, 0);
});

test('postcommit verification failure reports committed, never retries inserts', async t => {
  const h = await harness(t); const read = h.clients.coreReadback;
  h.clients.coreReadback = async () => { if (h.state.commits) throw new Error(`transport ${password}`); return read(); };
  await assert.rejects(executeRoleProvision(h.args), /db=committed/);
  assert.equal(h.state.commits, 1); assert.equal(h.state.inserts, 1);
  assert.equal((await h.events()).at(-1).dbOutcome, 'committed');
});

test('approval of an old executor revision is rejected even with a newly pinned approval digest', async t => {
  const h = await harness(t); h.args.approval.executorSha256 = '0'.repeat(64); h.args.approvalSha256 = digest(h.args.approval);
  await assert.rejects(executeRoleProvision(h.args), /source-mismatch/); assert.equal(h.state.creates, 0);
});

test('expired or unattested isolation cannot be made executable by refreshing approval hash', async t => {
  for (const change of [{ ddlPaused: false }, { namespaceExclusive: false }, { expiresAt: '2026-09-13T15:59:59Z' }, { humanPilotApproval: true }]) {
    const h = await harness(t); Object.assign(h.args.approval, change); h.args.approvalSha256 = digest(h.args.approval);
    await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 0);
  }
});

for (const phase of ['auth', 'core', 'commit']) test(`approval expiring during ${phase} preparation prevents that write`, async t => {
  const h = await harness(t);
  let clock = new Date(time);
  h.args.now = () => clock;
  h.args.approval.expiresAt = '2026-09-13T16:00:01.000Z';
  h.args.approvalSha256 = digest(h.args.approval);
  const expire = () => { clock = new Date('2026-09-13T16:00:02.000Z'); };
  if (phase === 'auth') {
    const absent = h.clients.assertNewCoreAbsent;
    h.clients.assertNewCoreAbsent = async ids => { await absent(ids); expire(); };
  } else if (phase === 'core') {
    const get = h.clients.getUser;
    h.clients.getUser = async id => {
      const result = await get(id);
      if (h.state.calls.includes('begin') && id === uid(6)) expire();
      return result;
    };
  } else {
    const preflight = h.clients.preflight;
    h.clients.preflight = async () => { const result = await preflight(); if (h.state.core) expire(); return result; };
  }
  await assert.rejects(executeRoleProvision(h.args), /approval-expired/);
  assert.equal(h.state.creates, phase === 'auth' ? 0 : 7);
  assert.equal(h.state.inserts, phase === 'commit' ? 1 : 0);
  assert.equal(h.state.commits, 0);
});

test('offline review and injected execution never call fetch', async t => {
  const previous = globalThis.fetch; globalThis.fetch = () => { throw Error('forbidden-network'); };
  t.after(() => { globalThis.fetch = previous; });
  const h = await harness(t); await executeRoleProvision(h.args); assert.equal(h.state.creates, 7);
});

test('CLI prepare is offline and preserves the supplied synthetic directory byte inventory', async t => {
  const { args: { directory } } = await harness(t);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
  await writeFile(path.join(directory, 'live-preflight-raw.json'), JSON.stringify({ rows: [{ preflight: baseline }] }), { flag: 'wx' });
  const inventory = async () => Promise.all((await readdir(directory)).sort().map(async name => [name, digest(await readFile(path.join(directory, name), 'utf8'))]));
  const before = await inventory();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wms-role-provision-live.mjs', import.meta.url)), 'prepare', directory],
    { encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', WMS_ROLE_DATABASE_URL: '', WMS_ROLE_PASSWORD: '' } });
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).approvalTemplate.reviewed, false);
  assert.deepEqual(await inventory(), before);
});

for (const phase of ['insertCore', 'commit', 'coreReadback']) test(`partial ${phase} failure retained without mutation replay`, async t => {
  const h = await harness(t); const original = h.clients[phase];
  h.clients[phase] = async (...args) => { await original(...args); throw new Error(`transport ${password}`); };
  await assert.rejects(executeRoleProvision(h.args)); assert.equal(h.state.creates, 7);
  assert(h.state.inserts <= 1 && h.state.commits <= 1);
  const events = await h.events(); assert.equal(events.at(-1).event, 'stopped');
  if (phase === 'commit') assert.equal(events.at(-1).dbOutcome, 'unknown');
  assert.doesNotMatch(JSON.stringify(events), /Offline-only/);
});

test('DB target URL rejects foreign hosts, missing password and query overrides without revealing credentials', () => {
  const good = `postgresql://postgres:secret@db.${manifest.project}.supabase.co:5432/postgres`;
  assert.equal(validateDatabaseUrl(good, manifest).project, manifest.project);
  for (const url of [good.replace(manifest.project, 'foreign'), good.replace(':secret', ''), `${good}?options=evil`, good.replace('/postgres', '/other')]) {
    assert.throws(() => validateDatabaseUrl(url, manifest), error => !error.message.includes('secret'));
  }
  assert.throws(() => createNetworkClients(manifest, {}), /explicit-live-guards/);
});

test('generated plain SQL executes in local PostgreSQL and rolls back conflicts without changing old rows', async t => {
  const h = await harness(t); await executeRoleProvision(h.args);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema core; create schema auth;
    create table auth.users(id uuid primary key,email text);
    create table core.profiles(id uuid primary key references auth.users(id),email text not null unique,full_name text,title text,kind text not null check(kind in ('employee','vendor')),vendor_id uuid,status text not null,created_at timestamptz not null default now());
    create table core.roles(module text,role text,primary key(module,role));
    create table core.departments(id uuid primary key);
    create table core.user_roles(user_id uuid not null references core.profiles(id),module text not null,role text not null,primary key(user_id,module,role),
      foreign key(module,role) references core.roles(module,role),id uuid not null default gen_random_uuid(),effective_at timestamptz not null default now(),expires_at timestamptz,check(expires_at is null or expires_at>effective_at));
    create table core.profile_department_scopes(id uuid primary key default gen_random_uuid(),profile_id uuid not null references core.profiles(id),department_id uuid not null references core.departments(id),scope_type text not null,effective_from date not null,effective_to date,unique(profile_id,department_id,scope_type,effective_from));
    insert into auth.users values ('ffffffff-ffff-4fff-8fff-ffffffffffff','old@invalid');
    insert into core.departments values ('${manifest.identities[0].department.id}');
    insert into core.profiles(id,email,full_name,title,kind,vendor_id,status) values ('ffffffff-ffff-4fff-8fff-ffffffffffff','old@invalid','Old','Old','employee',null,'active');`);
  for (const p of h.state.rows.profiles) await db.query('insert into auth.users values($1,$2)', [p.id, p.email]);
  for (const r of [...new Map(h.state.rows.roles.map(r => [`${r.module}:${r.role}`, r])).values()]) await db.query('insert into core.roles values($1,$2)', [r.module, r.role]);
  const trigger = baseline.triggers.find(t => t.name === 'core_user_roles_last_admin_guard');
  await db.exec(trigger.functionDefinition); await db.exec(trigger.definition);
  const before = (await db.query('select * from core.profiles')).rows;
  await db.exec('begin');
  for (const key of ['profiles', 'roles', 'scopes']) await db.query(CORE_SQL[key], [JSON.stringify(h.state.rows[key])]);
  await assert.rejects(db.query(CORE_SQL.profiles, [JSON.stringify(h.state.rows.profiles)]));
  await db.exec('rollback'); assert.deepEqual((await db.query('select * from core.profiles')).rows, before);
  await db.exec('begin');
  for (const key of ['profiles', 'roles', 'scopes']) await db.query(CORE_SQL[key], [JSON.stringify(h.state.rows[key])]);
  await db.exec('commit');
  assert.equal((await db.query('select * from core.user_roles')).rows.length, 15);
  assert.deepEqual((await db.query("select * from core.profiles where email='old@invalid'")).rows, before);
  assert((await db.query('select * from core.user_roles')).rows.every(r => r.id && r.effective_at && r.expires_at === null));
  await db.exec('begin');
  await db.query("update core.profiles set status='inactive' where id=$1", [uid(0)]);
  await assert.rejects(db.query(CORE_SQL.roles, [JSON.stringify([{ user_id: uid(0), module: 'warehouse', role: 'pricing' }])]), /active profile/);
  await db.exec('rollback');
});
