import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const releaser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const order = '11111111-1111-4111-8111-111111111111';
const wrongOrder = '22222222-2222-4222-8222-222222222222';
const file = '33333333-3333-4333-8333-333333333333';
const objectPath = `acknowledgment-${order}/0/${file}.png`;
const migrationName = '20260913022735_warehouse_recipient_ack_evidence_upload.sql';
const sql = {};
for (const [key, name] of Object.entries({
  controls: '20260710150000_warehouse_w1_control_schema.sql',
  commands: '20260710160000_warehouse_w1_quality_and_approval_rpcs.sql',
  original: '20260721200000_cross_department_wms_persistence.sql',
  policies: '20260721210000_cross_department_wms_advisor_remediation.sql',
  lifecycle: '20260804150000_inventory_release_lifecycle_remediation.sql',
  capabilities: '20260816090000_security_database_launch_blocker_convergence.sql',
  v3: '20260817121220_ecommerce_fulfillment_intake_and_directed_pick.sql',
  v2: '20260828011200_fulfillment_zero_line_backorder.sql',
  evidence: '20260908042408_warehouse_registered_evidence_access.sql',
  ackGuard: '20260910140118_fulfillment_handover_acknowledgment_guard.sql',
  migration: migrationName,
})) sql[key] = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing SQL: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}
const functionSql = (source, name) => extract(source, `create or replace function ${name}(`, '$$;');
const rows = async (query, params = []) => (await db.query(query, params)).rows;
let db;
let preservedBefore;
let preservedAfter;
async function preservedDefinitions() {
  return {
    policies: await rows(`select * from pg_policies where schemaname in ('storage','warehouse','core')
      and policyname <> 'evidence_recipient_ack_insert' order by schemaname,tablename,policyname`),
    functions: await rows(`select p.oid,p.proname,p.prosrc,p.proacl,p.proowner,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('private','warehouse','core')
        and p.proname <> 'can_upload_warehouse_ack_evidence' order by p.oid`),
    buckets: await rows('select * from storage.buckets order by id'),
  };
}

