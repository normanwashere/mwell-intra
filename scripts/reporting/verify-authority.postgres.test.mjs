// Local: SEP22_DOA_PG_BIN=<native PG17 bin> node --test scripts/reporting/verify-authority.postgres.test.mjs
// CI: CI=true SEP22_DOA_EPHEMERAL_CI=1 SEP22_DOA_CI_DATABASE_URL=<marked loopback service>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authorityRoles, installerRole, ciTarget, assertCiIdentity, startAuthorityRuntime } from './authority-test-runtime.mjs';
import { DATASET_IDS } from '../../apps/shell/lib/reporting/catalog.ts';

const migrationUrl = new URL('../../supabase/migrations/20260923025605_reporting_private_authority_foundation.sql', import.meta.url);
const reader = 'reporting_authority_reader', admin = 'reporting_authority_admin';
const issuer = 'https://issuer.example.test/tenant';
const enabled = Boolean(process.env.SEP22_DOA_PG_BIN || process.env.SEP22_DOA_CI_DATABASE_URL || process.env.SEP22_DOA_EPHEMERAL_CI);
const hash = value => createHash('sha256').update(value).digest('hex');
const sql = (db, query, params = []) => db.query(query, params);
const rpc = async (db, name, params = []) => (await sql(db,
  `select reporting_authority.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) result`, params)).rows[0].result;
const register = (db, client, env = 'uat') => rpc(db, 'register_principal', [issuer, client, env, 'approval-1']);
const grant = (db, id, datasets = ['warehouse.products'], consumers = ['primary'], bundle = 'phase1') =>
  rpc(db, 'set_grant', [id, datasets, consumers, bundle, 'approval-2']);
const active = (db, id, value) => rpc(db, 'set_active', [id, value, 'approval-3']);
const read = (db, client, env = 'uat') => rpc(db, 'read_current_grant', [issuer, client, env]);
const denied = (fn, codes = ['42501']) => assert.rejects(fn, error => codes.includes(error.code));

