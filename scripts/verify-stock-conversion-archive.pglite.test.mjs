import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, afterEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const baseline = JSON.parse(await readFile(new URL("./fixtures/stock-conversion-archive-baseline.json", import.meta.url), "utf8"));
const candidate = await readFile(new URL("../supabase/migrations/20261106190736_stock_conversion_archive_boundaries.sql", import.meta.url), "utf8");
const patch = () => db.exec(candidate);
const workspace = async (product = false) => (await db.query(`select warehouse.${product ? "stock_conversion_recipe_workspace" : "stock_conversion_workspace"}('{}') result`)).rows[0].result;
const archive = async (table, id) => db.query("insert into private.uat_warehouse_archive_members values($1,$2,'uat-conversion-test',repeat('0',32),'Owned local SQL fixture')", [table,id]);
const denied = async (fn, pattern = /archived UAT test/i) => {
  await db.exec("savepoint denial");
  try { await assert.rejects(fn,pattern); } finally { await db.exec("rollback to savepoint denial"); }
};

const operator = "11111111-1111-4111-8111-111111111111";
const quality = "22222222-2222-4222-8222-222222222222";
const kit = "33333333-3333-4333-8333-333333333333";
const inspection = "44444444-4444-4444-8444-444444444444";
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const extract = (sql, name) => {
  let start = sql.indexOf(`create or replace function ${name}(`);
  if (start < 0) start = sql.indexOf(`create function ${name}(`);
  assert.notEqual(start, -1);
  const body = sql.indexOf("as $$", start);
  return sql.slice(start, sql.indexOf("$$;", body + 5) + 3);
};
const evidence = ["https://evidence.test/inspection"];
const recipeInput = (direction = "conversion") => ({ action: "approve_recipe", idempotency_key: `recipe-${direction}-0001`, kit_definition_id: kit,
  event_id: "event", direction, source_product_id: direction === "conversion" ? "base" : "variant", output_product_id: direction === "conversion" ? "variant" : "base",
  packaging: [{ product_id: "bag", quantity: 2, disposition: direction === "conversion" ? "consume" : "discard" }], approval_reference: "Product 123", evidence_urls: evidence });
const createInput = (recipe) => ({ action: "create", idempotency_key: "conversion-batch-0001", recipe_id: recipe.id, event_id: "event",
  source_location_id: "wh", source_bin_id: "bin", destination_location_id: "wh", destination_bin_id: "out",
  units: [{ serial_number: "WATCH-1", inspection_id: inspection }], evidence_urls: evidence });