before(async () => {
  db = new PGlite();
  // Reuse the installed fulfillment fixture and evidence-access fixture shape.
  // Only ancillary catalogs, auth identity and pgcrypto's hash primitive are scaffolded.
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$
      select current_setting('test.auth_role',true) $$;
    create table core.profiles(id uuid primary key,kind text,status text);
    create table core.roles(module text,role text,is_active boolean);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
    create table core.role_capabilities(module text,role text,cap text);
    alter table core.profiles enable row level security;
    create policy self_read on core.profiles for select to authenticated using(id=auth.uid());
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into storage.buckets values('evidence',false,null,null),('other',false,null,null);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text not null,
      owner uuid,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create table warehouse.locations(id text primary key);
    create table warehouse.events(id text primary key);
    create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
    create table warehouse.products(id text primary key,name text,serialized boolean,item_class text);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer);
    create table warehouse.inventory_units(id text,product_id text,serial_number text,status text,location_id text,bin_id text,assigned_to text);
    create table warehouse.fulfillment_reservations(order_id uuid,product_id text,status text,closed_at timestamptz);
    create table warehouse.department_stock_requests(fulfillment_order_id uuid,requested_by uuid);
    create table core.activity_log(module text,entity_type text,entity_id uuid,action text,actor uuid,detail jsonb);
    create table warehouse.receipts(id text,evidence_urls jsonb);
    create table warehouse.returns(id text,evidence_urls jsonb);
    create table warehouse.movements(id text,type text,product_id text,quantity integer,from_location_id text,
      from_bin_id text,serial_number text,lot_id text,event_id text,reference text,actor text,reason text,evidence_urls jsonb);
    create table warehouse.quality_inspections(id text,evidence_urls jsonb);
    create table warehouse.inventory_holds(product_id text,location_id text,bin_id text,lot_id text,
      serial_number text,status text,quantity integer,evidence_urls jsonb,release_evidence_urls jsonb);
    create table warehouse.vendor_returns(id text,evidence_urls jsonb);
    create table warehouse.stock_change_requests(id text,evidence_urls jsonb,requested_by uuid);
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$
      select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
  `);
  await db.exec(functionSql(sql.capabilities, 'core.has_cap'));
  await db.exec(extract(sql.controls, 'create table if not exists warehouse.command_log (', '\n);'));
  await db.exec(extract(sql.original, 'create table if not exists warehouse.fulfillment_orders (', '\n);'));
  await db.exec(sql.lifecycle.slice(sql.lifecycle.indexOf('alter table warehouse.fulfillment_orders'),
    sql.lifecycle.indexOf('drop index if exists warehouse.warehouse_fulfillment_work_queue_idx')));
  await db.exec(`alter table warehouse.fulfillment_orders
    add column delivery_link text, add column proof_of_delivery_evidence_url text;`);
  for (const name of ['begin_idempotent_command', 'finish_idempotent_command']) {
    await db.exec(functionSql(sql.commands, `private.${name}`));
  }
  await db.exec(await readFile(new URL('./fixtures/sep08-installed-fulfillment.sql', import.meta.url), 'utf8'));
  await db.exec(sql.v2);
  await db.exec(sql.v3.slice(sql.v3.indexOf('create or replace function private.warehouse_advance_fulfillment_order_v3(')));
  await db.exec(sql.ackGuard);
  await db.exec(`revoke all on function private.warehouse_advance_fulfillment_order(jsonb) from public,anon,authenticated;
    grant execute on function private.warehouse_advance_fulfillment_order(jsonb) to service_role;
    grant usage on schema auth,core,private,warehouse,storage to authenticated,anon,service_role;
    grant select on all tables in schema core,warehouse to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;`);
  for (const table of ['fulfillment_orders', 'department_stock_requests']) {
    await db.exec(`alter table warehouse.${table} enable row level security;`);
    await db.exec(extract(sql.policies, `create policy ${table}_read `, '\n);'));
  }
  for (const table of ['receipts', 'returns', 'movements', 'quality_inspections', 'inventory_holds', 'vendor_returns', 'stock_change_requests']) {
    // Deliberately visible source rows: the real evidence helper must still gate by capability.
    await db.exec(`alter table warehouse.${table} enable row level security;
      create policy fixture_read on warehouse.${table} for select to authenticated using(true);`);
  }
  await db.exec(sql.evidence);
  preservedBefore = await preservedDefinitions();
  if (!process.env.RECIPIENT_ACK_EVIDENCE_BASELINE) await db.exec(sql.migration);
  preservedAfter = await preservedDefinitions();
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;
    truncate storage.objects,warehouse.command_log,core.activity_log,warehouse.fulfillment_orders,
      warehouse.department_stock_requests,core.profiles,core.roles,core.user_roles,core.role_capabilities,
      warehouse.receipts,warehouse.returns,warehouse.movements,warehouse.quality_inspections,
      warehouse.inventory_holds,warehouse.vendor_returns,warehouse.stock_change_requests cascade;
    insert into core.profiles values('${actor}','employee','active'),('${other}','employee','active'),('${releaser}','employee','active');
    insert into warehouse.fulfillment_orders(id,source,external_reference,status,delivery_method,lines,created_by,released_by,released_at,
      courier,waybill_number,handover_recipient_name,handover_recipient_department,handover_reference,handover_evidence_url)
      values('${order}','department_request','ACK-UPLOAD','released','internal_handover','[{"productId":"product","quantity":1}]','${other}','${releaser}',now(),
        'Courier','WAYBILL','Recipient','Marketing','HANDOVER','handover/photo.png'),
        ('${wrongOrder}','department_request','OTHER-ORDER','released','internal_handover','[{"productId":"product","quantity":1}]','${other}','${releaser}',now(),
        'Courier','WAYBILL','Recipient','Business Unit','HANDOVER','handover/other.png');
    insert into warehouse.department_stock_requests values('${order}','${actor}'),('${wrongOrder}','${other}');
  `);
  await setCaps(actor, ['request_stock']);
  await setCaps(releaser, ['issue_items']);
});

