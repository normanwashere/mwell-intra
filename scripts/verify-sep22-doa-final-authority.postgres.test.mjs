// Local: SEP22_DOA_PG_BIN=<PostgreSQL 17 bin directory> node this-file.mjs
// CI: CI=true SEP22_DOA_EPHEMERAL_CI=1 SEP22_DOA_CI_DATABASE_URL=<loopback postgres URL>
// CI service: POSTGRES_INITDB_ARGS=--set=cluster_name=sep22_doa_ci
// A dedicated pristine PostgreSQL 17 service is required; DATABASE_URL/.env are never read.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureFile = 'scripts/verify-sep22-doa-final-authority.pglite.test.mjs';
const migrationFile = 'supabase/migrations/20260922123940_procurement_final_approval_doa_authority.sql';
const retryMessage = /approval policy is being updated.*nothing was saved.*try again/is;
const freshSessionMessage = /fresh session.*nothing was saved.*try again/is;
const enabled = Boolean(process.env.SEP22_DOA_PG_BIN || process.env.SEP22_DOA_CI_DATABASE_URL || process.env.SEP22_DOA_EPHEMERAL_CI);
const sha256 = text => createHash('sha256').update(text).digest('hex');

function ciTarget(env) {
  assert.equal(env.CI, 'true', 'CI service mode requires CI=true');
  assert.equal(env.SEP22_DOA_EPHEMERAL_CI, '1', 'Explicit disposable CI service opt-in required');
  const url = new URL(env.SEP22_DOA_CI_DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Only numeric loopback hosts are accepted');
  assert.equal(url.pathname, '/postgres', 'Only the pristine service maintenance database is accepted');
  assert.equal(url.username, 'postgres');
  assert.equal(url.search, '', 'Connection overrides are not accepted');
  assert.equal(url.hash, '');
  return url;
}

function assertPristineService(identity) {
  assert.ok(identity.version >= 170000 && identity.version < 180000, 'PostgreSQL 17 is required');
  assert.equal(identity.cluster_name, 'sep22_doa_ci', 'Disposable CI service marker required');
  assert.equal(identity.database, 'postgres');
  for (const key of ['other_databases', 'other_roles', 'other_schemas', 'public_tables']) {
    assert.equal(identity[key], 0, `Refusing non-pristine CI service: ${key}`);
  }
}

test('native DOA harness refuses non-disposable connection targets before connecting', () => {
  const base = { CI: 'true', SEP22_DOA_EPHEMERAL_CI: '1', SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1:5432/postgres' };
  assert.equal(ciTarget(base).hostname, '127.0.0.1');
  for (const change of [
    { CI: 'false' }, { SEP22_DOA_EPHEMERAL_CI: undefined },
    { SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:fixture@db.example.test/postgres' },
    { SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1/production' },
    { SEP22_DOA_CI_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1/postgres?host=db.example.test' },
  ]) assert.throws(() => ciTarget({ ...base, ...change }));
});

test('native DOA harness requires a marked pristine service, not a loopback server socket', () => {
  const identity = { version: 170010, cluster_name: 'sep22_doa_ci', database: 'postgres',
    address: '172.18.0.2', other_databases: 0, other_roles: 0, other_schemas: 0, public_tables: 0 };
  assert.doesNotThrow(() => assertPristineService(identity));
  for (const change of [
    { version: 160000 }, { cluster_name: '' }, { cluster_name: 'uat' }, { database: 'production' },
    { other_databases: 1 }, { other_roles: 1 }, { other_schemas: 1 }, { public_tables: 1 },
  ]) assert.throws(() => assertPristineService({ ...identity, ...change }));
});

async function startCiRuntime() {
  const url = ciTarget(process.env);
  const require = createRequire(path.join(root, 'package.json'));
  let Client;
  try { ({ Client } = require('pg')); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const directory = readdirSync(path.join(root, 'node_modules/.pnpm')).find(name => /^pg@8\./.test(name));
    assert.ok(directory, 'Use the existing workspace pg driver; do not install dependencies for this harness');
    ({ Client } = require(path.join(root, 'node_modules/.pnpm', directory, 'node_modules/pg')));
  }
  const connections = new Set();
  const databases = new Set();
  async function connect(database = 'postgres') {
    assert.ok(database === 'postgres' || /^sep22_doa_[0-9a-f]{32}$/.test(database), 'Only harness-created database names are accepted');
    const client = new Client({
      host: url.hostname === '[::1]' ? '::1' : url.hostname,
      port: Number(url.port || 5432), user: 'postgres', password: decodeURIComponent(url.password),
      database, ssl: false, options: '', connectionTimeoutMillis: 5000,
      application_name: 'sep22-disposable-doa-concurrency',
    });
    await client.connect();
    connections.add(client);
    await client.query("set statement_timeout='15s'; set lock_timeout='10s'; set idle_in_transaction_session_timeout='30s'");
    return client;
  }
  const admin = await connect();
  try {
    const identity = (await admin.query(`select current_setting('server_version_num')::int version,
      current_database() database, current_setting('cluster_name') cluster_name,
      (select count(*)::int from pg_database where not datistemplate and datname<>'postgres') other_databases,
      (select count(*)::int from pg_roles where rolname!~'^pg_' and rolname<>'postgres') other_roles,
      (select count(*)::int from pg_namespace where nspname!~'^pg_' and nspname not in ('public','information_schema')) other_schemas,
      (select count(*)::int from pg_tables where schemaname='public') public_tables`)).rows[0];
    assertPristineService(identity);
    await admin.query('create role anon; create role authenticated; create role service_role bypassrls');
  } catch (error) {
    for (const client of connections) await client.end().catch(() => {});
    throw error;
  }
  return {
    version: 'PostgreSQL 17 (disposable CI service)',
    async database() {
      const name = `sep22_doa_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`create database "${name}" template template0`);
      databases.add(name);
      const clients = [];
      async function newClient() { const client = await connect(name); clients.push(client); return client; }
      return { name, client: await newClient(), newClient, async close() {
        for (const client of clients) {
          await client.query('rollback').catch(() => {});
          await client.end().catch(() => {});
          connections.delete(client);
        }
        assert.ok(databases.has(name) && /^sep22_doa_[0-9a-f]{32}$/.test(name));
        await admin.query(`drop database "${name}"`);
        databases.delete(name);
      } };
    },
    async close() {
      for (const client of connections) {
        await client.query('rollback').catch(() => {});
        await client.end().catch(() => {});
      }
    },
  };
}

async function setActor(client, actor) {
  await client.query("select set_config('test.actor',$1,true),set_config('test.certified','true',true)", [actor]);
  await client.query('set local role authenticated');
}

async function begin(client, actor, isolation = 'read committed') {
  assert.ok(['read committed', 'repeatable read', 'serializable'].includes(isolation));
  await client.query(`begin isolation level ${isolation}`);
  if (actor) await setActor(client, actor);
}

const rpc = async (client, name, payload) => (await client.query(`select procurement.${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
const eligible = client => rpc(client, 'request_decision_eligibility', { request_id: 'request' });
const decide = (client, f, overrides = {}) => rpc(client, 'decide_request_step', {
  request_id: 'request', step_id: 'final', tier: 'final_approver', decision: 'approved', signature: f.signature, ...overrides,
});
const activate = (client, f) => rpc(client, 'activate_doa_matrix', { matrix_id: f.draft });
const insertAssignment = (client, f) => client.query(`insert into procurement.doa_assignments
  (matrix_id,department,tier,min_amount,max_amount,category,active,approver_user_id)
  values($1,'operations','final_approver',0,null,null,true,$2)`, [f.matrix, f.actor]);

test('native PostgreSQL final-DOA transaction races', {
  skip: enabled ? false : 'Set SEP22_DOA_PG_BIN or explicitly opt into a pristine loopback CI PostgreSQL service',
  timeout: 180000,
}, async t => {
  assert.equal(path.resolve(process.cwd()), path.resolve(root), 'Run from the app worktree root');
  assert.ok(!(process.env.SEP22_DOA_PG_BIN && process.env.SEP22_DOA_CI_DATABASE_URL), 'Choose one runtime');
  const { fixtureFrom, startScratch, contend, installedFunctions } = await import('./qa/sep20-native-runtime.mjs');
  let runtime;
  if (process.env.SEP22_DOA_PG_BIN) {
    const output = await mkdtemp(path.join(tmpdir(), 'sep22-doa-evidence-'));
    const oldBin = process.env.SEP20_PG_BIN, oldOutput = process.env.SEP20_NATIVE_OUTPUT;
    process.env.SEP20_PG_BIN = process.env.SEP22_DOA_PG_BIN;
    process.env.SEP20_NATIVE_OUTPUT = output;
    try { runtime = await startScratch(); }
    finally {
      if (oldBin === undefined) delete process.env.SEP20_PG_BIN; else process.env.SEP20_PG_BIN = oldBin;
      if (oldOutput === undefined) delete process.env.SEP20_NATIVE_OUTPUT; else process.env.SEP20_NATIVE_OUTPUT = oldOutput;
    }
    t.after(() => runtime.close());
    const admin = await runtime.connect();
    // The scratch initializer deliberately uses a separate bootstrap owner.
    await admin.query('create role postgres superuser nologin');
    t.diagnostic(`Native ${runtime.version}; isolated cluster ${runtime.data}; logs ${output}`);
  } else {
    runtime = await startCiRuntime();
    t.after(() => runtime.close());
    t.diagnostic(runtime.version);
  }
  const source = new Map();
  for (const file of [fixtureFile, migrationFile]) source.set(file, sha256(await readFile(path.join(root, file))));
  async function assertSourcesUnchanged() {
    for (const [file, hash] of source) assert.equal(sha256(await readFile(path.join(root, file))), hash, `${file} changed during native verification; rerun`);
  }
  t.after(assertSourcesUnchanged);
  t.diagnostic(`Candidate SHA-256 ${source.get(migrationFile)}`);
  let caseNumber = 0;
  async function scenario(name, action) {
    await t.test(name, async st => {
      await assertSourcesUnchanged();
      const db = await runtime.database(`doa_${++caseNumber}`);
      st.after(() => db.close());
      const f = await fixtureFrom(fixtureFile, ['fixture', 'actor', 'checker', 'matrix', 'draft', 'signature', 'snapshot'], db.client);
      await f.fixture({ after() {} });
      if (caseNumber === 1) st.diagnostic(JSON.stringify(await installedFunctions(db.client, [
        'procurement.decide_request_step(jsonb)', 'procurement.decide_request_step_uncertified_impl(jsonb)',
        'procurement.request_decision_eligibility(jsonb)',
        'private.procurement_final_doa_matches(procurement.requests,procurement.approval_steps)',
      ])));
      const a = await db.newClient(), b = await db.newClient();
      assert.notEqual((await a.query('select pg_backend_pid() pid')).rows[0].pid, (await b.query('select pg_backend_pid() pid')).rows[0].pid);
      await action({ db, f, a, b, st });
    });
  }

  await scenario('decision holds both SHARE locks while a second final decision remains concurrent', async ({ db, f, a, b }) => {
    await db.client.query(`insert into procurement.requests(id,requester_id,status,department,category,estimated_amount)
      select 'request-2',requester_id,status,department,category,estimated_amount from procurement.requests where id='request';
      insert into procurement.approval_steps(id,request_id,status,step_order,assigned_user_id,tier,matrix_version)
      select 'final-2','request-2',status,step_order,assigned_user_id,tier,matrix_version from procurement.approval_steps where id='final'`);
    await begin(a, f.actor);
    assert.equal((await decide(a, f)).status, 'approved');
    const pid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
    const locks = (await db.client.query(`select n.nspname||'.'||c.relname name from pg_locks l
      join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
      where l.pid=$1 and l.mode='ShareLock' and l.granted order by 1`, [pid])).rows.map(row => row.name);
    assert.deepEqual(locks, ['procurement.doa_assignments', 'procurement.doa_matrices']);
    await begin(b, f.actor);
    assert.equal((await decide(b, f, { request_id: 'request-2', step_id: 'final-2' })).status, 'approved');
    await b.query('commit'); await a.query('commit');
    assert.equal((await db.client.query('select count(*)::int n from core.activity_log')).rows[0].n, 2);
  });

  for (const writer of ['activation', 'assignment insertion']) {
    await scenario(`decision-first ${writer} demonstrably blocks until decision commit`, async ({ db, f, a, b, st }) => {
      const before = await f.snapshot(db.client);
      const result = await contend(db.client, a, b,
        async c => { await setActor(c, f.actor); return decide(c, f); },
        async c => {
          if (writer === 'activation') { await setActor(c, f.checker); return activate(c, f); }
          await insertAssignment(c, f); return { inserted: true };
        });
      assert.equal(result.winner.status, 'approved'); assert.equal(result.loser.ok, true);
      st.diagnostic(JSON.stringify(result.blocking));
      const after = await f.snapshot(db.client);
      assert.deepEqual(after.steps.filter(s => s.id !== 'final'), before.steps.filter(s => s.id !== 'final'));
      assert.equal(after.steps.find(s => s.id === 'final').status, 'approved');
      assert.equal(after.steps.find(s => s.id === 'final').matrix_version, 'OPS-1');
      assert.equal(after.audit.filter(e => e.action === 'approval_step_approved').length, 1);
    });
  }

  for (const writer of ['activation', 'assignment insertion', 'unrelated draft insertion']) {
    await scenario(`writer-first ${writer} returns retry without decision writes`, async ({ db, f, a, b }) => {
      const before = await f.snapshot(db.client);
      await begin(a, writer === 'activation' ? f.checker : undefined);
      if (writer === 'activation') await activate(a, f);
      else if (writer === 'assignment insertion') await insertAssignment(a, f);
      else await a.query(`insert into procurement.doa_matrices(id,department,version,active,status,effective_at)
        values(gen_random_uuid(),'marketing','UNRELATED-DRAFT',false,'draft',now())`);
      await begin(b, f.actor);
      assert.equal((await eligible(b)).canDecide, true, 'Uncommitted writer is invisible to the preview');
      await assert.rejects(decide(b, f), error => error.code === 'P0001' && retryMessage.test(error.message));
      await b.query('rollback');
      assert.deepEqual(await f.snapshot(db.client), before);
      if (writer === 'unrelated draft insertion') {
        await a.query('rollback'); await begin(b, f.actor);
        assert.equal((await decide(b, f)).status, 'approved'); await b.query('commit');
      } else {
        await a.query('commit');
        const afterWriter = await f.snapshot(db.client);
        await begin(b, f.actor);
        assert.equal((await eligible(b)).reasonCode, 'approval_doa_required');
        await assert.rejects(decide(b, f), /current approval policy/i);
        await b.query('rollback');
        assert.deepEqual(await f.snapshot(db.client), afterWriter);
      }
    });
  }

  await scenario('nonfinal decision is unaffected by writers holding both DOA tables', async ({ db, f, a, b }) => {
    await db.client.query("update procurement.approval_steps set status='pending' where id='department'");
    await begin(a);
    await a.query('update procurement.doa_matrices set approved_by_name=approved_by_name where id=$1', [f.draft]);
    await a.query('update procurement.doa_assignments set active=active where matrix_id=$1', [f.draft]);
    await begin(b, f.actor);
    assert.equal((await decide(b, f, { step_id: 'department', tier: 'dept_head' })).status, 'under_review');
    await b.query('commit'); await a.query('rollback');
    assert.equal((await db.client.query("select status from procurement.approval_steps where id='final'")).rows[0].status, 'pending');
  });

  await scenario('the real numeric(14,2) constraint admits NaN but final authority rejects it', async ({ db, f, a }) => {
    await db.client.query(`alter table procurement.doa_assignments
      alter column min_amount type numeric(14,2), alter column max_amount type numeric(14,2),
      add constraint doa_assignment_amount_check check (min_amount>=0 and (max_amount is null or max_amount>=min_amount))`);
    await db.client.query("update procurement.doa_assignments set max_amount='NaN' where matrix_id=$1", [f.matrix]);
    const before = await f.snapshot(db.client);
    await begin(a, f.actor);
    assert.equal((await eligible(a)).reasonCode, 'approval_doa_required');
    await assert.rejects(decide(a, f), /current approval policy/i);
    await a.query('rollback');
    assert.deepEqual(await f.snapshot(db.client), before);
  });

  for (const isolation of ['repeatable read', 'serializable']) {
    await scenario(`${isolation} cannot use a stale policy snapshot after committed rotation`, async ({ db, f, a, b }) => {
      await begin(b, f.actor, isolation);
      assert.equal((await eligible(b)).canDecide, true);
      await begin(a, f.checker); await activate(a, f); await a.query('commit');
      const afterRotation = await f.snapshot(db.client);
      await assert.rejects(decide(b, f), error => error.code === 'P0001' && freshSessionMessage.test(error.message));
      await b.query('rollback');
      assert.deepEqual(await f.snapshot(db.client), afterRotation);
    });
  }

  for (const isolation of ['repeatable read', 'serializable']) {
    await scenario(`nonfinal decisions retain ${isolation} compatibility`, async ({ db, f, a }) => {
      await db.client.query("update procurement.approval_steps set status='pending' where id='department'");
      await begin(a, f.actor, isolation);
      assert.equal((await decide(a, f, { step_id: 'department', tier: 'dept_head' })).status, 'under_review');
      await a.query('commit');
      assert.equal((await db.client.query("select status from procurement.approval_steps where id='final'")).rows[0].status, 'pending');
    });
  }

  await scenario('negative control: removing policy locks permits approval during an assignment phantom', async ({ db, f, a, b }) => {
    const body = (await db.client.query("select pg_get_functiondef('procurement.decide_request_step_uncertified_impl(jsonb)'::regprocedure) body")).rows[0].body;
    const faulty = body.replace(/lock table procurement\.doa_matrices,\s*procurement\.doa_assignments in share mode nowait;/i, 'perform 1;');
    assert.notEqual(faulty, body, 'Negative control must remove the actual lock from the installed body');
    await db.client.query(faulty);
    await begin(a); await insertAssignment(a, f);
    await begin(b, f.actor);
    assert.equal((await decide(b, f)).status, 'approved', 'Known-bad lockless implementation must expose the race');
    await b.query('commit'); await a.query('commit');
    assert.equal((await db.client.query('select count(*)::int n from procurement.doa_assignments where matrix_id=$1', [f.matrix])).rows[0].n, 2);
  });
});