const rpc = async (input) => (await db.query("select warehouse.execute_stock_conversion($1::jsonb) result", [JSON.stringify(input)])).rows[0].result;
const act = async (actor, capability = "all") => db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('test.capability',$2,false)", [actor, capability]);
const snapshot = async () => (await db.query(`select jsonb_build_object(
 'recipes',(select jsonb_agg(r order by id) from private.stock_conversion_recipes r),
 'units',(select jsonb_agg(u order by id) from warehouse.inventory_units u),
 'stock',(select jsonb_agg(s order by product_id,bin_id,lot_id) from warehouse.stock_levels s),
 'batches',(select jsonb_agg(b order by id) from private.stock_conversion_batches b),
 'claims',(select jsonb_agg(c order by batch_id,unit_id) from private.stock_conversion_claims c),
 'parts',(select jsonb_agg(p order by batch_id,product_id) from private.stock_conversion_parts p),
 'lines',(select jsonb_agg(l order by batch_id,unit_id) from private.stock_conversion_lines l),
 'movements',(select jsonb_agg(m order by id) from warehouse.movements m),
 'commands',(select jsonb_agg(c order by id) from warehouse.command_log c),
 'audit',(select jsonb_agg(a order by id) from core.activity_log a)) result`)).rows[0].result;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema product;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${operator}'),('${quality}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select true $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select current_setting('test.capability',true) in ('all',$2) $$;
    create function product.can_launch(text) returns boolean language sql stable as $$ select current_setting('test.launch',true) <> 'off' $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
    create table core.activity_log(id uuid primary key default gen_random_uuid(),module text,entity_type text,entity_id uuid,action text,actor uuid,detail jsonb);
  `);
  await db.exec((await migration("20260706092000_warehouse_schema.sql")).replace('create extension if not exists "pgcrypto";', ""));
  const control = await migration("20260710150000_warehouse_w1_control_schema.sql");
  await db.exec(control.slice(control.indexOf("create table if not exists warehouse.quality_inspections"), control.indexOf("create table if not exists warehouse.stock_change_requests")));
  await db.exec(control.slice(control.indexOf("create table if not exists warehouse.command_log"), control.indexOf("create table if not exists warehouse.import_jobs")));
  const helpers = await migration("20260710160000_warehouse_w1_quality_and_approval_rpcs.sql");
  await db.exec(extract(helpers,"private.begin_idempotent_command"));
  await db.exec(extract(helpers,"private.finish_idempotent_command"));
  await db.exec(extract(await migration("20260718201000_refresh_atp_inside_product_lock.sql"),"warehouse.available_to_promise"));
  await db.exec(`alter table warehouse.products add column serialization_policy text default 'none';
    alter table warehouse.locations add column active boolean default true;
    alter table warehouse.stock_levels add column id uuid default gen_random_uuid();
    alter table warehouse.quality_inspections add column bin_id text;
    alter table warehouse.inventory_holds add column bin_id text;
    alter table warehouse.events add column status text default 'planned';
    create table warehouse.kit_definitions(id uuid primary key,product_id text,version integer,name text,components jsonb,status text,owner_department text,product_approval_reference text);
    create table warehouse.fulfillment_reservations(id uuid primary key, product_id text,location_id text,bin_id text,quantity integer,status text);
    create function private.lock_warehouse_products(text[]) returns void language plpgsql as $$ begin
      perform pg_advisory_xact_lock(hashtextextended('warehouse.product:' || p,0)) from unnest($1) p order by p;
    end $$;
    create table private.event_custody_sources(allocation_id text primary key,event_id text,order_id uuid,product_id text,quantity integer,serial_numbers text[],acknowledged_at timestamptz,created_at timestamptz default now());
    create table private.event_custody_entries(id uuid primary key default gen_random_uuid(),event_id text,allocation_id text,seller_id uuid,kind text,quantity integer,serial_numbers text[],amount numeric,external_reference text,reverses_id uuid,created_at timestamptz default now());
  `);
  await db.exec(extract(await migration("20260920025525_gated_event_seller_custody.sql"),"private.assert_event_conversion_return"));
  await db.exec(`create table warehouse.procurement_receipt_serial_claims(serial_number text,product_id text,status text,outcome text);
    create unique index conversion_test_serial_unique on warehouse.inventory_units(serial_number);`);
  const serialGuards=await migration("20260826160000_harden_serial_custody_concurrency.sql");
  await db.exec(extract(serialGuards,"private.lock_serial_custody_identity"));
  await db.exec(extract(serialGuards,"private.normalize_inventory_unit_serial"));
  await db.exec(`create trigger warehouse_inventory_unit_serial_normalize before insert or update of serial_number,product_id,status on warehouse.inventory_units
    for each row execute function private.normalize_inventory_unit_serial();`);
  await db.exec(await migration("20260920025920_approved_stock_origin_conversion.sql"));
  const archiveSql = await migration("20261106145742_uat_warehouse_fixture_archive.sql");
  await db.exec(archiveSql.slice(archiveSql.indexOf("create table private.uat_warehouse_archive_batches"), archiveSql.indexOf("do $$ declare t text")));
  await db.exec(`insert into private.uat_warehouse_archive_batches(batch_id,manifest) values('uat-conversion-test','[{}]');
    create function private.stock_conversion_qc_matches(u warehouse.inventory_units,q warehouse.quality_inspections,uuid,boolean)
      returns boolean language sql as $$ select q.location_id=u.location_id and q.bin_id is not distinct from u.bin_id $$;
    create view warehouse.active_inventory_units as select * from warehouse.inventory_units u where not private.is_uat_warehouse_archived('inventory_units',u.id);
    create view warehouse.active_quality_inspections as select * from warehouse.quality_inspections q where not private.is_uat_warehouse_archived('quality_inspections',q.id::text);
    create view warehouse.active_returns as select * from warehouse.returns r where not private.is_uat_warehouse_archived('returns',r.id);
    grant usage on schema warehouse to authenticated;
  `);
  // Exact installed command/readers; QC fixture covers exact-bin acceptance, not the putaway bridge.
  for (const entry of baseline) {
    await db.exec(entry.definition);
    await db.exec(`revoke all on function ${entry.signature} from public,anon,authenticated,service_role; grant execute on function ${entry.signature} to authenticated;`);
    assert.equal((await db.query("select md5(replace(prosrc,chr(13),'')) hash from pg_proc where oid=$1::regprocedure",[entry.signature])).rows[0].hash,entry.body_md5);
  }
});
beforeEach(async (context) => {
  const isolation=["repeatable read","serializable"].find(level=>context.name.endsWith(`under ${level}`));
  await db.exec(isolation ? `begin isolation level ${isolation}` : "begin");
  await db.exec(`truncate warehouse.procurement_receipt_serial_claims,private.event_custody_sources,private.event_custody_entries,private.stock_conversion_lines,private.stock_conversion_parts,private.stock_conversion_claims,private.stock_conversion_batches,private.stock_conversion_recipes,warehouse.vendor_returns,warehouse.inventory_holds,warehouse.quality_inspections,warehouse.inventory_units,warehouse.stock_levels,warehouse.movements,warehouse.command_log,warehouse.fulfillment_reservations,warehouse.returns,warehouse.allocations,core.activity_log;
    select set_config('test.launch','on',false),set_config('test.return_lineage','off',false);
    update warehouse.events set status='planned';
    insert into warehouse.products(id,sku,name,category,serialized,serialization_policy) values('base','BASE','Base watch','device',true,'required'),('variant','VAR','Event watch','device',true,'required'),('bag','BAG','Bag','supply',false,'none') on conflict do nothing;
    insert into warehouse.locations(id,name,type) values('wh','Warehouse','warehouse') on conflict do nothing;
    insert into warehouse.storage_areas(id,location_id,code) values('bin','wh','BIN'),('out','wh','OUT') on conflict do nothing;
    insert into warehouse.events(id,name,type,start_date) values('event','Fair','wellness',current_date) on conflict do nothing;
    insert into warehouse.kit_definitions values('${kit}','variant',1,'Event kit','[{"productId":"base","quantity":1,"serializationPolicy":"required"},{"productId":"bag","quantity":2,"serializationPolicy":"none"}]','active','product','Product approved') on conflict(id) do update set status='active';
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status) values('unit','base','WATCH-1','wh','bin','in_stock');
    insert into warehouse.procurement_receipt_serial_claims values('WATCH-1','base','posted','clean');
    insert into warehouse.stock_levels(product_id,location_id,bin_id,quantity) values('bag','wh','bin',10);
    insert into warehouse.quality_inspections(id,source_type,source_id,product_id,serial_number,location_id,bin_id,quantity,disposition,evidence_urls,inspected_by,inspected_by_email)
      values('${inspection}','receipt','receipt','base','WATCH-1','wh','bin',1,'accepted','["https://evidence.test/source"]','${quality}','quality@test.invalid');
  `);
  await act(operator);
});
afterEach(() => db.exec("rollback"));
after(() => db.close());


test("installed predecessor reproduces private recipe archive bypass", async () => {
  await archive("products","base");
  assert.equal((await rpc(recipeInput())).source_product_id,"base");
  assert.equal((await workspace(true)).recipes.length,1);
});

test("installed active-view reader reproduces QC composite argument mismatch", async () => {
  await denied(()=>workspace(),/stock_conversion_qc_matches.*does not exist/);
});

for (const [table,id] of [["products","base"],["products","variant"],["products","bag"],["kit_definitions",kit]]) {
  test(`fresh approval rejects archived ${table}/${id} without any writes`, async () => {
    await patch(); await archive(table,id);
    const before = await snapshot();
    await denied(()=>rpc(recipeInput()));
    assert.deepEqual(await snapshot(),before);
    assert.equal((await workspace(true)).kits.length,0);
  });
}

test("recipe choices exclude archived references but Product recipe history is retained and marked", async () => {
  const recipe = await rpc(recipeInput());
  await patch(); await archive("products","base");
  assert.equal((await workspace()).recipes.length,0);
  const history=(await workspace(true)).recipes;
  assert.equal(history.length,1);
  assert.equal(history[0].id,recipe.id);
  assert.equal(history[0].archived,true);
  assert.equal(history[0].approval_reference,recipe.approval_reference);
});

async function completeForward() {
  const recipe=await rpc(recipeInput());
  const input=createInput(recipe);
  const batch=await rpc(input);
  await act(quality,"inspect_quality");
  const approve={action:"approve",batch_id:batch.id,idempotency_key:"approve-conversion-test",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence};
  await rpc(approve);
  await act(operator,"manage_returns");
  const complete={action:"complete",batch_id:batch.id,idempotency_key:"complete-conversion-test",evidence_urls:evidence};
  const result=await rpc(complete);
  return {recipe,input,batch,approve,complete,result};
}

test("active exact-bin conversion retains current actor, QC, packaging and serial behavior", async () => {
  await patch();
  const {result}=await completeForward();
  assert.equal(result.status,"completed");
  assert.deepEqual((await db.query("select id,serial_number,product_id,status,bin_id from warehouse.inventory_units")).rows,
    [{id:"unit",serial_number:"WATCH-1",product_id:"variant",status:"in_stock",bin_id:"out"}]);
  assert.equal((await db.query("select quantity from warehouse.stock_levels where product_id='bag'")).rows[0].quantity,8);
});

test("completed batches retain unchanged history, marked archived, with cached replay preserved", async () => {
  await patch();
  const {recipe,input,approve,complete,result}=await completeForward();
  await archive("products","base");
  const before=await snapshot();
  assert.deepEqual(await rpc(complete),result);
  await act(quality,"inspect_quality");
  assert.equal((await rpc(approve)).status,"ready");
  await act(operator,"manage_returns");
  assert.equal((await rpc(input)).status,"inspection");
  await act(operator,"decide_go_live");
  assert.deepEqual(await rpc(recipeInput()),recipe);
  await act(operator);
  const history=(await workspace()).batches;
  assert.equal(history.length,1);
  assert.equal(history[0].status,"completed");
  assert.equal(history[0].archived,true);
  assert.deepEqual(await snapshot(),before);
});

test("command and reader pg_proc metadata, OIDs, grants and settings are preserved", async () => {
  const metadata=async()=> (await db.query("select oid::text,to_jsonb(p)-'prosrc' data from pg_proc p where oid=any($1::regprocedure[]) order by oid",[baseline.map(b=>b.signature)])).rows;
  const before=await metadata(); await patch(); assert.deepEqual(await metadata(),before);
});

for (const action of ["create","approve","complete","cancel"]) {
  for (const [table,id] of [["products","base"],["products","variant"],["products","bag"],["kit_definitions",kit],
    ["inventory_units","unit"],["quality_inspections",inspection],["receipts","receipt"]]) {
    test(`${action} checks persisted recipe and exact units: archived ${table}/${id}`, async () => {
      await patch();
      const recipe=await rpc(recipeInput());
      let input=createInput(recipe);
      if(action!=="create") {
        const batch=await rpc(input);
        input={action,batch_id:batch.id,idempotency_key:`action-${action}-archive`,evidence_urls:evidence,
          reason:"Local cancellation",inspected_serial_numbers:["WATCH-1"]};
        if(action==="approve" || action==="complete") await act(quality,"inspect_quality");
        if(action==="complete") {
          await rpc({...input,action:"approve",idempotency_key:"pre-archive-quality"});
          await act(operator,"manage_returns");
        }
      }
      await archive(table,id);
      const before=await snapshot();
      await denied(()=>rpc(input));
      assert.deepEqual(await snapshot(),before);
    });
  }
}

test("active workspace executes typed QC helper and excludes archived units/inspections", async () => {
  await patch();
  assert.equal((await workspace()).candidates[0].unit_id,"unit");
  await archive("quality_inspections",inspection);
  assert.equal((await workspace()).candidates.length,0);
});

test("equivalent UUID spelling cannot bypass exact archived inspection identity", async () => {
  const upperInspection="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await db.query("update warehouse.quality_inspections set id=$1",[upperInspection]);
  await patch(); const recipe=await rpc(recipeInput()); await archive("quality_inspections",upperInspection);
  await denied(()=>rpc({...createInput(recipe),units:[{serial_number:"WATCH-1",inspection_id:upperInspection.toUpperCase()}]}));
});

test("unrelated archived references do not hide active options or alter cancellation", async () => {
  await patch(); await archive("products","unrelated");
  const recipe=await rpc(recipeInput());
  assert.equal((await workspace()).recipes.length,1);
  assert.equal((await workspace(true)).kits.length,1);
  assert.equal((await workspace(true)).recipes[0].archived,false);
  const batch=await rpc(createInput(recipe));
  assert.equal((await workspace()).batches[0].archived,false);
  const input={action:"cancel",batch_id:batch.id,idempotency_key:"cancel-active-batch",reason:"Local cancellation",evidence_urls:evidence};
  assert.equal((await rpc(input)).status,"cancelled");
  await archive("products","base");
  const before=await snapshot();
  assert.equal((await rpc(input)).status,"cancelled");
  assert.deepEqual(await snapshot(),before);
});

test("archive denial cannot replace live authority or changed-payload replay denial", async () => {
  await patch();
  const input=recipeInput(); await rpc(input); await archive("products","base");
  await act(operator,"none");
  await denied(()=>rpc(input),/Not authorized/);
  await denied(()=>workspace(),/Not authorized/);
  await denied(()=>workspace(true),/Not authorized/);
  await act("","all"); await denied(()=>rpc(input),/Not authorized/);
  await act(operator);
  await denied(()=>rpc({...input,approval_reference:"Changed replay"}),/different payload/);
});

for(const isolation of ["repeatable read","serializable"]) test(`fresh commands fail but completed replay remains read-only under ${isolation}`, async () => {
  const input=recipeInput(); const result=await rpc(input); await patch();
  // This tests PostgreSQL's isolation gate, not a multi-session archive race.
  await denied(()=>rpc({...input,idempotency_key:"fresh-isolated-command"}),e=>e.code==="40001");
  assert.deepEqual(await rpc(input),result);
});

test("archive lock remains after fresh command and sits after replay before original row locks", async () => {
  await patch(); await rpc(recipeInput());
  const source=(await db.query("select prosrc from pg_proc where oid='warehouse.execute_stock_conversion(jsonb)'::regprocedure")).rows[0].prosrc;
  assert.ok(source.indexOf("if (started->>'replayed')::boolean")<source.indexOf("perform private.assert_stock_conversion_not_archived(payload)"));
  assert.ok(source.indexOf("perform private.assert_stock_conversion_not_archived(payload)")<source.indexOf("from warehouse.events where id=v_event for update"));
  const locks=(await db.query("select mode from pg_locks where locktype='advisory' and granted and mode='ShareLock'")).rows;
  assert.ok(locks.length>0);
});

for(const entry of baseline) {
  test(`exact predecessor drift aborts atomically: ${entry.signature}`, async () => {
    await db.exec(entry.definition.replace("begin\n","begin\n  -- changed predecessor\n"));
    const before=(await db.query("select oid::text,to_jsonb(p) data from pg_proc p where oid=any($1::regprocedure[]) order by oid",[baseline.map(b=>b.signature)])).rows;
    await denied(()=>patch(),/predecessor drift/);
    assert.deepEqual((await db.query("select oid::text,to_jsonb(p) data from pg_proc p where oid=any($1::regprocedure[]) order by oid",[baseline.map(b=>b.signature)])).rows,before);
    assert.equal((await db.query("select to_regprocedure('private.assert_stock_conversion_not_archived(jsonb)') helper")).rows[0].helper,null);
  });
}

test("new helpers have no client execute privileges; archives and conversion history remain immutable", async () => {
  await patch();
  const helpers=["private.stock_conversion_kit_archived(uuid)","private.stock_conversion_recipe_archived(jsonb)",
    "private.stock_conversion_units_archived(jsonb)","private.stock_conversion_batch_archived(private.stock_conversion_batches,boolean)","private.assert_stock_conversion_not_archived(jsonb)"];
  for(const role of ["anon","authenticated","service_role"]) for(const helper of helpers) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,helper])).rows[0].allowed,false);
  }
  await rpc(recipeInput()); await archive("products","base");
  for(const sql of ["update private.uat_warehouse_archive_members set provenance='Changed audit'","delete from private.uat_warehouse_archive_members",
    "truncate private.uat_warehouse_archive_members","update private.stock_conversion_recipes set approval_reference='Rewrite'","delete from private.stock_conversion_recipes"]) {
    await denied(()=>db.exec(sql),/immutable|cannot be deleted or rewritten/);
  }
});

for(const table of ["quality_inspections","stock_levels"]) {
  test(`synthetic-root archive API rejects partial ${table} membership without its product`, async () => {
    await db.exec(extract(await migration("20261106145742_uat_warehouse_fixture_archive.sql"),"private.archive_uat_warehouse_fixture"));
    await db.exec("update warehouse.products set attributes=jsonb_build_object('synthetic',true)");
    const id=table==="stock_levels" ? (await db.query("select id::text from warehouse.stock_levels where product_id='bag'")).rows[0].id : inspection;
    const product=table==="stock_levels" ? "bag" : "base";
    const row=(await db.query(`select jsonb_build_object('table',$1::text,'row_id',id::text,'row_md5',md5(to_jsonb(t)::text),'provenance','Owned local conversion test') entry
      from warehouse.${table} t where id::text=$2`,[table,id])).rows[0].entry;
    await denied(()=>db.query("select private.archive_uat_warehouse_fixture('uat-conversion-partial',$1::jsonb)",[[row]]),/Mixed or foreign product data/);
    assert.equal((await db.query("select private.is_uat_warehouse_archived($1,$2) archived",[table,id])).rows[0].archived,false);
    assert.equal((await db.query("select private.is_uat_warehouse_archived('products',$1) archived",[product])).rows[0].archived,false);
  });

  test(`supported ${table} archive includes its product atomically and blocks fresh conversion`, async () => {
    await db.exec(extract(await migration("20261106145742_uat_warehouse_fixture_archive.sql"),"private.archive_uat_warehouse_fixture"));
    await db.exec("update warehouse.products set attributes=jsonb_build_object('synthetic',true)");
    await patch();
    const {recipe}=await completeForward();
    const id=table==="stock_levels" ? (await db.query("select id::text from warehouse.stock_levels where product_id='bag'")).rows[0].id : inspection;
    const product=table==="stock_levels" ? "bag" : "base";
    const manifest=(await db.query(`select jsonb_agg(entry) manifest from (
      select jsonb_build_object('table','products','row_id',id,'row_md5',md5(to_jsonb(p)::text),'provenance','Owned local conversion test') entry from warehouse.products p where id=$1
      union all select jsonb_build_object('table',$2::text,'row_id',id::text,'row_md5',md5(to_jsonb(t)::text),'provenance','Owned local conversion test') from warehouse.${table} t where id::text=$3
    ) entries`,[product,table,id])).rows[0].manifest;
    const before=await snapshot();
    assert.equal((await db.query("select private.archive_uat_warehouse_fixture('uat-conversion-supported',$1::jsonb) result",[manifest])).rows[0].result.archived,2);
    assert.deepEqual(await snapshot(),before);
    assert.equal((await workspace()).batches[0].archived,true);
    await act(operator);
    await denied(()=>rpc({...recipeInput("recovery"),idempotency_key:"fresh-recovery-archive"}));
    await denied(()=>rpc({...createInput(recipe),idempotency_key:"fresh-create-archive"}));
  });
}

// An explicitly reviewed maintenance registry append can retire individual rows
// beneath an active master product; it is distinct from the synthetic-root API.
for(const target of ["stock_levels","lots"]) test(`partial ${target} archive leaves active alternate packaging usable`, async () => {
  await patch();
  await db.exec(`insert into warehouse.lots(id,product_id) values('aaa-archived','bag'),('zzz-active','bag');
    update warehouse.stock_levels set lot_id='aaa-archived' where product_id='bag';
    insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values('bag','wh','bin','zzz-active',3);
    create table warehouse.fulfillment_orders(id uuid,external_reference text);
    create trigger uat_archived_record_write_guard before insert or update or delete on warehouse.stock_levels
      for each row execute function private.guard_uat_archived_warehouse_write();`);
  const old=(await db.query("select * from warehouse.stock_levels where lot_id='aaa-archived'")).rows[0];
  await archive(target,target==="lots" ? "aaa-archived" : old.id);
  const batch=await rpc(createInput(await rpc(recipeInput())));
  assert.equal(batch.status,"inspection");
  assert.deepEqual((await db.query("select * from warehouse.stock_levels where lot_id='aaa-archived'")).rows[0],old);
  assert.equal((await db.query("select quantity from warehouse.stock_levels where lot_id='zzz-active'")).rows[0].quantity,1);
  assert.deepEqual((await db.query("select lot_id from private.stock_conversion_parts where batch_id=$1",[batch.id])).rows,[{lot_id:"zzz-active"}]);
});

async function recoveryInput() {
  const {batch}=await completeForward();
  await act(operator);
  const recipe=await rpc(recipeInput("recovery"));
  await db.exec(`update warehouse.inventory_units set status='issued',event_id='event';
    update warehouse.inventory_units set status='in_stock',event_id=null;
    insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('returned-allocation','event','variant',1,'returned');
    insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,serial_numbers,acknowledged_at)
      values('returned-allocation','event',gen_random_uuid(),'variant',1,array['WATCH-1'],now());
    insert into warehouse.returns(id,source,event_id,actor,lines) values('fresh-return','event','event','${operator}',
      '[{"allocationId":"returned-allocation","productId":"variant","serialNumber":"WATCH-1","quantity":1}]');`);
  const q=(await db.query(`insert into warehouse.quality_inspections(source_type,source_id,product_id,serial_number,location_id,bin_id,quantity,disposition,evidence_urls,inspected_by,inspected_by_email)
    values('return','fresh-return','variant','WATCH-1','wh','out',1,'accepted',$1::jsonb,$2,'quality@test.invalid') returning id`,[JSON.stringify(evidence),quality])).rows[0].id;
  return {...createInput(recipe),idempotency_key:"fresh-recovery-claim",source_bin_id:"out",destination_bin_id:"bin",
    units:[{serial_number:"WATCH-1",inspection_id:q,return_id:"fresh-return",allocation_id:"returned-allocation",original_conversion_id:batch.id}]};
}

test("recovery with current accepted return cannot reuse archived original QC", async () => {
  await patch(); const input=await recoveryInput(); await archive("quality_inspections",inspection);
  assert.equal((await workspace()).batches[0].archived,true);
  const before=await snapshot(); await denied(()=>rpc(input)); assert.deepEqual(await snapshot(),before);
});

test("active recovery retains exact original conversion, new return QC and event lineage", async () => {
  await patch(); const input=await recoveryInput(); const batch=await rpc(input);
  await act(quality,"inspect_quality");
  await rpc({action:"approve",batch_id:batch.id,idempotency_key:"approve-active-recovery",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await act(operator,"manage_returns");
  assert.equal((await rpc({action:"complete",batch_id:batch.id,idempotency_key:"complete-active-recovery",evidence_urls:evidence})).status,"completed");
  assert.equal((await db.query("select product_id from warehouse.inventory_units where id='unit'")).rows[0].product_id,"base");
});

test("archived-only packaging cannot satisfy a fresh batch and all tentative claims roll back", async () => {
  await patch(); const recipe=await rpc(recipeInput());
  const id=(await db.query("select id::text from warehouse.stock_levels where product_id='bag'")).rows[0].id;
  await archive("stock_levels",id); const before=await snapshot();
  await denied(()=>rpc(createInput(recipe)),/Insufficient available packaging/);
  assert.deepEqual(await snapshot(),before);
});

for(const action of ["approve","complete","cancel"]) test(`already-selected packaging archived before ${action} rejects without mutation`, async () => {
  await patch(); const batch=await rpc(createInput(await rpc(recipeInput())));
  if(action==="approve" || action==="complete") await act(quality,"inspect_quality");
  if(action==="complete") {
    await rpc({action:"approve",batch_id:batch.id,idempotency_key:"pre-partial-approval",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
    await act(operator,"manage_returns");
  }
  const id=(await db.query("select id::text from warehouse.stock_levels where product_id='bag'")).rows[0].id;
  await archive("stock_levels",id); const before=await snapshot();
  await denied(()=>rpc({action,batch_id:batch.id,idempotency_key:`partial-packaging-${action}`,inspected_serial_numbers:["WATCH-1"],reason:"Local cancellation",evidence_urls:evidence}));
  assert.deepEqual(await snapshot(),before);
});

test("private conversion tables retain RLS, no policies and no direct client writes", async () => {
  const tables=["stock_conversion_recipes","stock_conversion_batches","stock_conversion_claims","stock_conversion_parts"];
  const catalog=async()=> (await db.query("select c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,(select count(*)::int from pg_policy p where p.polrelid=c.oid) policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any($1::text[]) order by c.relname",[tables])).rows;
  const before=await catalog(); await patch(); assert.deepEqual(await catalog(),before);
  assert.equal(before.length,4); assert.ok(before.every(t=>t.relrowsecurity && t.policies===0));
  await db.exec("grant usage on schema private to anon,authenticated,service_role");
  for(const role of ["anon","authenticated","service_role"]) {
    for(const table of tables) {
      for(const privilege of ["INSERT","UPDATE","DELETE","TRUNCATE"]) assert.equal((await db.query("select has_table_privilege($1,$2,$3) allowed",[role,`private.${table}`,privilege])).rows[0].allowed,false);
      await db.exec(`set local role ${role}`);
      for(const sql of [`insert into private.${table} default values`,`update private.${table} set ${table==="stock_conversion_claims" ? "unit_id=unit_id" : "id=id"}`,`delete from private.${table}`]) await denied(()=>db.exec(sql),/permission denied/);
      await db.exec("reset role");
    }
  }
});
