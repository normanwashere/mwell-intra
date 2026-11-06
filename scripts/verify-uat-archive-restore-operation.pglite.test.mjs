import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const predecessor = read('20261019151646_uat_private_maintenance_archive.sql');
const candidate = read('20261106134948_uat_archive_restore_test_issued_units.sql');
const oldDefinition = "CHECK ((operation = ANY (ARRAY['reset550'::text, 'seed'::text])))";
let db;

async function insertArchive(operation, batch = `test-${operation}`, extra = {}) {
  return db.query(`insert into private.uat_admin_reset_archives
    (batch_id,operation,plan_sha256,row_images,preservation_before)
    values ($1,$2,$3,$4::jsonb,$5::jsonb)`,
  [batch, operation, extra.hash ?? 'a'.repeat(64), extra.images ?? [], {}]);
}

async function isolated(fn, { migrate = true } = {}) {
  await db.exec('begin');
  try {
    if (migrate) await db.exec(candidate);
    await fn();
  } finally {
    await db.exec('rollback');
  }
}

async function rejected(statement, expected) {
  await db.exec('savepoint negative_probe');
  try { await assert.rejects(statement, expected); }
  finally { await db.exec('rollback to savepoint negative_probe; release savepoint negative_probe'); }
}

async function catalog() {
  const result = await db.query(`select jsonb_build_object(
    'relations', (select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,
      'owner',c.relowner,'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
      order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('private','warehouse')),
    'functions', (select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,
      'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','warehouse','public')),
    'triggers', (select jsonb_agg(jsonb_build_object('oid',t.oid,'enabled',t.tgenabled,
      'definition',pg_get_triggerdef(t.oid)) order by t.oid) from pg_trigger t
      where t.tgrelid='private.uat_admin_reset_archives'::regclass),
    'otherConstraints', (select jsonb_agg(jsonb_build_object('oid',c.oid,'definition',pg_get_constraintdef(c.oid))
      order by c.oid) from pg_constraint c where c.conrelid='private.uat_admin_reset_archives'::regclass
      and c.conname<>'uat_admin_reset_archives_operation_check'),
    'columns', (select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
      where a.attrelid='private.uat_admin_reset_archives'::regclass and a.attnum>0),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p
      where p.polrelid='private.uat_admin_reset_archives'::regclass),
    'schemaAcl', (select nspacl::text from pg_namespace where nspname='private'),
    'roles', (select jsonb_agg(to_jsonb(r) order by r.rolname) from pg_roles r)
  ) as snapshot`);
  return result.rows[0].snapshot;
}

async function data() {
  return (await db.query(`select jsonb_build_object(
    'archives',(select jsonb_agg(to_jsonb(a) order by batch_id) from private.uat_admin_reset_archives a),
    'units',(select jsonb_agg(to_jsonb(u) order by id) from warehouse.inventory_units u),
    'stock',(select jsonb_agg(to_jsonb(s) order by product_id) from warehouse.stock_levels s),
    'movements',(select jsonb_agg(to_jsonb(m) order by id) from warehouse.movements m)
  ) as snapshot`)).rows[0].snapshot;
}

