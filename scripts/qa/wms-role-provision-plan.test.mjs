import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { auditPersonas } from './uat-audit-identities.mjs';
import { ROLE_ROSTER, createRoleManifest, validateRoleManifest, generateRolePlan, writeRolePlan, assessRolePreflight } from './wms-role-provision-plan.mjs';

const options = { runId: 'a1000000-0000-4000-8000-000000000001', buildId: 'b'.repeat(40), effectiveFrom: '2026-09-13' };
const department = { id: 'd1000000-0000-4000-8000-000000000001', code: 'operations.warehouse_logistics', approvalRef: 'parent-department-review.json' };
const approved = () => ({ ...options, baseline: { roles: ['staff'], approvalRef: 'parent-baseline-review.json' },
  departments: Object.fromEntries(ROLE_ROSTER.map(r => [r.key, department])) });

test('seven immutable identities cover six exact singles and one exact operator/supervisor union', () => {
  const m = createRoleManifest(options);
  assert.equal(m.identities.length, 7); assert.equal(new Set(m.identities.map(i => i.email)).size, 7);
  assert.deepEqual(m.identities.map(i => i.warehouseRoles), [['warehouse_operator'], ['warehouse_supervisor'], ['logistics_supervisor'],
    ['operations'], ['pricing'], ['warehouse_admin'], ['warehouse_operator', 'warehouse_supervisor']]);
  for (const i of m.identities) {
    assert(i.email.includes(m.runId)); assert(!i.email.startsWith('intra.ci.checkpoint-v1.'));
    assert(i.email.split('@')[0].length <= 64); assert.equal(i.department, null); assert.equal(i.authUserId, null);
    assert(Object.isFrozen(i.warehouseRoles));
  }
  assert.equal(m.baseline, null); assert.deepEqual(validateRoleManifest(m), m);
});

test('unresolved baseline/departments are blocked rather than inferred from operational role names', () => {
  const p = generateRolePlan(createRoleManifest(options));
  assert.equal(p.executable, false); assert.equal(p.intendedInserts.length, 7);
  assert.equal(p.unresolvedDecisions.length, 8);
  for (const i of p.intendedInserts) { assert.equal(i.profileDepartmentScope, null); assert.equal(i.baselineRoleRows, null); }
  assert.equal(p.liveProvisioningPerformed, false);
});

test('explicit decisions yield new-account insert intentions only; no passwords, hardcoded auth IDs or bypasses', () => {
  const p = generateRolePlan(createRoleManifest(approved()));
  assert.deepEqual(p.unresolvedDecisions, []); assert.equal(p.executable, false);
  for (const i of p.intendedInserts) {
    assert.equal(i.authCreate.transport, 'review-required-auth-admin-create'); assert.equal(i.authCreate.credentialsIncluded, false);
    assert.equal(i.profile.kind, 'employee'); assert.equal(i.profile.status, 'active'); assert.equal(i.profile.vendor_id, null);
    assert.equal(i.baselineRoleRows[0].role, 'staff'); assert.equal(i.profileDepartmentScope.scope_type, 'member');
    assert.equal(i.profileDepartmentScope.effective_from, options.effectiveFrom);
    assert(i.profile.id.startsWith('$new-auth-user:'));
  }
  assert(!JSON.stringify(p.intendedInserts).includes('email_confirm'));
  assert(p.requiredReviews.some(r => /confirmation/.test(r)));
  assert(p.requiredReviews.some(r => /claim/.test(r)));
});

for (const [label, mutate] of [
  ['wrong target', x => { x.project = 'other'; }], ['unknown credential field', x => { x.password = 'not-allowed'; }],
  ['injected UUID', x => { x.runId = "'; drop table auth.users;--"; }], ['unfrozen build', x => { x.buildId = 'main'; }],
  ['invalid date', x => { x.effectiveFrom = '2026-02-30'; }], ['unapproved baseline admin', x => { x.baseline.roles = ['platform_admin']; }],
  ['department code injection', x => { x.departments.op.code = "ops';--"; }], ['invalid department UUID', x => { x.departments.op.id = 'department'; }],
  ['missing department key', x => { delete x.departments.price; }], ['invented department key', x => { x.departments.extra = department; }],
  ['unsafe approval path', x => { x.baseline.approvalRef = '../approval'; }],
]) test(`options reject ${label}`, () => { const x = structuredClone(approved()); mutate(x); assert.throws(() => createRoleManifest(x)); });

