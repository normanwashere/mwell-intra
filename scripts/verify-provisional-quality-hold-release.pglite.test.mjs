import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { functionDefinition } from './quality-inspection-verifier-fixture.mjs';

const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const oldSql = migration('20260815154910_operations_launch_blocker_slice.sql');
const custodySql = migration('20260826032845_converge_receipt_quality_custody.sql');
const fix = migration('20260905180530_authorize_accepted_provisional_quality_hold_release.sql');
const receiver = '11111111-1111-4111-8111-111111111111';
const inspector = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const pending = 'Awaiting independent quality inspection';
const accepted = 'Accepted by independent quality inspection';
const denied = /Pending independent inspection holds cannot be released directly/;

async function database() {
  const db = new PGlite();
  // Minimal surrounding schema; the RPC and both production trigger bodies are real.
  // Nullable identities deliberately exercise malformed legacy evidence as well.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema warehouse; create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$ select true $$;
    create table core.profiles(id uuid primary key,email text);
    insert into core.profiles values ('${receiver}','receiver@test'),('${inspector}','inspector@test');
    create table warehouse.receipts(id text primary key, procurement_po_id text,
      location_id text, received_by uuid, actor text, quality_status text);
    create table warehouse.quality_inspections(id uuid primary key default gen_random_uuid(),
      source_type text,source_id text,product_id text,procurement_po_line_id text,
      location_id text,bin_id text,lot_id text,serial_number text,quantity integer,
      disposition text,reason text,evidence_urls jsonb default '[]',inspected_by uuid,
      inspected_by_email text,inspected_at timestamptz default now());
    create table warehouse.inventory_holds(id uuid primary key default gen_random_uuid(),
      inspection_id uuid,product_id text,location_id text,bin_id text,lot_id text,
      serial_number text,quantity integer,status text,reason text,created_by uuid,
      evidence_urls jsonb default '[]',released_by uuid,released_at timestamptz,
      release_reason text,release_evidence_urls jsonb);
    create table warehouse.exceptions(id uuid default gen_random_uuid(),exception_type text,
      severity text,source_type text,source_id text,status text,resolution text,
      evidence_urls jsonb,created_by uuid);
    create table core.activity_log(module text,entity_type text,entity_id uuid,
      action text,actor uuid,detail jsonb);
    create function private.begin_idempotent_command(text,text,jsonb) returns jsonb
      language sql as $$ select jsonb_build_object('replayed',false,'command_id',gen_random_uuid()) $$;
    create function private.finish_idempotent_command(uuid,jsonb) returns jsonb
      language sql as $$ select $2 $$;
  `);
  await db.exec(functionDefinition(oldSql, 'private.enforce_independent_receipt_inspection'));
  const start = oldSql.indexOf('drop trigger if exists warehouse_independent_receipt_inspection');
  // Use the deployed trigger DDL, including UPDATE OF disposition.
  assert.ok(start >= 0);
  await db.exec(oldSql.slice(start, oldSql.indexOf('create or replace function private.remove_provisional_quality_hold', start)));
  await db.exec(functionDefinition(oldSql, 'private.protect_provisional_quality_hold'));
  const holdStart = oldSql.indexOf('drop trigger if exists warehouse_protect_provisional_quality_hold');
  const holdEnd = oldSql.indexOf('for each row execute function private.protect_provisional_quality_hold();', holdStart)
    + 'for each row execute function private.protect_provisional_quality_hold();'.length;
  await db.exec(oldSql.slice(holdStart, holdEnd));
  await db.exec(functionDefinition(custodySql, 'private.warehouse_inspect_quality_v3'));
  await db.exec(functionDefinition(custodySql, 'warehouse.inspect_quality'));
  return db;
}

async function seed(db) {
  await db.exec(`truncate warehouse.inventory_holds,warehouse.quality_inspections,
    warehouse.receipts,warehouse.exceptions,core.activity_log;
    select set_config('request.jwt.claim.sub','${inspector}',false);
    insert into warehouse.receipts values ('receipt','po','location','${receiver}','receiver@test','pending');
    insert into warehouse.quality_inspections(source_type,source_id,product_id,procurement_po_line_id,
      location_id,quantity,disposition,reason,inspected_by,inspected_by_email)
      values ('receipt','receipt','product','line','location',2,'pending','${pending}','${receiver}','receiver@test');
    insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,status,reason,created_by)
      select id,product_id,location_id,quantity,'active','${pending}','${receiver}' from warehouse.quality_inspections;`);
}

const inspect = (db, disposition = 'accepted') => db.query('select warehouse.inspect_quality($1::jsonb) result', [JSON.stringify({
  source_type: 'receipt', source_id: 'receipt', product_id: 'product',
  procurement_po_line_id: 'line', quantity: 2, disposition, reason: 'Damaged packaging',
  evidence_urls: ['https://example.test/inspection'], idempotency_key: 'test',
})]);
const acceptEvidence = db => db.exec(`update warehouse.quality_inspections set disposition='accepted',
  reason='${accepted}',inspected_by='${inspector}',inspected_at='2026-09-05T00:00:00Z';`);
const release = (db, extra = '') => db.exec(`update warehouse.inventory_holds set status='released',
  released_by='${inspector}',released_at='2026-09-05T00:00:00Z',release_reason='${accepted}',
  release_evidence_urls='[]' ${extra};`);
const snapshot = async db => (await db.query(`select
  (select jsonb_agg(t) from warehouse.quality_inspections t) inspections,
  (select jsonb_agg(t) from warehouse.inventory_holds t) holds,
  (select jsonb_agg(t) from warehouse.receipts t) receipts,
  (select count(*) from core.activity_log) activity`)).rows;

test('actual old trigger rejects v3 acceptance atomically; forward migration makes it succeed', async () => {
  const db = await database();
  try {
    await seed(db);
    const before = await snapshot(db);
    await assert.rejects(inspect(db), denied);
    assert.deepEqual(await snapshot(db), before, 'old-trigger failure rolls back acceptance');
    await db.exec(fix);
    const { rows: [{ result }] } = await inspect(db);
    assert.equal(result.inspection.disposition, 'accepted');
    assert.equal(result.inspection.inspected_by, inspector);
    assert.equal(result.hold.status, 'released');
    assert.equal(result.hold.released_by, inspector);
    assert.equal(result.hold.released_at, result.inspection.inspected_at);
    assert.deepEqual(result.hold.release_evidence_urls, result.inspection.evidence_urls);
    assert.equal((await db.query('select quality_status from warehouse.receipts')).rows[0].quality_status, 'accepted');
    assert.equal((await db.query('select count(*)::int n from core.activity_log')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('evidence authorization rejects malformed custody and release attempts', async t => {
  const db = await database();
  try {
    await db.exec(fix);
    const cases = [
      ['pending direct release', '', '', false],
      ['missing session identity', "select set_config('request.jwt.claim.sub','',false)"],
      ['wrong session actor', `select set_config('request.jwt.claim.sub','${other}',false)`],
      ['missing receiver', 'update warehouse.receipts set received_by=null'],
      ['self inspection', `update warehouse.receipts set received_by='${inspector}'`],
      ['missing inspector', 'update warehouse.quality_inspections set inspected_by=null'],
      ['wrong inspector', `update warehouse.quality_inspections set inspected_by='${other}'`],
      ['missing creator', 'update warehouse.inventory_holds set created_by=null'],
      ['self release', `update warehouse.inventory_holds set created_by='${inspector}'`],
      ['missing receipt', 'delete from warehouse.receipts'],
      ['wrong receipt link', "update warehouse.quality_inspections set source_id='another'"],
      ['wrong source type', "update warehouse.quality_inspections set source_type='return'"],
      ['missing PO', 'update warehouse.receipts set procurement_po_id=null'],
      ['missing PO line', 'update warehouse.quality_inspections set procurement_po_line_id=null'],
      ['wrong receipt location', "update warehouse.receipts set location_id='other'"],
      ['wrong product', "update warehouse.quality_inspections set product_id='other'"],
      ['wrong location', "update warehouse.quality_inspections set location_id='other'"],
      ['wrong bin', "update warehouse.quality_inspections set bin_id='other'"],
      ['wrong lot', "update warehouse.quality_inspections set lot_id='other'"],
      ['wrong serial', "update warehouse.quality_inspections set serial_number='other'"],
      ['wrong quantity', 'update warehouse.quality_inspections set quantity=1'],
      ['missing inspection', 'delete from warehouse.quality_inspections'],
      ['nonaccepted disposition', "update warehouse.quality_inspections set disposition='damaged'"],
      ['missing acceptance reason', 'update warehouse.quality_inspections set reason=null'],
      ['missing inspection timestamp', 'update warehouse.quality_inspections set inspected_at=null'],
      ['missing evidence', 'update warehouse.quality_inspections set evidence_urls=null'],
      ['mismatched evidence', `update warehouse.quality_inspections set evidence_urls='["different"]'`],
      ['relinked hold', '', ', inspection_id=gen_random_uuid()'],
      ['mutated custody', '', ', quantity=1'],
    ];
    for (const [name, mutation, extra = '', acceptedEvidence = true] of cases) {
      await t.test(name, async () => {
        await seed(db);
        if (acceptedEvidence) await acceptEvidence(db);
        if (mutation) await db.exec(mutation);
        const before = await snapshot(db);
        await assert.rejects(release(db, extra), denied);
        assert.deepEqual(await snapshot(db), before);
      });
    }
    for (const [name, assignment] of [
      ['null status', 'status=null'], ['wrong state', "status='cancelled'"],
      ['missing release actor', 'released_by=null'], ['wrong release actor', `released_by='${other}'`],
      ['missing timestamp', 'released_at=null'], ['wrong timestamp', "released_at='2026-09-04'"],
      ['missing reason', 'release_reason=null'], ['wrong reason', "release_reason='manual'"],
      ['missing release evidence', 'release_evidence_urls=null'],
    ]) {
      await t.test(name, async () => {
        await seed(db);
        await acceptEvidence(db);
        // Stage release metadata while the hold is active; then vary one field.
        await db.exec(`update warehouse.inventory_holds set released_by='${inspector}',
          released_at='2026-09-05',release_reason='${accepted}',release_evidence_urls='[]';`);
        const before = await snapshot(db);
        const set = assignment.startsWith('status=') ? assignment : `status='released',${assignment}`;
        await assert.rejects(db.exec(`update warehouse.inventory_holds set ${set}`), denied);
        assert.deepEqual(await snapshot(db), before);
      });
    }
  } finally { await db.close(); }
});

test('nonaccepted inspection retains hold; self/missing-identity RPCs remain atomic', async () => {
  const db = await database();
  try {
    await db.exec(fix);
    await seed(db);
    const { rows: [{ result }] } = await inspect(db, 'damaged');
    assert.equal(result.hold.status, 'active');
    assert.equal(result.inspection.disposition, 'damaged');
    for (const actor of [receiver, '']) {
      await seed(db);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
      const before = await snapshot(db);
      await assert.rejects(inspect(db), /cannot inspect the same receipt|Pending independent inspection/);
      assert.deepEqual(await snapshot(db), before);
    }
    await seed(db);
    await db.exec("update warehouse.inventory_holds set reason='Ordinary quality hold'");
    await release(db);
    assert.equal((await db.query('select status from warehouse.inventory_holds')).rows[0].status, 'released');
  } finally { await db.close(); }
});