async function setCaps(id, caps) {
  await db.exec('reset role');
  await db.query('delete from core.user_roles where user_id=$1', [id]);
  await db.query('delete from core.roles where role=$1', [id]);
  await db.query('delete from core.role_capabilities where role=$1', [id]);
  await db.query("insert into core.roles values('warehouse',$1,true)", [id]);
  await db.query("insert into core.user_roles values($1,'warehouse',$2,now()-interval '1 day',null)", [id,id]);
  for (const cap of caps) await db.query("insert into core.role_capabilities values('warehouse',$1,$2)", [id,cap]);
}
async function asActor(id = actor, role = 'authenticated') {
  assert.ok(['authenticated','anon'].includes(role));
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false),set_config('test.auth_role',$2,false)", [id,role]);
  await db.exec(`set role ${role}`);
}
async function upload(path = objectPath, ownerId = actor, legacyOwner = null, bucket = 'evidence') {
  return db.query('insert into storage.objects(bucket_id,name,owner_id,owner) values($1,$2,$3,$4)',
    [bucket,path,ownerId,legacyOwner]);
}
const canUpload = async (path = objectPath) => (await rows('select private.can_upload_warehouse_ack_evidence($1) as allowed', [path]))[0].allowed;
const visible = async () => (await rows('select name from storage.objects order by name')).map(r => r.name);
const registered = async (path = objectPath) => (await rows('select private.can_read_registered_warehouse_evidence($1) as allowed', [path]))[0].allowed;
async function acknowledge() {
  return (await rows('select warehouse.advance_fulfillment_order($1::jsonb) as result', [JSON.stringify({
    order_id: order, action: 'acknowledge_receipt', idempotency_key: 'recipient-ack-upload-test',
    acknowledgement_reference: 'ACK-UPLOAD', acknowledgement_evidence_url: objectPath,
  })]))[0].result;
}

test('linked request_stock recipient uploads exact EvidenceCapture path and previews before acknowledgment', async () => {
  await asActor();
  await upload();
  assert.equal(await canUpload(), true);
  assert.deepEqual(await visible(), [objectPath]);
  assert.equal(await registered(), false);
});

for (const authority of ['linked requester without capabilities', 'creator', 'request_fulfillment', 'issue_items']) {
  test(`matches installed ack authority: ${authority}`, async () => {
    await setCaps(actor, authority.includes('_') ? [authority] : []);
    if (authority !== 'linked requester without capabilities') {
      await db.exec('delete from warehouse.department_stock_requests');
    }
    if (authority === 'creator') await db.query('update warehouse.fulfillment_orders set created_by=$1 where id=$2', [actor,order]);
    await asActor();
    assert.equal(await canUpload(), true);
    await upload();
    const result = await acknowledge();
    assert.equal(result.status, 'completed');
    assert.equal(result.acknowledged_by, actor);
    assert.equal(result.acknowledgement_evidence_url, objectPath);
    assert.deepEqual(await visible(), [objectPath]);
  });
}

for (const method of ['internal_handover','event_handover','third_party_transfer']) {
  test(`preserves actual nonshipment scope: ${method}`, async () => {
    await db.query('update warehouse.fulfillment_orders set delivery_method=$1 where id=$2', [method,order]);
    await asActor();
    await upload();
    assert.equal((await acknowledge()).status, 'completed');
  });
}

for (const [label, prepare, path] of [
  ['wrong existing order', '', objectPath.replace(order,wrongOrder)],
  ['nonexistent order', '', objectPath.replace(order,file)],
  ['other requester', `update warehouse.department_stock_requests set requested_by='${other}'`],
  ['shipment', `update warehouse.fulfillment_orders set delivery_method='shipment'`],
  ['unreleased', `update warehouse.fulfillment_orders set status='ready'`],
  ['completed', `update warehouse.fulfillment_orders set status='completed'`],
  ['releasing requester', `update warehouse.fulfillment_orders set released_by='${actor}'`],
  ['inactive profile', `update core.profiles set status='inactive' where id='${actor}'`],
  ['vendor profile', `update core.profiles set kind='vendor' where id='${actor}'`],
  ['missing profile', `delete from warehouse.department_stock_requests; delete from core.profiles where id='${actor}'`],
]) {
  test(`denies ${label}`, async () => {
    if (prepare) await db.exec(prepare);
    await asActor();
    assert.equal(await canUpload(path), false);
    await assert.rejects(upload(path), /row-level security/);
  });
}