test('manifest rejects extra/missing identities, renamed emails, changed roles and preselected auth IDs', () => {
  for (const mutate of [m => m.identities.pop(), m => m.identities.push(m.identities[0]), m => { m.identities[0].email = 'tester@example.invalid'; },
    m => { m.identities[0].warehouseRoles.push('warehouse_admin'); }, m => { m.identities[0].authUserId = options.runId; },
    m => { m.project = 'production'; }]) { const m = structuredClone(createRoleManifest(approved())); mutate(m); assert.throws(() => validateRoleManifest(m)); }
});

test('generated SQL is read-only and contains collision, catalog and existing-tester protections', () => {
  const sql = generateRolePlan(createRoleManifest(approved())).preflightSql;
  assert.match(sql, /begin read only/); assert.match(sql, /auth\.users/); assert.match(sql, /core\.profiles/);
  assert.match(sql, /set local row_security=off/);
  assert.match(sql, /core\.user_roles/); assert.match(sql, /core\.profile_department_scopes/);
  assert.match(sql, /pg_catalog\.pg_trigger/); assert.match(sql, /pg_catalog\.pg_constraint/);
  assert.doesNotMatch(sql, /\b(insert into|update\s+\w|delete from|truncate|grant|revoke|create|alter|drop|merge|on conflict)\b/i);
  assert.doesNotMatch(sql, /encrypted_password|raw_app_meta_data|access_token|service_role_key/);
});

