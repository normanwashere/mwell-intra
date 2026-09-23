// Disposable PostgreSQL only. Never reads DATABASE_URL, .env, or Supabase credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';

export const authorityRoles = ['reporting_authority_owner', 'reporting_authority_reader', 'reporting_authority_admin'];
export const installerRole = 'reporting_authority_installer_fixture';
const apiRoles = ['anon', 'authenticated', 'service_role'];

export function ciTarget(env) {
  assert.equal(env.CI, 'true');
  assert.equal(env.SEP22_DOA_EPHEMERAL_CI, '1', 'Explicit disposable service opt-in required');
  const url = new URL(env.SEP22_DOA_CI_DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Numeric loopback only');
  assert.equal(url.username, 'postgres');
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url;
}

export function assertCiIdentity(identity) {
  assert.ok(identity.version >= 170000 && identity.version < 180000, 'PostgreSQL 17 required');
  assert.equal(identity.cluster_name, 'sep22_doa_ci');
  assert.equal(identity.database, 'postgres');
  for (const field of ['other_databases', 'other_schemas', 'public_objects', 'memberships']) {
    assert.equal(identity[field], 0, `Refusing non-disposable service: ${field}`);
  }
  for (const role of identity.roles) {
    assert.ok(apiRoles.includes(role.rolname), `Unexpected pre-existing role: ${role.rolname}`);
    for (const attr of ['rolsuper', 'rolcanlogin', 'rolcreatedb', 'rolcreaterole', 'rolreplication']) assert.equal(role[attr], false);
    if (role.rolname !== 'service_role') assert.equal(role.rolbypassrls, false);
  }
}

export async function startAuthorityRuntime(t) {
  const local = process.env.SEP22_DOA_PG_BIN;
  assert.ok(!(local && (process.env.SEP22_DOA_CI_DATABASE_URL || process.env.SEP22_DOA_EPHEMERAL_CI)), 'Choose one disposable runtime');
  if (local) {
    const { startScratch } = await import('../qa/sep20-native-runtime.mjs');
    const output = await mkdtemp(path.join(tmpdir(), 'reporting-authority-evidence-'));
    const previous = [process.env.SEP20_PG_BIN, process.env.SEP20_NATIVE_OUTPUT];
    process.env.SEP20_PG_BIN = local;
    process.env.SEP20_NATIVE_OUTPUT = output;
    let runtime;
    try { runtime = await startScratch(); }
    finally {
      for (const [index, name] of ['SEP20_PG_BIN', 'SEP20_NATIVE_OUTPUT'].entries()) {
        if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
      }
    }
    t.after(() => runtime.close());
    const admin = await runtime.connect();
    await admin.query('create role postgres superuser nologin');
    t.diagnostic(`${runtime.version}; disposable ${runtime.data}; logs ${output}`);
    return runtime.database('reporting_authority');
  }

  const url = ciTarget(process.env);
  const clients = new Set();
  async function connect(database) {
    assert.ok(database === 'postgres' || /^reporting_authority_[0-9a-f]{32}$/.test(database));
    const client = new Client({ host: url.hostname === '[::1]' ? '::1' : url.hostname,
      port: Number(url.port || 5432), user: 'postgres', password: decodeURIComponent(url.password),
      database, ssl: false, options: '', connectionTimeoutMillis: 5000,
      application_name: 'reporting-authority-disposable-proof' });
    await client.connect(); clients.add(client);
    await client.query("set statement_timeout='15s'; set lock_timeout='10s'; set idle_in_transaction_session_timeout='30s'");
    return client;
  }
  const admin = await connect('postgres');
  const name = `reporting_authority_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  const createdApiRoles = [];
  t.after(async () => {
    for (const client of clients) {
      if (client === admin) continue;
      await client.query('rollback').catch(() => {});
      await client.end();
    }
    try {
      if (created) {
        assert.match(name, /^reporting_authority_[0-9a-f]{32}$/);
        await admin.query(`drop database "${name}"`);
        // These names were absent in the validated cluster before our migration.
        for (const role of [...authorityRoles, installerRole]) await admin.query(`drop role if exists "${role}"`);
      }
      for (const role of createdApiRoles) await admin.query(`drop role "${role}"`);
    } finally { await admin.end(); }
  });
  const identity = (await admin.query(`select current_setting('server_version_num')::int version,
    current_database() database, current_setting('cluster_name') cluster_name,
    (select count(*)::int from pg_database where not datistemplate and datname <> 'postgres') other_databases,
    (select count(*)::int from pg_namespace where nspname !~ '^pg_' and nspname not in ('public','information_schema')) other_schemas,
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace) +
      (select count(*)::int from pg_proc where pronamespace='public'::regnamespace) public_objects,
    (select count(*)::int from pg_auth_members m join pg_roles r on r.oid=m.roleid
      join pg_roles u on u.oid=m.member where r.rolname !~ '^pg_'
      or (u.rolname !~ '^pg_' and u.rolname <> 'postgres')) memberships,
    coalesce((select jsonb_agg(jsonb_build_object('rolname',rolname,'rolsuper',rolsuper,
      'rolcanlogin',rolcanlogin,'rolcreatedb',rolcreatedb,'rolcreaterole',rolcreaterole,
      'rolreplication',rolreplication,'rolbypassrls',rolbypassrls))
      from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres'),'[]') roles`)).rows[0];
  assertCiIdentity(identity);
  for (const role of apiRoles) {
    if (identity.roles.some(value => value.rolname === role)) continue;
    await admin.query(`create role "${role}" nologin ${role === 'service_role' ? 'bypassrls' : ''}`);
    createdApiRoles.push(role);
  }
  await admin.query(`create database "${name}" template template0`);
  created = true;
  t.diagnostic(`PostgreSQL 17 guarded sequential CI service; disposable ${name}`);
  return { name, client: await connect(name), newClient: () => connect(name), close: async () => {} };
}