for (const cap of ['request_stock','reserve_allocate','view_dashboard']) {
  test(`${cap} alone is not acknowledgment or general upload authority`, async () => {
    await setCaps(actor, [cap]);
    await db.exec('delete from warehouse.department_stock_requests');
    await asActor();
    assert.equal(await canUpload(), false);
    await assert.rejects(upload(), /row-level security/);
    await assert.rejects(upload('receipt/unrelated.png'), /row-level security/);
  });
}

for (const [label, change] of [
  ['deleted assignment', 'delete from core.user_roles'],
  ['expired assignment', "update core.user_roles set expires_at=now()-interval '1 hour'"],
  ['future assignment', "update core.user_roles set effective_at=now()+interval '1 hour'"],
  ['retired role', 'update core.roles set is_active=false'],
  ['removed capability', 'delete from core.role_capabilities'],
]) {
  test(`live capability revocation: ${label}`, async () => {
    await setCaps(actor, ['request_fulfillment']);
    await db.exec('delete from warehouse.department_stock_requests');
    await asActor();
    assert.equal(await canUpload(), true);
    await db.exec('reset role');
    await db.exec(change);
    await asActor();
    assert.equal(await canUpload(), false);
    await assert.rejects(upload(), /row-level security/);
  });
}

test('removing a capability does not revoke the independent linked-requester authority', async () => {
  await db.exec('delete from core.user_roles');
  await asActor();
  await upload();
  assert.equal((await acknowledge()).status, 'completed');
});

test('malformed, traversal and noncapture paths fail closed without UUID cast errors', async () => {
  await asActor();
  for (const path of [null,'', 'acknowledgment-bad/0/photo.png', objectPath.replace(file,'bad'),
    `evidence/${objectPath}`, `/${objectPath}`, `${objectPath}/extra`, `${objectPath}\n`,
    `${objectPath}?download=1`, objectPath.replace('/0/','/../'), objectPath.replace('/0/','/%2e%2e/'),
    objectPath.replace('/0/','/./'), objectPath.replace('/0/','//'), objectPath.replace('/0/','/1/'),
    objectPath.replaceAll('/','\\'), objectPath.replace('.png','.svg'), objectPath.replace('.png','.png.exe'),
    objectPath.replace('acknowledgment-','handover-'), objectPath.replace('acknowledgment-','acknowledgement-')]) {
    assert.equal(await canUpload(path), false, String(path));
    if (path !== null) await assert.rejects(upload(path), /row-level security/, path);
  }
});

for (const ext of ['png','jpg','webp','gif']) {
  test(`accepts actual uploadEvidence raster extension: ${ext}`, async () => {
    await asActor();
    await upload(objectPath.replace('.png',`.${ext}`));
  });
}

test('recipient policy requires owner_id and rejects conflicting legacy owner or wrong bucket', async () => {
  await asActor();
  for (const [ownerId,legacyOwner,bucket] of [
    [other,null,'evidence'], [actor,other,'evidence'], [other,actor,'evidence'],
    [null,actor,'evidence'], [null,null,'evidence'], [actor,null,'other'],
  ]) await assert.rejects(upload(objectPath,ownerId,legacyOwner,bucket), /row-level security/);
  await upload(objectPath,actor,actor);
});