test('CI guard accepts prior harness API roles but rejects non-disposable state', () => {
  const env = { CI: 'true', SEP22_DOA_EPHEMERAL_CI: '1', SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1:5432/postgres' };
  assert.equal(ciTarget(env).hostname, '127.0.0.1');
  for (const changes of [{ CI: 'false' }, { SEP22_DOA_EPHEMERAL_CI: '' },
    { SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:test@db.example.test/postgres' },
    { SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:test@127.0.0.1/uat' },
    { SEP22_DOA_CI_DATABASE_URL: `${env.SEP22_DOA_CI_DATABASE_URL}?host=elsewhere` }]) {
    assert.throws(() => ciTarget({ ...env, ...changes }));
  }
  const identity = { version: 170010, cluster_name: 'sep22_doa_ci', database: 'postgres',
    other_databases: 0, other_schemas: 0, public_objects: 0, memberships: 0,
    roles: ['anon','authenticated','service_role'].map(rolname => ({ rolname, rolsuper: false, rolcanlogin: false,
      rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: rolname === 'service_role' })) };
  assert.doesNotThrow(() => assertCiIdentity(identity));
  for (const changes of [{ version: 180000 }, { cluster_name: 'uat' }, { other_databases: 1 },
    { other_schemas: 1 }, { public_objects: 1 }, { memberships: 1 },
    { roles: [{ ...identity.roles[0], rolcanlogin: true }] },
    { roles: [{ ...identity.roles[0], rolname: reader }] }]) assert.throws(() => assertCiIdentity({ ...identity, ...changes }));
});

test('private authority on native PostgreSQL 17', {
  skip: enabled ? false : 'Set SEP22_DOA_PG_BIN or opt into the marked disposable CI service', timeout: 180000,
}, async t => {
  const db = await startAuthorityRuntime(t);
  t.after(() => db.close());
  const root = db.client;
  // Real operational functions, with narrowly faked operational records/auth dependencies.
  const { fixtureFrom, contend } = await import('../qa/sep20-native-runtime.mjs');
  const fixture = await fixtureFrom('scripts/verify-sep22-doa-final-authority.pglite.test.mjs', ['fixture', 'snapshot'], root);
  await fixture.fixture({ after() {} });
  await root.query(`create table public.operational_canary(id int primary key);
    create function public.operational_public_canary() returns void language sql security definer
    set search_path=pg_catalog,pg_temp as $$ insert into public.operational_canary values(1) $$;
    create function public.operational_restricted_canary() returns void language sql security definer
    set search_path=pg_catalog,pg_temp as $$ insert into public.operational_canary values(2) $$;
    revoke all on function public.operational_restricted_canary() from public;
    grant execute on function public.operational_restricted_canary() to authenticated;`);
  const operationalBefore = await fixture.snapshot(root);
  const operationalAcl = async () => (await root.query(`select n.nspname,p.proname,p.proacl,pg_get_functiondef(p.oid) body
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','core','private','procurement') order by p.oid`)).rows;
  const aclBefore = await operationalAcl();
  const migration = await readFile(migrationUrl, 'utf8');
  await root.query(`create role ${installerRole} nologin noinherit nosuperuser createrole nocreatedb nobypassrls;
    alter database "${db.name}" owner to ${installerRole};
    alter default privileges for role ${installerRole} grant all on tables to service_role;
    alter default privileges for role ${installerRole} grant execute on functions to service_role;`);
  const installer = await db.newClient();
  await installer.query(`set session authorization ${installerRole}`);
  await installer.query("set createrole_self_grant='set,inherit'");
  const installIdentity = (await installer.query(`select rolname,rolsuper,rolcreaterole,
    (select pg_get_userbyid(datdba)=current_user from pg_database where datname=current_database()) database_owner
    from pg_roles where rolname=current_user`)).rows[0];
  assert.deepEqual(installIdentity, { rolname: installerRole, rolsuper: false, rolcreaterole: true, database_owner: true });
  await installer.query(migration);
  t.diagnostic(`Installed under non-superuser CREATEROLE database owner: ${JSON.stringify(installIdentity)}`);
  assert.equal((await root.query("select to_regnamespace('reporting_authority') is not null present")).rows[0].present,
    true, 'Migration must install the private reporting authority');
  t.diagnostic(`Migration SHA-256 ${hash(migration)}`);
  t.after(async () => assert.equal(hash(await readFile(migrationUrl, 'utf8')), hash(migration), 'Migration changed during verification'));
  assert.deepEqual(await fixture.snapshot(root), operationalBefore);
  assert.deepEqual(await operationalAcl(), aclBefore, 'Existing operational ACLs and function bodies must be untouched');
  const asRole = async role => {
    const client = await db.newClient();
    assert.ok([...authorityRoles, 'anon','authenticated','service_role'].includes(role));
    await client.query(`set session authorization "${role}"`);
    assert.equal((await client.query('select current_user u,session_user s')).rows[0].s, role);
    return client;
  };
  const r = await asRole(reader), a = await asRole(admin);
  const functions = (await root.query(`select p.proname, p.oid::regprocedure::text signature, p.prosecdef,p.proconfig,
    pg_get_userbyid(p.proowner) owner from pg_proc p where p.pronamespace='reporting_authority'::regnamespace`)).rows;
  const tables = ['principals','current_grants','denied_clients','admin_audit'];
  const keyColumns = { principals: 'principal_id', current_grants: 'principal_id', denied_clients: 'issuer', admin_audit: 'audit_id' };

  await t.test('documented schema-settings query never returns sibling JWT/secret settings', async () => {
    const document = await readFile(new URL('../../docs/integrations/reporting-api/AUTHORITY-FOUNDATION.md', import.meta.url), 'utf8');
    const query = document.match(/```sql\r?\n([\s\S]*?)```/)?.[1];
    assert.ok(query, 'Read-only schema inventory query must be documented');
    await root.query('begin');
    try {
      await root.query(`alter role ${installerRole} set pgrst.db_schemas='public,warehouse';
        alter role ${installerRole} set pgrst.db_extra_search_path='extensions';
        alter role ${installerRole} set pgrst.jwt_secret='SYNTHETIC_SECRET_DO_NOT_RETURN';`);
      const rows = (await root.query(query)).rows;
      assert.deepEqual(rows.map(row => row.setting).sort(), ['pgrst.db_extra_search_path=extensions','pgrst.db_schemas=public,warehouse']);
      assert.ok(rows.every(row => row.rolname === installerRole));
      assert.ok(!JSON.stringify(rows).includes('SYNTHETIC_SECRET_DO_NOT_RETURN'));
    } finally { await root.query('rollback'); }
  });

  await t.test('inactive installation: empty tables, fixed owner, no login, inheritance, app membership or source grants', async () => {
    for (const table of tables) assert.equal((await root.query(`select count(*)::int n from reporting_authority.${table}`)).rows[0].n, 0);
    const roles = (await root.query('select * from pg_roles where rolname=any($1)', [authorityRoles])).rows;
    assert.equal(roles.length, 3);
    for (const role of roles) for (const flag of ['rolsuper','rolinherit','rolcreaterole','rolcreatedb','rolcanlogin','rolreplication','rolbypassrls']) assert.equal(role[flag], false, `${role.rolname}.${flag}`);
    const memberships = (await root.query(`select pg_get_userbyid(roleid) role,pg_get_userbyid(member) member,
      pg_get_userbyid(grantor) grantor,admin_option,inherit_option,set_option from pg_auth_members where roleid in
      (select oid from pg_roles where rolname=any($1)) or member in (select oid from pg_roles where rolname=any($1))`, [authorityRoles])).rows;
    assert.equal(memberships.length, 3, 'PG17 retains bootstrap-granted creator ADMIN memberships');
    assert.deepEqual(memberships.map(row => row.role).sort(), [...authorityRoles].sort());
    for (const membership of memberships) {
      assert.equal(membership.member, installerRole);
      assert.equal(membership.admin_option, true);
      assert.equal(membership.set_option, false);
      assert.equal(membership.inherit_option, false);
      assert.equal((await root.query('select rolsuper from pg_roles where rolname=$1', [membership.grantor])).rows[0].rolsuper, true);
    }
    for (const role of authorityRoles) await denied(() => installer.query(`set role ${role}`));
    assert.equal((await root.query("select pg_get_userbyid(nspowner) owner from pg_namespace where nspname='reporting_authority'")).rows[0].owner, authorityRoles[0]);
    for (const fn of functions) {
      assert.equal(fn.owner, authorityRoles[0]); assert.equal(fn.prosecdef, true);
      assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, pg_temp']);
    }
    for (const table of tables) {
      const row = (await root.query('select relrowsecurity,pg_get_userbyid(relowner) owner from pg_class where oid=$1::regclass', [`reporting_authority.${table}`])).rows[0];
      assert.equal(row.relrowsecurity, true); assert.equal(row.owner, authorityRoles[0]);
    }
  });

  await t.test('real anon/authenticated/service_role cannot read, mutate, create or execute any authority function', async () => {
    for (const role of ['anon','authenticated','service_role']) {
      const c = await asRole(role);
      for (const table of tables) {
        for (const query of [`select * from reporting_authority.${table}`, `delete from reporting_authority.${table}`,
          `update reporting_authority.${table} set ${keyColumns[table]}=${keyColumns[table]}`,
          `insert into reporting_authority.${table} default values`, `truncate reporting_authority.${table}`]) await denied(() => c.query(query));
        assert.equal((await root.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') ok", [role, `reporting_authority.${table}`])).rows[0].ok, false);
      }
      for (const fn of functions) assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, fn.signature])).rows[0].ok, false, fn.signature);
      await denied(() => read(c, 'client-1'));
      await denied(() => register(c, 'client-1'));
      await denied(() => c.query('create table reporting_authority.injected(id int)'));
      for (const target of authorityRoles) await denied(() => c.query(`set role ${target}`));
    }
  });

  await t.test('reader can execute only one bounded function; admins have no direct DML or owner escalation', async () => {
    for (const role of [reader, admin]) {
      const client = role === reader ? r : a;
      for (const table of tables) {
        for (const statement of [`select * from reporting_authority.${table}`, `delete from reporting_authority.${table}`,
          `update reporting_authority.${table} set ${keyColumns[table]}=${keyColumns[table]}`,
          `insert into reporting_authority.${table} default values`, `truncate reporting_authority.${table}`]) await denied(() => client.query(statement));
      }
      await denied(() => client.query('set role reporting_authority_owner'));
      await denied(() => client.query('alter table reporting_authority.denied_clients disable trigger all'));
      await denied(() => client.query('create table reporting_authority.injected(id int)'));
    }
    for (const fn of functions) assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok", [reader, fn.signature])).rows[0].ok, fn.proname === 'read_current_grant', fn.signature);
    for (const fn of functions) assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok", [admin, fn.signature])).rows[0].ok,
      ['register_principal','set_grant','set_active','rotate_disclosure','deny_client'].includes(fn.proname), fn.signature);
    await denied(() => register(r, 'bad'));
    assert.equal(await read(r, 'absent'), null);
    assert.equal(await rpc(r, 'read_current_grant', [null, 'x', 'uat']), null);
    assert.equal(await read(r, 'x'.repeat(257)), null);
  });

  await t.test('bounded registration and parameterized lookups reject malformed identities and null admin inputs', async () => {
    for (const invalidIssuer of ['', 'http://issuer.test', 'https://user@issuer.test', 'https://issuer.test?secret=x',
      'https://issuer.test#fragment', 'https://issuer.test/' + 'x'.repeat(2048), null]) {
      await assert.rejects(rpc(a, 'register_principal', [invalidIssuer, 'invalid', 'uat', 'approval-1']), /constraint|null/i);
    }
    for (const invalidClient of ['', 'client id', 'x'.repeat(257), null]) await assert.rejects(register(a, invalidClient), /constraint|null/i);
    for (const invalidEnv of ['', 'uat prod', 'x'.repeat(129), null]) await assert.rejects(register(a, 'invalid', invalidEnv), /constraint|null/i);
    assert.equal(await read(r, "x' OR true --"), null);
    for (const method of ['set_active','rotate_disclosure']) {
      await assert.rejects(rpc(a, method, method === 'set_active' ? [null, true, 'test'] : [null, 'test']), /principal|grant/i);
    }
  });

  let id;
  await t.test('registration is inactive, needs explicit valid grant before activation, matches auth.ts shape', async () => {
    id = await register(a, 'client-1');
    assert.equal(await read(r, 'client-1'), null);
    await assert.rejects(active(a, id, true), /grant/i);
    await grant(a, id);
    let state = await read(r, 'client-1');
    assert.equal(state.active, false);
    await active(a, id, true);
    state = await read(r, 'client-1');
    assert.deepEqual(Object.keys(state).sort(), ['principal_id','issuer','client_id','environment','active','permanently_denied','scope_epoch','disclosure_epoch','bundle_version','dataset_ids','consumer_ids'].sort());
    assert.equal(state.principal_id, id); assert.equal(state.issuer, issuer);
    assert.equal(state.client_id, 'client-1'); assert.equal(state.environment, 'uat');
    assert.equal(state.active, true); assert.equal(state.permanently_denied, false);
    for (const field of ['principal_id','scope_epoch','disclosure_epoch','bundle_version']) assert.match(state[field], /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    assert.deepEqual(state.dataset_ids, ['warehouse.products']); assert.deepEqual(state.consumer_ids, ['primary']);
    assert.equal(await read(r, 'client-1', 'prod'), null);
    assert.equal(await rpc(r, 'read_current_grant', ['https://other.example.test', 'client-1', 'uat']), null);
    await assert.rejects(register(a, 'client-1'), /duplicate/i);
  });

  await t.test('exact thirty-dataset constraint and bounded, unique explicit consumer/dataset grants', async () => {
    assert.equal(DATASET_IDS.length, 30);
    const catalogCheck = (await root.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='reporting_authority.current_grants'::regclass and conname='dataset_ids_catalog'")).rows[0].definition;
    assert.deepEqual([...catalogCheck.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(match => match[1]).sort(), [...DATASET_IDS].sort());
    await grant(a, id, [...DATASET_IDS], Array.from({ length: 100 }, (_, i) => `consumer-${i}`));
    assert.equal((await read(r, 'client-1')).dataset_ids.length, 30);
    for (const datasets of [[], ['warehouse.raw_secrets'], ['warehouse.products','warehouse.products'], [null], null,
      [...DATASET_IDS, 'reference.links'], [['warehouse.products']]]) {
      await assert.rejects(grant(a, id, datasets), /grant|constraint|array/i);
    }
    for (const consumers of [[], ['primary','primary'], [null], ['bad id'], ['x'.repeat(129)], null,
      Array.from({ length: 101 }, (_, i) => `consumer-${i}`)]) await assert.rejects(grant(a, id, ['warehouse.products'], consumers), /grant|constraint/i);
    await assert.rejects(grant(a, id, ['warehouse.products'], ['primary'], ''), /constraint|bundle/i);
    await grant(a, id);
  });

  await t.test('scope, consumer, bundle and active changes rotate scope epochs; no-op preserves them; disclosure is separate', async () => {
    let previous = await read(r, 'client-1');
    await grant(a, id); assert.deepEqual(await read(r, 'client-1'), previous);
    for (const action of [() => grant(a, id, ['warehouse.products','warehouse.locations']),
      () => grant(a, id, ['warehouse.products','warehouse.locations'], ['replica-2']),
      () => grant(a, id, ['warehouse.products','warehouse.locations'], ['replica-2'], 'phase2'),
      () => active(a, id, false), () => active(a, id, true)]) {
      await action(); const current = await read(r, 'client-1');
      assert.notEqual(current.scope_epoch, previous.scope_epoch); assert.equal(current.disclosure_epoch, previous.disclosure_epoch);
      previous = current;
    }
    await rpc(a, 'rotate_disclosure', [id, 'withdrawal-1']);
    const changed = await read(r, 'client-1');
    assert.notEqual(changed.disclosure_epoch, previous.disclosure_epoch);
    assert.equal(changed.scope_epoch, previous.scope_epoch);
    await grant(a, id, ['warehouse.locations','warehouse.products'], ['replica-2'], 'phase2');
    assert.deepEqual(await read(r, 'client-1'), changed, 'Set ordering is not a scope change');
  });

  await t.test('compromise is permanent across environments and even before registration; replacement uses a new client identity', async () => {
    const prod = await register(a, 'client-1', 'prod'); await grant(a, prod); await active(a, prod, true);
    const before = await read(r, 'client-1');
    await rpc(a, 'deny_client', [issuer, 'client-1', 'incident-1']);
    for (const env of ['uat','prod']) {
      const state = await read(r, 'client-1', env);
      assert.equal(state.active, false); assert.equal(state.permanently_denied, true);
    }
    assert.notEqual((await read(r, 'client-1')).scope_epoch, before.scope_epoch);
    assert.notEqual((await read(r, 'client-1')).disclosure_epoch, before.disclosure_epoch);
    await assert.rejects(active(a, id, true), /denied/i);
    await assert.rejects(grant(a, id), /denied/i);
    await assert.rejects(register(a, 'client-1', 'future'), /denied/i);
    await rpc(a, 'deny_client', [issuer, 'unregistered', 'incident-2']);
    await assert.rejects(register(a, 'unregistered'), /denied/i);
    await rpc(a, 'deny_client', [issuer, 'client-1', 'incident-1']);
    const replacement = await register(a, 'replacement'); await grant(a, replacement); await active(a, replacement, true);
    assert.equal((await read(r, 'replacement')).active, true);
    assert.equal((await read(r, 'client-1')).permanently_denied, true);
  });

  await t.test('append-only deny/audit/identity triggers survive accidental delegated DML; no truncate/delete identity reuse', async () => {
    await root.query('begin');
    try {
      await root.query('grant all on all tables in schema reporting_authority to reporting_authority_admin');
      // Simulate an accidental DML+RLS grant without granting ownership. Roll back
      // all policies/ACLs afterward; this proves the triggers, not just ACL denial.
      for (const table of tables) await root.query(`create policy test_delegated on reporting_authority.${table}
        to reporting_authority_admin using(true) with check(true)`);
      await root.query('set local role reporting_authority_admin');
      for (const statement of [
        'delete from reporting_authority.denied_clients', 'truncate reporting_authority.denied_clients',
        "update reporting_authority.denied_clients set change_ref='changed'", 'delete from reporting_authority.admin_audit',
        'truncate reporting_authority.admin_audit', "update reporting_authority.admin_audit set change_ref='changed'",
        'delete from reporting_authority.principals', 'truncate reporting_authority.principals cascade',
        'delete from reporting_authority.current_grants', 'truncate reporting_authority.current_grants',
        "update reporting_authority.principals set client_id='replacement-identity'",
        `update reporting_authority.principals set active=true where principal_id='${id}'`,
        `insert into reporting_authority.principals(issuer,client_id,environment) values('${issuer}','client-1','new-env')`,
      ]) {
        await root.query('savepoint guard');
        await assert.rejects(root.query(statement), /immutable|append.only|denied|identity/i);
        await root.query('rollback to savepoint guard');
      }
    } finally { await root.query('rollback'); }
  });

  await t.test('successful admin changes audited atomically with real session actor; invalid refs roll back changes', async () => {
    const rows = (await root.query('select * from reporting_authority.admin_audit')).rows;
    assert.ok(rows.length >= 15);
    assert.ok(rows.every(row => row.session_actor === admin && row.change_ref && row.recorded_at));
    assert.deepEqual([...new Set(rows.map(row => row.action))].sort(), ['deny_client','register_principal','rotate_disclosure','set_active','set_grant']);
    const count = rows.length;
    await assert.rejects(rpc(a, 'register_principal', [issuer, 'invalid-ref', 'uat', '']), /constraint|change_ref/i);
    assert.equal((await root.query("select count(*)::int n from reporting_authority.principals where client_id='invalid-ref'")).rows[0].n, 0);
    assert.equal((await root.query('select count(*)::int n from reporting_authority.admin_audit')).rows[0].n, count);
    await a.query('begin');
    await register(a, 'rolled-back');
    await a.query('rollback');
    assert.equal((await root.query("select count(*)::int n from reporting_authority.principals where client_id='rolled-back'")).rows[0].n, 0);
    assert.equal((await root.query('select count(*)::int n from reporting_authority.admin_audit')).rows[0].n, count);
  });

  await t.test('hostile caller search_path and temporary shadow tables cannot change authority results', async () => {
    const before = await read(r, 'replacement');
    await r.query(`create temporary table principals(active boolean);
      create temporary table current_grants(scope_epoch uuid);
      create temporary table denied_clients(client_id text);
      insert into denied_clients values('replacement');
      set search_path=pg_temp,public,reporting_authority`);
    assert.deepEqual(await read(r, 'replacement'), before);
    await r.query('reset search_path');
  });

  await t.test('read-committed sees revocation on next call; repeatable-read/serializable are refused', async () => {
    const fresh = await register(a, 'freshness'); await grant(a, fresh); await active(a, fresh, true);
    await r.query('begin');
    try {
      assert.equal((await read(r, 'freshness')).active, true);
      await active(a, fresh, false);
      assert.equal((await read(r, 'freshness')).active, false);
    } finally { await r.query('rollback'); }
    for (const isolation of ['repeatable read','serializable']) {
      await r.query(`begin isolation level ${isolation}`);
      try { await assert.rejects(read(r, 'freshness'), /read committed|fresh/i); }
      finally { await r.query('rollback'); }
    }
  });

  await t.test('concurrent compromise fences reactivation and unregistered identity creation', async () => {
    const left = await asRole(admin), right = await asRole(admin);
    const race = await register(a, 'race'); await grant(a, race); await active(a, race, true);
    const result = await contend(root, left, right,
      () => rpc(left, 'deny_client', [issuer, 'race', 'incident-race']), () => active(right, race, true));
    assert.equal(result.loser.ok, false); assert.match(result.loser.message, /denied/i);
    const unregistered = await contend(root, left, right,
      () => rpc(left, 'deny_client', [issuer, 'race-new', 'incident-race']), () => register(right, 'race-new'));
    assert.equal(unregistered.loser.ok, false); assert.match(unregistered.loser.message, /denied/i);
    t.diagnostic(`Independent-backend lock proof: ${JSON.stringify(result.blocking)}`);
  });

  await t.test('actual operational RPCs and raw tables are denied; PUBLIC canary records the unfixable-by-role-ACL boundary', async () => {
    for (const role of [reader, admin]) {
      const c = role === reader ? r : a;
      await denied(() => c.query('select * from procurement.requests'));
      for (const name of ['decide_request_step','activate_doa_matrix','request_decision_eligibility']) {
        await denied(() => c.query(`select procurement.${name}('{}'::jsonb)`));
        assert.equal((await root.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, `procurement.${name}(jsonb)`])).rows[0].ok, false);
      }
      await denied(() => c.query('select public.operational_restricted_canary()'));
    }
    await denied(() => r.query('select * from public.operational_canary'));
    await r.query('begin');
    try {
      await r.query('select public.operational_public_canary()');
      // Effective PUBLIC execute cannot be subtracted with REVOKE FROM reader.
      assert.equal((await root.query("select has_function_privilege($1,'public.operational_public_canary()','EXECUTE') ok", [reader])).rows[0].ok, true);
    } finally { await r.query('rollback'); }
    assert.equal((await root.query('select count(*)::int n from public.operational_canary')).rows[0].n, 0);
    assert.deepEqual(await fixture.snapshot(root), operationalBefore);
    assert.deepEqual(await operationalAcl(), aclBefore);
    t.diagnostic('BLOCKED for activation: arbitrary PUBLIC-executable operational functions in usable schemas remain callable. Canary demonstrates the boundary; no live/full-catalog isolation claim.');
  });
});
