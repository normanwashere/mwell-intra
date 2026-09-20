import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { functionDefinition } from './quality-inspection-verifier-fixture.mjs';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20260920025455_atomic_quality_batch.sql');
const commands = read('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
const actor = '22222222-2222-4222-8222-222222222222';
const item = { source_type: 'receipt', source_id: 'receipt', product_id: 'device', procurement_po_line_id: 'line',
  bin_id: 'bin', lot_id: null, quantity: 1, serial_number: 'S1' };
const input = { idempotency_key: 'batch-quality-0001', disposition: 'accepted', evidence_urls: ['stored/evidence.jpg'],
  items: [item, { ...item, serial_number: 'S2' }] };

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema private; create schema warehouse; create schema auth; create schema core; create schema storage;
    create table storage.objects(bucket_id text,name text,owner_id text,owner uuid, unique(bucket_id,name));
    insert into storage.objects values('evidence','stored/evidence.jpg','${actor}',null),
      ('evidence','stored/foreign.jpg','11111111-1111-4111-8111-111111111111',null),
      ('public','stored/elsewhere.jpg','${actor}',null),
      ('evidence','stored/mismatched.jpg','${actor}','11111111-1111-4111-8111-111111111111');
    create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$ select coalesce(current_setting('test.allowed',true),'yes') = 'yes' $$;
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid, command_name text,
      idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select md5($1::text) $$;
    create table warehouse.calls(payload jsonb);
    -- Dispatcher seam only: the existing single-item production chain has its own regression suite.
    create function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql as $$ begin
      if payload->>'serial_number' = 'STALE' then raise exception 'Stock changed'; end if;
      insert into warehouse.calls values(payload);
      return jsonb_build_object('inspection',payload); end $$;`);
  await db.exec(functionDefinition(commands, 'private.begin_idempotent_command'));
  await db.exec(functionDefinition(commands, 'private.finish_idempotent_command'));
  await db.exec(migration);
  return db;
}
const run = (db, payload) => db.query('select warehouse.inspect_quality_batch($1::jsonb) result', [JSON.stringify(payload)]);
test('batch dispatcher is atomic, preserves item identities and replays exact result', async () => {
  const db = await database();
  try {
    await assert.rejects(run(db, { ...input, items: [item, { ...item, serial_number: 'STALE' }] }), /Stock changed/);
    assert.equal((await db.query('select count(*)::int n from warehouse.calls')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from warehouse.command_log')).rows[0].n, 0);
    const result = await run(db, input);
    assert.deepEqual(await run(db, input), result);
    assert.equal((await db.query('select count(*)::int n from warehouse.calls')).rows[0].n, 2);
    assert.equal(result.rows[0].result.inspections[0].procurement_po_line_id, 'line');
    assert.equal(result.rows[0].result.inspections[1].idempotency_key, 'qb-batch-quality-0001-1');
    await assert.rejects(run(db, { ...input, disposition: 'hold', reason: 'changed' }), /different payload/);
    await db.exec("select set_config('test.allowed','no',false)");
    await assert.rejects(run(db, input), /permission/);
  } finally { await db.close(); }
});
test('batch rejects malformed, mixed, duplicate or un-evidenced inputs before dispatch', async () => {
  const db = await database();
  try {
    for (const bad of [null, {}, [], Array(51).fill(item), [item,item], [item,{ ...item,serial_number:' s1 ' }],
      [item,{...item,source_id:'other'}], [item,{...item,procurement_po_line_id:'other'}],
      [item,{...item,bin_id:'other'}], [item,{...item,lot_id:'other'}], [{...item,quantity:2}], [{...item,quantity:0}]]) {
      await assert.rejects(run(db, {...input,items:bad}));
    }
    for (const change of [{evidence_urls:[]},{evidence_urls:[null]},{evidence_urls:[' ']},
      {disposition:'pending'},{disposition:'hold',reason:' '},{idempotency_key:'bad'}]) {
      await assert.rejects(run(db, {...input,...change}));
    }
    assert.equal((await db.query('select count(*)::int n from warehouse.calls')).rows[0].n, 0);
    const privileges = await db.query(`select has_function_privilege('anon','warehouse.inspect_quality_batch(jsonb)','execute') anon,
      has_function_privilege('authenticated','warehouse.inspect_quality_batch(jsonb)','execute') authenticated`);
    assert.deepEqual(privileges.rows[0], {anon:false, authenticated:true});
  } finally { await db.close(); }
});

test('batch requires real private evidence owned by this inspector, not mere path visibility', async () => {
  const db = await database();
  try {
    for (const evidence of ['stored/missing.jpg','stored/foreign.jpg','stored/elsewhere.jpg','stored/mismatched.jpg',
      'https://example.com/photo.jpg','data:image/png;base64,AAAA','../stored/evidence.jpg','/stored/evidence.jpg']) {
      await assert.rejects(run(db,{...input,evidence_urls:[evidence]}), /Upload the inspection photos/);
    }
    assert.equal((await db.query('select count(*)::int n from warehouse.calls')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from warehouse.command_log')).rows[0].n,0);
    const result = await run(db,{...input,evidence_urls:['evidence/stored/evidence.jpg']});
    assert.equal(result.rows[0].result.inspections.length,2);
    // A confirmed command can still be retrieved after separately governed object cleanup.
    await db.exec('delete from storage.objects');
    assert.deepEqual(await run(db,{...input,evidence_urls:['evidence/stored/evidence.jpg']}),result);
  } finally { await db.close(); }
});
