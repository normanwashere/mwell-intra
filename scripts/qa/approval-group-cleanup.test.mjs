import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as cleanup from './cleanup-uat-live-run.mjs';

const scope = { runId: 'QA-20260905-00003C1F', viewport: 'desktop-1440', buildId: 'a'.repeat(40), project: 'kkoitlvydytdhlpxhuah' };
const env = { APP_ENV: 'uat', NEXT_PUBLIC_SUPABASE_URL: `https://${scope.project}.supabase.co`,
  SUPABASE_PROJECT_REF: scope.project, PRODUCTION_SUPABASE_PROJECT_REF: 'abbfziukjalyqtcuskhi',
  POLICY_ALLOW_TEST_MUTATIONS: 'true', GITHUB_SHA: scope.buildId };
const groupKey = { entity_type: 'warehouse_stock_change', group_code: 'logistics_supervisor' };

function database() {
  const state = { members: ['warehouse_supervisor', 'logistics_supervisor'], updates: 0, deletes: 0, reads: 0, hook: () => {}, roleRows: [] };
  const client = {
    schema(schema) { return {
      from(table) {
        let update, remove = false, single = false;
        const filters = [];
        const q = {
          select() { return q; }, update(value) { update = value; return q; }, delete() { remove = true; return q; },
          eq(key, value) { filters.push([key, value]); return q; }, in() { return q; }, like() { return q; },
          order() { return q; }, range() { return q; }, limit() { return q; }, lte() { return q; }, single() { single = true; return q; }, abortSignal() { return q; },
          then(resolve, reject) { return Promise.resolve().then(async () => {
            if (remove) { state.deletes++; return { data: [], error: null, count: 0 }; }
            if (table !== 'approval_groups') return { data: state.producer && ['policy_profiles', 'locations', 'profiles'].includes(table)
              ? [{ id: 'offline-profile', full_name: 'Offline Operator' }] : table === 'roles' ? state.roleRows : [], error: null, count: 0 };
            assert.equal(schema, 'core');
            assert(filters.some(([k, v]) => k === 'entity_type' && v === groupKey.entity_type));
            assert(filters.some(([k, v]) => k === 'group_code' && v === groupKey.group_code));
            if (update) {
              state.updates++;
              await state.hook('update', state);
              const expected = filters.find(([key]) => key === 'member_roles');
              if (expected && expected[1] !== `{${state.members.map(r => `"${r.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`)
                return { data: [], error: null, status: 200 };
              state.members = [...update.member_roles];
              await state.hook('updated', state);
            } else { state.reads++; await state.hook('read', state); }
            const row = { ...groupKey, member_roles: structuredClone(state.members) };
            return { data: single ? row : [row], error: null, status: 200 };
          }).then(resolve, reject); },
        };
        return q;
      },
      async rpc(_name, args) { return { data: { marker: args.p_marker, removed: 0, remaining: 0 }, error: null }; },
    }; },
    storage: { from() { return { async list() { return { data: [], error: null }; }, async remove() { return { error: null }; } }; } },
    auth: { admin: { async listUsers() { return { data: { users: [] }, error: null }; } } },
  };
  return { client, state };
}

async function fixture(t) {
  const h = database();
  const root = await mkdtemp(path.join(tmpdir(), 'approval-membership-'));
  t.after(() => { assert(path.resolve(root).startsWith(path.join(tmpdir(), 'approval-membership-'))); return rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'intent.json');
  assert.equal(typeof cleanup.prepareTask3ApprovalMembership, 'function', 'durable setup helper required');
  const evidence = await cleanup.prepareTask3ApprovalMembership({ client: h.client, file, scope });
  return { ...h, root, file, evidence };
}

test('independent cleanup cannot certify missing membership evidence even with no surviving role rows', async () => {
  const h = database();
  const report = await cleanup.cleanupAndVerifyRun({ ...scope, env, client: h.client });
  assert.equal(report.complete, false);
  assert.equal(report.results.find(r => r.entity === 'core.approval_groups:run-role-membership').remaining, null);
  assert.equal(h.state.deletes, 0);
});

for (const mode of ['add', 'remove']) test(`${mode} preserves concurrent legitimate membership on explicit CAS no-match`, async t => {
  const h = await fixture(t);
  if (mode === 'remove') h.state.members.push(...h.evidence.roles);
  h.state.hook = (event, s) => { if (event === 'update' && s.updates === 1) s.members = ['new_legitimate_member', ...s.members.slice(1)]; };
  const result = await cleanup.changeTask3ApprovalMembership({ client: h.client, file: h.file, scope, mode });
  assert.equal(result.remaining, 0);
  assert.deepEqual(h.state.members, ['new_legitimate_member', 'logistics_supervisor', ...(mode === 'add' ? h.evidence.roles : [])]);
  assert.equal(h.state.updates, 2);
});

test('independent cleanup uses durable exact keys after role rows disappear and is repeatable', async t => {
  const h = await fixture(t);
  h.state.members.push(...h.evidence.roles, 'foreign_dangling_role');
  for (let n = 0; n < 2; n++) {
    const report = await cleanup.cleanupAndVerifyRun({ ...scope, env, client: h.client, approvalMembershipFile: h.file });
    assert.equal(report.complete, true, JSON.stringify(report));
    assert.deepEqual(h.state.members, ['warehouse_supervisor', 'logistics_supervisor', 'foreign_dangling_role']);
  }
  assert.equal(h.state.updates, 1);
});

test('unknown update outcome is read back but never replayed or credited', async t => {
  const h = await fixture(t);
  h.state.members.push(...h.evidence.roles);
  h.state.hook = event => { if (event === 'updated') throw Error('transport lost after commit'); };
  await assert.rejects(cleanup.changeTask3ApprovalMembership({ client: h.client, file: h.file, scope, mode: 'remove' }), /unknown/);
  assert.equal(h.state.updates, 1);
  assert.deepEqual(h.state.members, ['warehouse_supervisor', 'logistics_supervisor']);
  const logs = (await readdir(h.root)).filter(f => f.endsWith('.jsonl'));
  assert.equal(logs.length, 1);
  const events = (await readFile(path.join(h.root, logs[0]), 'utf8')).trim().split('\n').map(JSON.parse);
  assert(events.some(e => e.event === 'unknown-readback' && e.memberRoles.length === 2));
  assert(!events.some(e => e.event === 'verified'));
});

test('real Supabase transport failure performs one PATCH only and retains an uncertain result', async t => {
  const h = await fixture(t);
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  let patches = 0, reads = 0;
  let members = ['warehouse_supervisor', ...h.evidence.roles];
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, 'offline-only-public-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (_url, options) => {
      if (options.method === 'PATCH') { patches++; members = JSON.parse(options.body).member_roles; throw Error('connection closed'); }
      assert.equal(options.method, 'GET'); reads++;
      return new Response(JSON.stringify({ ...groupKey, member_roles: members }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  await assert.rejects(cleanup.changeTask3ApprovalMembership({ client, file: h.file, scope, mode: 'remove' }), /unknown/);
  assert.equal(patches, 1); assert.equal(reads, 2);
});

test('setup refuses duplicate intent files and preexisting owned keys before any update', async t => {
  const h = await fixture(t);
  const original = await readFile(h.file, 'utf8');
  await assert.rejects(cleanup.prepareTask3ApprovalMembership({ client: h.client, file: h.file, scope }), /EEXIST/);
  assert.equal(await readFile(h.file, 'utf8'), original);
  h.state.members.push(h.evidence.roles[0]);
  await assert.rejects(cleanup.prepareTask3ApprovalMembership({ client: h.client, file: path.join(h.root, 'other.json'), scope }), /already present/);
  assert.equal(h.state.updates, 0);
});

test('interrupted setup intent permits absence readback without inventing an applied mutation', async t => {
  const h = await fixture(t);
  const report = await cleanup.cleanupAndVerifyRun({ ...scope, env, client: h.client, approvalMembershipFile: h.file });
  assert.equal(report.complete, true);
  const membership = report.results.find(r => r.entity === 'core.approval_groups:run-role-membership');
  assert.equal(membership.removed, 0); assert.equal(membership.remaining, 0); assert.equal(h.state.updates, 0);
});

for (const field of ['runId', 'viewport', 'buildId', 'project', 'roles', 'before', 'kind'])
  test(`rejects foreign or malformed intent ${field} before database access`, async t => {
    const h = await fixture(t);
    const evidence = structuredClone(h.evidence);
    evidence[field] = field === 'roles' ? ['warehouse_supervisor', 'logistics_supervisor'] : 'foreign';
    await writeFile(h.file, JSON.stringify(evidence));
    const before = h.state.reads;
    await assert.rejects(cleanup.changeTask3ApprovalMembership({ client: h.client, file: h.file, scope, mode: 'remove' }));
    assert.equal(h.state.reads, before); assert.equal(h.state.updates, 0);
  });

test('bounded conflicts never delete discoverability rows or certify cleanup', async t => {
  const h = await fixture(t);
  h.state.members.push(...h.evidence.roles);
  h.state.hook = (event, s) => { if (event === 'update') s.members.push(`concurrent_${s.updates}`); };
  const report = await cleanup.cleanupAndVerifyRun({ ...scope, env, client: h.client, approvalMembershipFile: h.file });
  assert.equal(report.complete, false); assert.equal(h.state.updates, 3); assert.equal(h.state.deletes, 0);
});

test('missing or residual final readback blocks cleanup after a successful update', async t => {
  for (const failure of ['missing', 'residual']) {
    const h = await fixture(t);
    h.state.members.push(...h.evidence.roles);
    h.state.hook = (event, s) => { if (event === 'read' && s.updates) {
      if (failure === 'missing') throw Error('read denied');
      s.members.push(h.evidence.roles[0]);
    } };
    const report = await cleanup.cleanupAndVerifyRun({ ...scope, env, client: h.client, approvalMembershipFile: h.file });
    assert.equal(report.complete, false); assert.equal(h.state.updates, 1); assert.equal(h.state.deletes, 0);
  }
});

test('final absence verification cannot silently repair a reintroduced owned member', async t => {
  const h = await fixture(t);
  h.state.members.push(h.evidence.roles[0]);
  await assert.rejects(cleanup.changeTask3ApprovalMembership({ client: h.client, file: h.file, scope, mode: 'verify' }), /residue/);
  assert.equal(h.state.updates, 0);
});

async function sourceFunction(name, dependencies) {
  const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(`async function ${name}(`);
  assert(start >= 0);
  const end = source.indexOf('\nasync function ', start + 1);
  return new Function(...Object.keys(dependencies), `${source.slice(start, end)}; return ${name};`)(...Object.values(dependencies));
}

test('actual Task3 producer persists exact intent before inserts; normal cleanup preserves a later legitimate member', async t => {
  const h = database(); h.state.producer = true;
  const root = await mkdtemp(path.join(tmpdir(), 'approval-membership-producer-'));
  t.after(() => { assert(path.resolve(root).startsWith(path.join(tmpdir(), 'approval-membership-producer-'))); return rm(root, { recursive: true, force: true }); });
  let saved, insertedRoles;
  const stop = Error('stop before unrelated fixtures');
  const create = await sourceFunction('createTask3ReceiptFixture', { ...cleanup, path, crypto: { randomUUID },
    process: { env }, auditRunId: scope.runId, auditEvidenceDir: root, projectRef: scope.project,
    createAuditDatabaseClient: () => h.client, createReceivingAuditEvidence: () => ({ cleanup: async () => { throw stop; } }),
    insertAuditRows: async (_client, _schema, table, rows) => {
      if (table === 'vendors') throw stop;
      const names = (await readdir(root)).filter(n => n.endsWith('.json'));
      assert.equal(names.length, 1, 'typed intent must exist BEFORE first insert');
      const intent = JSON.parse(await readFile(path.join(root, names[0]), 'utf8'));
      assert.equal(intent.runId, scope.runId); assert.equal(intent.buildId, scope.buildId);
      if (table === 'roles') { insertedRoles = rows.map(row => row.role); assert.deepEqual(intent.roles, insertedRoles); }
    },
  });
  await assert.rejects(create(`${scope.runId}-${scope.viewport}`, f => { saved = f; }), error => error === stop);
  assert.deepEqual(h.state.members.slice(-2), insertedRoles);
  h.state.members = ['concurrent_legitimate', ...h.state.members.slice(1)];
  const remove = await sourceFunction('cleanupTask3ReceiptFixture', cleanup);
  await assert.rejects(remove(saved), error => error === stop);
  assert.deepEqual(h.state.members, ['concurrent_legitimate', 'logistics_supervisor']);
  const verify = await sourceFunction('assertTask3ZeroResidualRows', cleanup);
  h.state.members.push(insertedRoles[0]);
  const beforeUpdates = h.state.updates;
  await assert.rejects(verify(saved), /residue/);
  assert.equal(h.state.updates, beforeUpdates);
});

test('CI passes same-run transaction membership artifacts to strict cleanup and retains recovery receipts', async () => {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const yaml = createRequire(require.resolve('eslint'))('js-yaml');
  const workflow = yaml.load(await readFile(new URL('../../.github/workflows/uat-live-certification.yml', import.meta.url), 'utf8'));
  assert(workflow.jobs.prepare.steps.some(step => step.run?.includes('node --test') && step.run.includes('scripts/qa/approval-group-cleanup.test.mjs')));
  const steps = workflow.jobs.cleanup.steps;
  const download = steps.findIndex(step => step.uses?.startsWith('actions/download-artifact@'));
  const execute = steps.findIndex(step => step.run?.includes('cleanup-uat-live-run.mjs'));
  assert(download >= 0 && download < execute, 'exact transaction evidence must be downloaded before cleanup');
  assert.deepEqual(steps[download].with, { name: 'uat-transactions-${{ matrix.viewport }}-${{ github.run_number }}', path: 'test-results/transaction-source' });
  assert.match(steps[execute].run, /--approval-membership-evidence "test-results\/transaction-source\/evidence\/approval-membership-\$AUDIT_RUN_ID-\$\{\{ matrix.viewport \}\}\.json"/);
  assert(!steps[download]['continue-on-error'] && !steps[execute]['continue-on-error']);
  assert.match(steps.at(-1).with.path, /transaction-source\/evidence\/approval-membership-\*/);
});

test('real Supabase PATCH serializes exact text-array CAS; PostgreSQL preserves concurrent and escaped members', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const h = await fixture(t), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('create table groups (member_roles text[] not null)');
  const initial = ['warehouse_supervisor', 'comma,role', 'quote"role', 'slash\\role'];
  await pg.query('insert into groups values ($1::text[])', [initial]);
  let patches = 0;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, 'offline-only-public-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (url, options) => {
      const u = new URL(url);
      assert.equal(u.pathname, '/rest/v1/approval_groups');
      assert.equal(u.searchParams.get('entity_type'), 'eq.warehouse_stock_change');
      assert.equal(u.searchParams.get('group_code'), 'eq.logistics_supervisor');
      let rows;
      if (options.method === 'PATCH') {
        patches++;
        if (patches === 1) await pg.exec("update groups set member_roles = array_append(member_roles, 'concurrent')");
        rows = (await pg.query('update groups set member_roles=$1::text[] where member_roles=$2::text[] returning member_roles',
          [JSON.parse(options.body).member_roles, u.searchParams.get('member_roles').slice(3)])).rows;
      } else { assert.equal(options.method, 'GET'); rows = (await pg.query('select member_roles from groups')).rows; }
      rows = rows.map(row => ({ ...groupKey, ...row }));
      return new Response(JSON.stringify(options.method === 'GET' ? rows[0] : rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const result = await cleanup.changeTask3ApprovalMembership({ client, file: h.file, scope, mode: 'add' });
  assert.equal(patches, 2); assert.equal(result.remaining, 0);
  assert.deepEqual((await pg.query('select member_roles from groups')).rows[0].member_roles, [...initial, 'concurrent', ...h.evidence.roles]);
});
