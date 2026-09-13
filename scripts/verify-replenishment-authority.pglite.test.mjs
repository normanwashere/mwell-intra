import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const original = read('20260804201000_fix_replenishment_procurement_handoff');
const authority = read('20260813203240_task_1_database_authority_remediation');
const schema = read('20260804200000_operational_flow_completion');
const migration = read('20260913175711_align_replenishment_action_authority_and_snapshot');
const baseline = process.env.REPLENISHMENT_AUTHORITY_BASELINE === '1';
const actor = '11111111-1111-4111-8111-111111111111';
const signature = 'procurement.manage_replenishment_recommendation_uncertified_impl(jsonb)';
const outerSignature = 'procurement.manage_replenishment_recommendation(jsonb)';
const recCap = 'warehouse.recommend_replenishment';
const manageCap = 'procurement.manage_replenishment';
const payload = { action: 'recommend', product_id: 'merch', recommended_quantity: 5, on_hand: 2, reorder_point: 7,
  lead_time_days: 14, stockout_risk: 'medium', rationale: 'Minimum-stock planning assumption' };

function between(sql, start, end) {
  assert.equal(sql.split(start).length, 2, `unique source start: ${start}`);
  const tail = sql.slice(sql.indexOf(start));
  assert(tail.indexOf(end) > 0, `source end: ${end}`);
  return tail.slice(0, tail.indexOf(end));
}
const realTable = between(schema, 'create table if not exists procurement.replenishment_recommendations (', 'create table if not exists core.finance_close_entries');
const realWrapper = between(authority, 'create or replace function procurement.manage_replenishment_recommendation(payload jsonb)', 'create or replace function procurement.release_payment');
const realRename = authority.match(/^alter function procurement\.manage_replenishment_recommendation\(jsonb\)[^\n]+;/m)?.[0];
assert(realRename);
const implementationRevokes = authority.match(/revoke all on function ([^\n]+) from public, anon, authenticated;/)?.[1].split(', ');
assert(implementationRevokes?.includes(signature));
const outerAcl = [...authority.matchAll(/^(revoke all|grant execute) on function ([^\n]+?) (from|to) (public, anon|authenticated, service_role);$/gm)]
  .filter(match => match[2].split(', ').includes(outerSignature))
  .map(match => `${match[1]} on function ${outerSignature} ${match[3]} ${match[4]};`);
assert.equal(outerAcl.length, 2, 'actual Aug13 outer revoke and grant must both be projected');