async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema auth; create schema core;
    create table auth.users(id uuid primary key,email text);
    create table core.profiles(id uuid primary key references auth.users(id),email text unique,kind text,status text);
    create table core.roles(module text,role text,is_active boolean,primary key(module,role));
    create table core.user_roles(user_id uuid references core.profiles(id),module text,role text);
    create table core.departments(id uuid primary key,code text,is_active boolean);
    create table core.profile_department_scopes(id uuid,profile_id uuid references core.profiles(id),department_id uuid,scope_type text,effective_from date,effective_to date);
    insert into core.departments values('${department.id}','${department.code}',true);
    insert into core.roles values('core','staff',true),${[...new Set(ROLE_ROSTER.flatMap(r => r.warehouseRoles))].map(r => `('warehouse','${r}',true)`).join(',')};`);
  return db;
}

test('read-only preflight executes offline with exact roles/departments and never asserts live readiness', async t => {
  const db = await database(t); const m = createRoleManifest(approved()); const p = generateRolePlan(m);
  const result = (await db.exec(p.preflightSql)).find(r => r.rows?.[0]?.preflight)?.rows[0].preflight;
  assert.equal(result.candidates.length, 7); assert(result.candidates.every(r => r.authCollisions === 0 && r.profileCollisions === 0));
  const assessment = assessRolePreflight(m, result);
  assert.equal(assessment.collisionFree, true); assert.equal(assessment.catalogCandidatesMatch, true); assert.equal(assessment.executable, false);
  assert(assessment.remainingReviews.length > 0);
  const again = (await db.exec(p.preflightSql)).find(r => r.rows?.[0]?.preflight)?.rows[0].preflight;
  assert.deepEqual(again.candidates, result.candidates);
});

test('case-insensitive Auth/profile collisions and an unexpected same-run namespace account block review', async t => {
  const db = await database(t); const m = createRoleManifest(approved());
  await db.exec(`insert into auth.users values('${options.runId}','${m.identities[0].email.toUpperCase()}');
    insert into core.profiles values('${options.runId}','${m.identities[1].email}','employee','active');`);
  const read = async () => (await db.exec(generateRolePlan(m).preflightSql)).find(r => r.rows?.[0]?.preflight)?.rows[0].preflight;
  const result = await read(); assert.equal(result.candidates[0].authCollisions, 1); assert.equal(result.candidates[1].profileCollisions, 1);
  assert.equal(assessRolePreflight(m, result).collisionFree, false);
  await db.exec(`insert into auth.users values('b1000000-0000-4000-8000-000000000001','${m.namespace}unexpected@mwell.com.ph');`);
  assert.equal((await read()).namespaceAuthCount, 2);
});

test('inactive or mismatched departments and missing role definitions never become eligible catalog candidates', async t => {
  const db = await database(t); const m = createRoleManifest(approved());
  const assess = async () => assessRolePreflight(m, (await db.exec(generateRolePlan(m).preflightSql)).find(r => r.rows?.[0]?.preflight).rows[0].preflight);
  await db.exec("update core.roles set is_active=false where role='pricing'");
  assert.equal((await assess()).catalogCandidatesMatch, false);
  await db.exec("update core.roles set is_active=true; update core.departments set is_active=false");
  assert.equal((await assess()).catalogCandidatesMatch, false);
  await db.exec("update core.departments set is_active=true,code='other.department'");
  assert.equal((await assess()).catalogCandidatesMatch, false);
});

test('assessment rejects incomplete, foreign or nonnumeric supplied observations', async t => {
  const db = await database(t); const m = createRoleManifest(approved());
  const original = (await db.exec(generateRolePlan(m).preflightSql)).find(r => r.rows?.[0]?.preflight).rows[0].preflight;
  for (const mutate of [r => { r.project = 'other'; }, r => { r.runId = department.id; }, r => { r.manifestSha256 = '0'.repeat(64); },
    r => r.candidates.pop(), r => { r.candidates[0].authCollisions = '0'; }, r => { r.namespaceAuthCount = -1; },
    r => r.roles.pop(), r => r.departments.pop(), r => { r.departments[0].id = options.runId; },
    r => { delete r.protectedRoles; }, r => { r.constraints = []; }, r => { r.observedAt = 'not-a-date'; }]) {
    const r = structuredClone(original); mutate(r); assert.throws(() => assessRolePreflight(m, r));
  }
});

test('preflight preserves existing tester identity, cross-module grants and all scope rows, including expired ones', async t => {
  const db = await database(t); const email = auditPersonas('checkpoint-v1')[0].email;
  await db.exec(`insert into auth.users values('${options.runId}','${email}');
    insert into core.profiles values('${options.runId}','${email}','employee','active');
    insert into core.user_roles values('${options.runId}','core','staff'),('${options.runId}','core','platform_admin');
    insert into core.profile_department_scopes values('${department.id}','${options.runId}','${department.id}','member','2026-01-01','2026-02-01');`);
  const snapshot = async () => Promise.all(['auth.users','core.profiles','core.user_roles','core.profile_department_scopes'].map(async table => (await db.query(`select * from ${table}`)).rows));
  const before = await snapshot(); const m = createRoleManifest(approved());
  const result = (await db.exec(generateRolePlan(m).preflightSql)).find(r => r.rows?.[0]?.preflight).rows[0].preflight;
  assert.deepEqual(await snapshot(), before); assert.equal(result.protectedProfiles.length, 1); assert.equal(result.protectedRoles.length, 2);
  assert.equal(result.protectedScopes.length, 1); assert.equal(result.protectedScopes[0].effective_to, '2026-02-01');
  assert.equal(result.namespaceAuthCount, 0); assert.equal(assessRolePreflight(m, result).executable, false);
});

test('unknown trigger inventory is exposed for manual review, never automatically allowed', async t => {
  const db = await database(t); const m = createRoleManifest(approved());
  await db.exec(`create function core.example_hook() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger example_hook before insert on core.user_roles for each row execute function core.example_hook();`);
  const result = (await db.exec(generateRolePlan(m).preflightSql)).find(r => r.rows?.[0]?.preflight).rows[0].preflight;
  assert.equal(result.triggers.length, 1); assert.match(result.triggers[0].functionDefinition, /example_hook/);
  const review = assessRolePreflight(m, result); assert.equal(review.executable, false); assert(review.remainingReviews.some(r => /Unknown automatic/.test(r)));
});

test('RLS-filtered preflight fails instead of claiming collision absence', async t => {
  const db = await database(t); const m = createRoleManifest(approved());
  await db.exec(`create role limited_reader;
    grant usage on schema auth,core to limited_reader;
    grant select on all tables in schema auth,core to limited_reader;
    alter table core.profiles enable row level security;
    set role limited_reader;`);
  await assert.rejects(db.exec(generateRolePlan(m).preflightSql), /row.level security/i);
  await db.exec('rollback; reset role;');
});

test('writer never overwrites a directory, emits only offline plan files and never calls fetch', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'wms-role-plan-'));
  t.after(() => { assert(path.resolve(base).startsWith(`${path.resolve(tmpdir())}${path.sep}wms-role-plan-`)); return rm(base, { recursive: true, force: true }); });
  const target = path.join(base, 'prepared'); const previous = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Forbidden network'); }; t.after(() => { globalThis.fetch = previous; });
  await writeRolePlan(target, options);
  assert.deepEqual((await readdir(target)).sort(), ['manifest.json', 'plan.json', 'preflight.sql']);
  const before = await readFile(path.join(target, 'manifest.json'));
  await assert.rejects(writeRolePlan(target, options), /exist/i);
  assert.deepEqual(await readFile(path.join(target, 'manifest.json')), before);
});