before(async () => {
  db = new PGlite();
  // Disposable database roles only; no application identities or auth fixtures.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema warehouse;
    grant usage on schema private to anon,authenticated,service_role;
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text,status text);
    create table warehouse.stock_levels(product_id text primary key,quantity integer);
    create table warehouse.movements(id text primary key,type text,quantity integer);
    insert into warehouse.inventory_units values ('sentinel-unit','sentinel-product','SENTINEL-1','issued');
    insert into warehouse.stock_levels values ('sentinel-product',4);
    insert into warehouse.movements values ('sentinel-issue','issue',1);`);
  await db.exec(predecessor);
  await insertArchive('reset550', 'existing-reset');
  await insertArchive('seed', 'existing-seed');
});
after(async () => { await db?.close(); });

test('actual predecessor accepts only the two historical operations', () => isolated(async () => {
  const { rows } = await db.query(`select pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid='private.uat_admin_reset_archives'::regclass and conname='uat_admin_reset_archives_operation_check'`);
  assert.equal(rows[0].definition, oldDefinition);
  await insertArchive('reset550');
  await insertArchive('seed');
  await rejected(() => insertArchive('restore_test_issued_units'), /uat_admin_reset_archives_operation_check/);
}, { migrate: false }));

test('forward migration admits the explicit restoration audit operation and preserves both old operations', () => isolated(async () => {
  assert.deepEqual((await db.query("select current_setting('lock_timeout') as lock_timeout, current_setting('statement_timeout') as statement_timeout")).rows[0],
    { lock_timeout: '3s', statement_timeout: '30s' });
  for (const operation of ['reset550', 'seed', 'restore_test_issued_units']) await insertArchive(operation);
  assert.equal((await db.query('select count(*)::int as n from private.uat_admin_reset_archives')).rows[0].n, 5);
}));

test('unknown, empty and null operation values remain rejected', () => isolated(async () => {
  for (const operation of ['restore', 'restore_test_issued_unit', '', null]) {
    await rejected(() => insertArchive(operation, `bad-${operation}`), error => ['23514', '23502'].includes(error.code));
  }
}));

test('migration changes only the operation check: all grants, owner, RLS, functions and guards survive', () => isolated(async () => {
  const before = await catalog();
  const relation = before.relations.find(row => row.name === 'uat_admin_reset_archives');
  assert.equal(relation.rls, true);
  assert.equal(relation.force, true);
  await db.exec(candidate);
  assert.deepEqual(await catalog(), before);
}, { migrate: false }));

test('migration preserves existing archive rows and does not restore or alter source stock', () => isolated(async () => {
  const before = await data();
  await db.exec(candidate);
  assert.deepEqual(await data(), before);
}, { migrate: false }));

for (const [action, sql] of [
  ['update', "update private.uat_admin_reset_archives set operation='seed' where batch_id='new-restoration'"],
  ['delete', "delete from private.uat_admin_reset_archives where batch_id='new-restoration'"],
  ['truncate', 'truncate private.uat_admin_reset_archives'],
]) {
  test(`archive ${action} remains blocked by the actual immutable trigger`, () => isolated(async () => {
    await insertArchive('restore_test_issued_units', 'new-restoration');
    const before = await data();
    await rejected(() => db.exec(sql), /UAT reset archives are immutable/);
    assert.deepEqual(await data(), before);
  }));
}

for (const role of ['anon', 'authenticated', 'service_role']) {
  test(`${role} cannot read, insert, update, delete, truncate or execute the archive guard`, () => isolated(async () => {
    const access = (await db.query(`select has_function_privilege($1,
      'private.guard_uat_admin_reset_archive()','execute') as execute,
      has_table_privilege($1,'private.uat_admin_reset_archives','select,insert,update,delete,truncate,references,trigger') as table_access`, [role])).rows[0];
    assert.deepEqual(access, { execute: false, table_access: false });
    await db.exec(`set local role ${role}`);
    for (const statement of [
      () => db.exec('select * from private.uat_admin_reset_archives'),
      () => insertArchive('restore_test_issued_units'),
      () => db.exec("update private.uat_admin_reset_archives set operation='seed'"),
      () => db.exec('delete from private.uat_admin_reset_archives'),
      () => db.exec('truncate private.uat_admin_reset_archives'),
    ]) await rejected(statement, error => error.code === '42501' && /uat_admin_reset_archives/.test(error.message));
  }));
}

test('batch uniqueness, lowercase 64-hex plan hash and array row images remain enforced', () => isolated(async () => {
  await rejected(() => insertArchive('restore_test_issued_units', 'existing-reset'), error => error.code === '23505');
  for (const hash of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) {
    await rejected(() => insertArchive('restore_test_issued_units', 'bad-hash', { hash }), error => error.code === '23514');
  }
  await rejected(() => insertArchive('restore_test_issued_units', 'bad-images', { images: {} }), error => error.code === '23514');
}));

for (const [name, change] of [
  ['missing check', 'alter table private.uat_admin_reset_archives drop constraint uat_admin_reset_archives_operation_check'],
  ['renamed check', 'alter table private.uat_admin_reset_archives rename constraint uat_admin_reset_archives_operation_check to unexpected_operation_check'],
  ['widened check', `alter table private.uat_admin_reset_archives drop constraint uat_admin_reset_archives_operation_check,
    add constraint uat_admin_reset_archives_operation_check check (operation in ('reset550','seed','other'))`],
  ['unvalidated check', `alter table private.uat_admin_reset_archives drop constraint uat_admin_reset_archives_operation_check,
    add constraint uat_admin_reset_archives_operation_check check (operation in ('reset550','seed')) not valid`],
  ['additional operation check', "alter table private.uat_admin_reset_archives add constraint extra_operation_check check (operation <> 'other')"],
]) {
  test(`unexpected predecessor ${name} aborts atomically without changing its catalog or rows`, () => isolated(async () => {
    await db.exec(change);
    const beforeCatalog = await catalog();
    const beforeData = await data();
    await rejected(() => db.exec(candidate), /UAT archive operation constraint drift/);
    assert.deepEqual(await catalog(), beforeCatalog);
    assert.deepEqual(await data(), beforeData);
  }, { migrate: false }));
}

test('reapplying the migration rejects non-predecessor state without changing any rows', () => isolated(async () => {
  const before = await data();
  await rejected(() => db.exec(candidate), /UAT archive operation constraint drift/);
  assert.deepEqual(await data(), before);
}));