async function fixture(t, { patched = !baseline } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  // Dependencies are minimal local tables and controllable capability evaluators;
  // the recommendation table, implementation, wrapper and rename are actual migration SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema warehouse; create schema procurement;
    grant usage on schema auth, core, warehouse, procurement to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function core.has_cap(m text, c text) returns boolean language sql stable as $$
      select coalesce(current_setting('test.raw', true)::jsonb ? (m || '.' || c), false) $$;
    create function core.has_live_cap(m text, c text) returns boolean language sql stable as $$
      select auth.uid() is not null and coalesce(current_setting('test.live', true)::jsonb ? (m || '.' || c), false) $$;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}');
    create table warehouse.products(id text primary key);
    insert into warehouse.products values('merch'), ('other');
    create table procurement.requests(id text primary key default gen_random_uuid()::text,
      title text, description text, requester_id uuid, department text, status text, category text,
      needed_by date, justification jsonb, compliance jsonb, lines jsonb);
    create table procurement.purchase_orders(id text primary key);
  `);
  await db.exec(read('20260706090500_core_activity_log'));
  await db.exec(realTable);
  await db.exec(original);
  await db.exec(realRename);
  await db.exec(realWrapper);
  await db.exec(outerAcl.join('\n'));
  await db.exec(`revoke all on function ${signature} from public, anon, authenticated;`);
  if (patched) await db.exec(migration);
  await grants(db, [], []);
  return db;
}
async function grants(db, live, raw = []) {
  await db.query("select set_config('test.actor',$1,false), set_config('test.live',$2,false), set_config('test.raw',$3,false)",
    [actor, JSON.stringify(live), JSON.stringify(raw)]);
}
async function invoke(db, value = payload, target = 'procurement.manage_replenishment_recommendation') {
  return (await db.query(`select ${target}($1::jsonb) as result`, [JSON.stringify(value)])).rows[0].result;
}
async function snapshot(db) {
  return (await db.query(`select
    (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from procurement.replenishment_recommendations r) as recommendations,
    (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from procurement.requests r) as requests,
    (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from core.activity_log r) as audit`)).rows[0];
}

test('actual Aug4 implementation under actual Aug13 wrapper reproduces the Operations-only failure', async t => {
  const db = await fixture(t, { patched: false });
  await grants(db, [recCap]);
  await assert.rejects(invoke(db), /Procurement authorization is required/);
  assert.deepEqual(await snapshot(db), { recommendations: [], requests: [], audit: [] });
});

test('Operations-only effective recommendation succeeds without any legacy procurement grant', async t => {
  const db = await fixture(t);
  await grants(db, [recCap]);
  await db.exec('set role authenticated');
  await assert.rejects(invoke(db, { ...payload, recommended_quantity: 0 }), /Quantity, stockout risk, and rationale are required/);
  const row = await invoke(db);
  assert.equal(row.status, 'recommended'); assert.equal(row.recommended_quantity, 5);
  await db.exec('reset role');
  const state = await snapshot(db);
  assert.equal(state.requests.length, 0);
  assert.equal(state.audit.length, 1); assert.equal(state.audit[0].actor, actor);
});

test('raw-only, wrong-module and management-only authority cannot recommend at either boundary', async t => {
  const db = await fixture(t);
  for (const live of [[], ['procurement.recommend_replenishment'], [manageCap]]) {
    await grants(db, live, ['warehouse.view_procurement', 'procurement.manage_rfp', 'procurement.author_po', recCap]);
    for (const target of ['procurement.manage_replenishment_recommendation', signature.replace('(jsonb)', '')]) {
      const before = await snapshot(db);
      await assert.rejects(invoke(db, payload, target), /Not authorized: warehouse.recommend_replenishment/);
      assert.deepEqual(await snapshot(db), before);
    }
  }
});

test('absent actor and revoked effective authority cannot change a previously recommended snapshot', async t => {
  const db = await fixture(t);
  await grants(db, [recCap, manageCap]);
  const row = await invoke(db);
  const before = await snapshot(db);
  for (const absentActor of [true, false]) {
    await grants(db, absentActor ? [recCap, manageCap] : [], [recCap, manageCap, 'warehouse.view_procurement']);
    if (absentActor) await db.query("select set_config('test.actor','',false)");
    for (const value of [payload, { id: row.id, action: 'accept' }]) {
      await db.exec('set role authenticated');
      await assert.rejects(invoke(db, value), /Not authorized:/);
      await db.exec('reset role');
      assert.deepEqual(await snapshot(db), before);
    }
  }
});

test('management actions require their own effective capability and preserve the handoff payload', async t => {
  const db = await fixture(t);
  await grants(db, [recCap], ['warehouse.view_procurement']);
  const row = await invoke(db);
  for (const action of ['accept', 'handoff', 'dismiss']) {
    await assert.rejects(invoke(db, { id: row.id, action }), /Not authorized: procurement.manage_replenishment/);
  }
  await grants(db, [manageCap]);
  assert.equal((await invoke(db, { id: row.id, action: 'accept' })).status, 'accepted');
  const result = await invoke(db, { id: row.id, action: 'handoff' });
  assert.equal(result.status, 'handed_off'); assert(result.procurement_request_id);
  const state = await snapshot(db), request = state.requests[0];
  assert.equal(request.status, 'draft'); assert.equal(request.department, 'operations');
  assert.equal(request.requester_id, actor);
  assert.deepEqual(request.lines, [{ description: 'merch', quantity: 5, uom: 'unit' }]);
  assert.deepEqual(request.justification, { businessNeed: payload.rationale, replenishmentRecommendationId: row.id });
  assert.deepEqual(request.compliance, { source: 'warehouse_replenishment', vendorAccreditationRequired: true });
  assert.deepEqual(state.audit.map(r => r.action), ['recommend', 'accept', 'handoff']);
  const before = await snapshot(db);
  await assert.rejects(invoke(db, { id: row.id, action: 'handoff' }), /Accept the recommendation before handoff/);
  assert.deepEqual(await snapshot(db), before);
});

for (const status of ['accepted', 'handed_off']) test(`${status} snapshot wins over a stale recommendation without changing row, request or audit`, async t => {
  const db = await fixture(t);
  await grants(db, [recCap, manageCap], ['warehouse.view_procurement']);
  const row = await invoke(db); // The client saw an open recommendation here.
  await invoke(db, { id: row.id, action: 'accept' });
  if (status === 'handed_off') await invoke(db, { id: row.id, action: 'handoff' });
  const before = await snapshot(db);
  await assert.rejects(invoke(db, { ...payload, recommended_quantity: 99, on_hand: 0, lead_time_days: 90, rationale: 'Stale overwrite' }), /already accepted or handed off/i);
  assert.deepEqual(await snapshot(db), before);
});

test('open recommendation conflict edits/repeats one row; a later decision preserves that final snapshot', async t => {
  const db = await fixture(t);
  await grants(db, [recCap, manageCap], ['warehouse.view_procurement']);
  const first = await invoke(db);
  const revised = { ...payload, recommended_quantity: 8, rationale: 'Revised open planning' };
  assert.equal((await invoke(db, revised)).id, first.id);
  assert.equal((await invoke(db, revised)).id, first.id);
  assert.equal((await snapshot(db)).recommendations.length, 1);
  assert.equal((await snapshot(db)).audit.length, 3, 'existing per-call audit semantics are preserved, not new replay idempotency');
  await invoke(db, { id: first.id, action: 'accept' });
  const result = await invoke(db, { id: first.id, action: 'handoff' });
  assert.equal(result.recommended_quantity, 8);
  assert.equal((await snapshot(db)).requests[0].lines[0].quantity, 8);
});

test('atomic conflict predicate rejects a decided snapshot before any UPDATE trigger can run', async t => {
  const db = await fixture(t);
  await grants(db, [recCap, manageCap], ['warehouse.view_procurement']);
  const row = await invoke(db);
  await invoke(db, { id: row.id, action: 'accept' });
  // Fault injection around the real unique-index conflict, not a substitute
  // for a two-session lock-wait test (PGlite has a single backend).
  await db.exec(`create function procurement.test_forbid_update() returns trigger language plpgsql as $$
    begin raise exception 'Approved snapshot UPDATE attempted'; end $$;
    create trigger test_forbid_update before update on procurement.replenishment_recommendations for each row execute function procurement.test_forbid_update();`);
  const before = await snapshot(db);
  await assert.rejects(invoke(db, { ...payload, recommended_quantity: 99 }), /already accepted or handed off/i);
  assert.deepEqual(await snapshot(db), before);
  assert.equal(before.recommendations[0].id, row.id);
});

test('validation, dismissal, reopening and unsupported transitions remain governed', async t => {
  const db = await fixture(t);
  await grants(db, [recCap, manageCap], ['warehouse.view_procurement']);
  for (const bad of [{ recommended_quantity: 0 }, { rationale: ' ' }, { stockout_risk: 'invented' }, { product_id: 'foreign-missing' }]) {
    await assert.rejects(invoke(db, { ...payload, ...bad }));
    assert.deepEqual(await snapshot(db), { recommendations: [], requests: [], audit: [] });
  }
  const first = await invoke(db);
  await assert.rejects(invoke(db, { id: first.id, action: 'invented' }), /Unsupported replenishment action/);
  assert.equal((await invoke(db, { id: first.id, action: 'dismiss' })).status, 'dismissed');
  const reopened = await invoke(db);
  assert.notEqual(reopened.id, first.id);
  assert.equal((await snapshot(db)).recommendations.length, 2);
});

test('outer body, signatures and implementation privileges remain unchanged; raw guard is removed only inside', async t => {
  const db = await fixture(t, { patched: false });
  const definition = async name => (await db.query('select pg_get_functiondef($1::regprocedure) as value', [name])).rows[0].value;
  const outer = await definition('procurement.manage_replenishment_recommendation(jsonb)');
  const acl = async () => (await db.query('select proacl::text as value from pg_proc where oid=$1::regprocedure', [outerSignature])).rows[0].value;
  const outerPrivileges = await acl();
  const inner = await definition(signature);
  await db.exec(migration);
  assert.equal(await definition('procurement.manage_replenishment_recommendation(jsonb)'), outer);
  assert.equal(await acl(), outerPrivileges);
  assert.equal((await db.query("select exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as allowed", [outerSignature])).rows[0].allowed, false, 'PUBLIC has no wrapper EXECUTE');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, outerSignature])).rows[0].allowed, role !== 'anon');
  }
  await grants(db, [recCap]);
  await db.exec('set role anon');
  await assert.rejects(invoke(db), /permission denied/);
  await db.exec('reset role');
  const revised = await definition(signature);
  const replacement = label => migration.match(new RegExp(`\\$${label}\\$([\\s\\S]*?)\\$${label}\\$`))?.[1];
  for (const label of ['old_guard', 'new_guard', 'old_conflict', 'new_conflict']) assert(replacement(label));
  assert.equal(revised, inner.replace(replacement('old_guard'), replacement('new_guard'))
    .replace(replacement('old_conflict'), replacement('new_conflict')), 'all unrelated implementation bytes stay unchanged');
  assert(!revised.includes("core.has_cap('warehouse','view_procurement')"));
  assert(revised.includes("core.has_live_cap('warehouse', 'recommend_replenishment')"));
  assert(revised.includes("core.has_live_cap('procurement', 'manage_replenishment')"));
  assert(inner.includes('on conflict(product_id)'));
  for (const role of ['anon', 'authenticated']) {
    const rights = (await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, signature])).rows[0];
    assert.equal(rights.allowed, false);
    await db.exec(`set role ${role}`);
    await assert.rejects(invoke(db, payload, signature.replace('(jsonb)', '')), /permission denied/);
    await db.exec('reset role');
  }
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [signature])).rows[0].allowed, true);
});

test('unknown implementation drift refuses the migration and leaves its definition unchanged', async t => {
  const db = await fixture(t, { patched: false });
  const definition = async () => (await db.query('select pg_get_functiondef($1::regprocedure) as value', [signature])).rows[0].value;
  const drifted = (await definition()).replace('Procurement authorization is required', 'Unreviewed authority change');
  await db.exec(drifted);
  await assert.rejects(db.exec(migration), /Unexpected replenishment implementation/);
  await db.exec('rollback');
  assert.equal(await definition(), drifted);
});