test('post-ack operator read closes the cross-actor handoff without exposing unrelated evidence', async () => {
  await upload('receipt/unrelated.png',other);
  await upload(objectPath.replace(file,wrongOrder),other);
  await db.query("insert into warehouse.receipts values('receipt',$1::jsonb)", [JSON.stringify(['receipt/unrelated.png'])]);
  await asActor();
  await upload();
  const result = await acknowledge();
  assert.equal(result.status, 'completed');
  assert.deepEqual(await visible(), [objectPath]);
  assert.equal(await canUpload(), false);
  await assert.rejects(upload(objectPath.replace(file,order)), /row-level security/);
  await asActor(releaser);
  assert.equal(await registered(), true);
  assert.deepEqual(await visible(), [objectPath]);
  await asActor(other);
  assert.ok(!(await visible()).includes(objectPath));
  await db.exec('reset role');
  await db.query('update warehouse.fulfillment_orders set acknowledgement_evidence_url=$1 where id=$2', [`evidence/${objectPath}`,order]);
  await asActor(releaser);
  assert.equal(await registered(), true);
  await db.exec('reset role');
  await db.query('update warehouse.fulfillment_orders set acknowledgement_evidence_url=null where id=$1', [order]);
  await asActor(releaser);
  assert.deepEqual(await visible(), []);
  await asActor();
  assert.deepEqual(await visible(), [objectPath]);
});

test('source RLS and revoked source SELECT cannot be bypassed by the upload helper', async () => {
  await db.exec('create policy fixture_deny on warehouse.fulfillment_orders as restrictive for select to authenticated using(false)');
  try {
    await asActor();
    assert.equal(await canUpload(), false);
    await assert.rejects(upload(), /row-level security/);
  } finally { await db.exec('reset role; drop policy fixture_deny on warehouse.fulfillment_orders'); }
  await db.exec('revoke select on warehouse.department_stock_requests from authenticated');
  try {
    await asActor();
    await assert.rejects(upload(), /permission denied for table department_stock_requests/);
  } finally { await db.exec('reset role; grant select on warehouse.department_stock_requests to authenticated'); }
});

test('owner read survives link removal, but live inactive employee check still closes access', async () => {
  await asActor();
  await upload();
  await db.exec('reset role; delete from warehouse.department_stock_requests');
  await asActor();
  assert.equal(await canUpload(), false);
  assert.deepEqual(await visible(), [objectPath]);
  await db.exec('reset role');
  await db.query("update core.profiles set status='inactive' where id=$1", [actor]);
  await asActor();
  assert.deepEqual(await visible(), []);
});

for (const cap of ['receive_stock','manage_returns','issue_items','cycle_count','inspect_quality']) {
  test(`existing ${cap} operational upload remains unchanged, including legacy owner`, async () => {
    await setCaps(actor, [cap]);
    await db.exec(`delete from warehouse.department_stock_requests; update warehouse.fulfillment_orders set released_by='${actor}'`);
    await asActor();
    assert.equal(await canUpload(), false);
    await upload('operational/new.png');
    await upload('operational/legacy.png',null,actor);
    await upload(); // Existing operational permission is intentionally not narrowed by recipient checks.
    await assert.rejects(upload('operational/forged.png',other), /row-level security/);
    assert.equal((await visible()).length, 3);
  });
}

test('no update, delete or unauthenticated upload permissions are introduced', async () => {
  await asActor();
  await upload();
  assert.deepEqual(await rows("update storage.objects set name='changed' returning name"), []);
  assert.deepEqual(await rows('delete from storage.objects returning name'), []);
  await asActor('', 'anon');
  await assert.rejects(upload(), /row-level security/);
  assert.deepEqual(await visible(), []);
  await asActor('');
  assert.equal(await canUpload(), false);
  await assert.rejects(upload(), /row-level security/);
});

test('migration preserves all existing helpers, RPCs, policies and private bucket settings', async () => {
  assert.deepEqual(preservedAfter, preservedBefore);
  const [definition] = await rows(`select p.prosecdef,p.provolatile,p.proconfig,
    has_function_privilege('authenticated',p.oid,'execute') as authenticated,
    has_function_privilege('anon',p.oid,'execute') as anon
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='can_upload_warehouse_ack_evidence'`);
  assert.deepEqual(definition, {prosecdef:false,provolatile:'s',proconfig:['search_path=""'],authenticated:true,anon:false});
  const [policy] = await rows("select cmd,roles,permissive from pg_policies where policyname='evidence_recipient_ack_insert'");
  assert.deepEqual(policy, {cmd:'INSERT',roles:['authenticated'],permissive:'PERMISSIVE'});
});
