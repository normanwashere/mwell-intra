import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const filename = '20260905042714_warehouse_custody_truncate_least_privilege.sql';
const migration = await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8');
const regression = await readFile(new URL('../supabase/tests/warehouse_custody_truncate.sql', import.meta.url), 'utf8');
const tables = ['returns', 'movements', 'allocations', 'event_reconciliations'];
const permissions = () => db.query(`
  select c.relname, r.rolname, privilege,
    has_table_privilege(r.rolname,c.oid,privilege) allowed
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join pg_roles r
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
  where n.nspname='warehouse' and c.relkind='r'
    and r.rolname in ('anon','authenticated','service_role')
  order by c.relname,r.rolname,privilege
`);
const definitions = async () => ({
  policies: (await db.query('select * from pg_policies where schemaname=\'warehouse\' order by tablename,policyname')).rows,
  tables: (await db.query(`select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.reloptions
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='warehouse' and c.relkind='r' order by c.relname`)).rows,
  functions: (await db.query(`select p.proname,p.proacl,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='warehouse' order by p.proname`)).rows,
});
let beforePermissions;
let beforeDefinitions;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema warehouse;
    grant usage on schema warehouse to anon,authenticated,service_role;`);
  // ACL-only fixture deliberately includes DML grants to detect accidental removal.
  for (const table of [...tables, 'unrelated']) {
    await db.exec(`create table warehouse.${table}(id text primary key);
      alter table warehouse.${table} enable row level security;
      alter table warehouse.${table} force row level security;
      create policy read_custody on warehouse.${table} for select to authenticated using (true);
      grant all on warehouse.${table} to authenticated,service_role;
      grant select,truncate on warehouse.${table} to anon;`);
  }
  await db.exec(`create function warehouse.custody_fixture() returns integer
    language sql security definer set search_path='' as $$ select 1 $$;
    revoke all on function warehouse.custody_fixture() from public;
    grant execute on function warehouse.custody_fixture() to authenticated,service_role;`);
  beforePermissions = (await permissions()).rows;
  beforeDefinitions = await definitions();
  await assert.rejects(db.exec(regression), /retains TRUNCATE/);
  await db.exec(migration);
});
after(() => db.close());

test('catalog regression rejects legacy ACLs and accepts all eight revoked privileges', async () => {
  await db.exec(regression);
  const rows = (await permissions()).rows.filter((row) => tables.includes(row.relname)
    && row.rolname !== 'service_role' && row.privilege === 'TRUNCATE');
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => !row.allowed));
});

test('only intended TRUNCATE grants change; service and unrelated grants remain intact', async () => {
  const expected = beforePermissions.map((row) => tables.includes(row.relname)
    && row.rolname !== 'service_role' && row.privilege === 'TRUNCATE'
    ? { ...row, allowed: false } : row);
  assert.deepEqual((await permissions()).rows, expected);
});

test('RLS, policies, function definitions and function permissions remain unchanged', async () => {
  assert.deepEqual(await definitions(), beforeDefinitions);
});

test('reapplying the privilege revoke is harmless', async () => {
  const snapshot = (await permissions()).rows;
  await db.exec(migration);
  await db.exec(regression);
  assert.deepEqual((await permissions()).rows, snapshot);
});

test('PUBLIC TRUNCATE cannot leave effective anon/authenticated access behind', async () => {
  await db.exec('grant truncate on warehouse.returns to public');
  await assert.rejects(db.exec(regression), /retains TRUNCATE/);
  await db.exec(migration);
  await db.exec(regression);
  const result = await db.query(`select
    has_table_privilege('anon','warehouse.returns','TRUNCATE') anon_allowed,
    has_table_privilege('authenticated','warehouse.returns','TRUNCATE') authenticated_allowed,
    has_table_privilege('service_role','warehouse.returns','TRUNCATE') service_allowed`);
  assert.deepEqual(result.rows, [{ anon_allowed: false, authenticated_allowed: false, service_allowed: true }]);
});

test('CLI-generated numeric migration version is unique', async () => {
  assert.match(filename, /^\d{14}_/);
  const names = await readdir(new URL('../supabase/migrations/', import.meta.url));
  assert.deepEqual(names.filter((name) => name.startsWith(filename.split('_')[0] + '_')), [filename]);
});
