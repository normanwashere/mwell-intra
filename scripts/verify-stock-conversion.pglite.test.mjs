import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
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
});
beforeEach(async () => {
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
after(() => db.close());

test("converts stock without fabricating a return or a new device serial", async () => {
  const recipe = await rpc(recipeInput());
  await act(operator,"manage_returns");
  const batch = await rpc(createInput(recipe));
  assert.equal(batch.status,"inspection");
  assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status,"conversion_pending");
  await act(quality,"inspect_quality");
  await rpc({ action:"approve",batch_id:batch.id,idempotency_key:"conversion-approve-0001",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence });
  await act(operator,"manage_returns");
  const result = await rpc({action:"complete",batch_id:batch.id,idempotency_key:"conversion-complete-0001",evidence_urls:evidence});
  assert.equal(result.status,"completed");
  assert.deepEqual((await db.query("select id,serial_number,product_id,status,bin_id from warehouse.inventory_units")).rows,[{id:"unit",serial_number:"WATCH-1",product_id:"variant",status:"in_stock",bin_id:"out"}]);
  assert.equal((await db.query("select quantity from warehouse.stock_levels where product_id='bag'")).rows[0].quantity,8);
  assert.equal((await db.query("select count(*)::int n from private.stock_conversion_lines")).rows[0].n,1);
});

test("claims cannot be issued by a legacy writer and another claim fails atomically", async () => {
  const recipe = await rpc(recipeInput());
  await rpc(createInput(recipe));
  const before = await snapshot();
  await assert.rejects(db.query("update warehouse.inventory_units set status='issued' where id='unit'"),/claimed/);
  await assert.rejects(rpc({...createInput(recipe),idempotency_key:"another-batch-00001"}),/available|claimed/);
  assert.deepEqual(await snapshot(),before);
});

test("replay returns saved result; changed payload with same key is rejected", async () => {
  const recipe = await rpc(recipeInput());
  const input = createInput(recipe);
  const first = await rpc(input);
  const before = await snapshot();
  assert.deepEqual(await rpc(input),first);
  await assert.rejects(rpc({...input,destination_bin_id:"bin"}),/different payload/);
  assert.deepEqual(await snapshot(),before);
});

test("live capability revocation denies a replay before reading its result", async () => {
  const input = recipeInput();
  await rpc(input);
  await act(operator,"none");
  await assert.rejects(rpc(input),/Not authorized/);
});

test("warehouse product-master capability alone cannot approve Product recipes", async () => {
  await act(operator,"manage_products");
  await assert.rejects(rpc(recipeInput()),/product.decide_go_live/);
  await act(operator,"decide_go_live");
  assert.equal((await rpc(recipeInput())).direction,"conversion");
});

test("Product-only recipe workspace supplies governed options without exposing custody", async () => {
  await act(operator,"decide_go_live");
  await rpc(recipeInput());
  const load=async () => (await db.query("select warehouse.stock_conversion_recipe_workspace('{}') result")).rows[0].result;
  const workspace=await load();
  assert.equal(workspace.kits[0].id,kit);
  assert.equal(workspace.kits[0].base_product_id,"base");
  assert.equal(workspace.events[0].id,"event");
  assert.equal(workspace.recipes.length,1);
  assert.equal(workspace.candidates,undefined);
  assert.equal(workspace.batches,undefined);
  await act(operator,"manage_products");
  await assert.rejects(load(),/Not authorized/);
  await act(operator,"manage_returns");
  await assert.rejects(load(),/Not authorized/);
  await act(operator,"decide_go_live");
  await assert.rejects(db.query("select warehouse.stock_conversion_workspace('{}')"),/Not authorized/);
  await db.exec("select set_config('test.launch','off',false)");
  assert.equal((await load()).kits.length,0);
});

async function completeForward() {
  const batch=await rpc(createInput(await rpc(recipeInput())));
  await act(quality,"inspect_quality");
  await rpc({action:"approve",batch_id:batch.id,idempotency_key:"procurement-quality-1",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await act(operator,"manage_returns");
  await rpc({action:"complete",batch_id:batch.id,idempotency_key:"procurement-complete1",evidence_urls:evidence});
  return batch;
}

test("posted receipt retains original SKU while converted device can be issued and returned", async () => {
  await completeForward();
  await db.exec("update warehouse.inventory_units set status='issued',event_id='event'; update warehouse.inventory_units set status='in_stock',event_id=null");
  assert.deepEqual((await db.query("select product_id,status from warehouse.inventory_units")).rows,[{product_id:"variant",status:"in_stock"}]);
  assert.deepEqual((await db.query("select product_id,status,outcome from warehouse.procurement_receipt_serial_claims")).rows,[{product_id:"base",status:"posted",outcome:"clean"}]);
});

test("conversion exception cannot authorize arbitrary product edits or serial replacement", async () => {
  await completeForward();
  const before=await snapshot();
  await assert.rejects(db.query("update warehouse.inventory_units set product_id='base'"),/approved conversion/);
  await assert.rejects(db.query("update warehouse.inventory_units set serial_number='OTHER'"),/identity/);
  await assert.rejects(db.query("insert into warehouse.inventory_units(id,product_id,serial_number,status) values('another','variant','WATCH-1','in_stock')"),/receipt custody|duplicate/);
  assert.deepEqual(await snapshot(),before);
});

for (const [status,outcome] of [["pending","clean"],["held","clean"],["posted","damaged"]]) {
  test(`procurement ${status}/${outcome} is not exempted by conversion history`,async () => {
    await completeForward();
    await db.query("update warehouse.procurement_receipt_serial_claims set status=$1,outcome=$2",[status,outcome]);
    const before=await snapshot();
    await assert.rejects(db.query("update warehouse.inventory_units set status='issued'"),/receipt custody/);
    assert.deepEqual(await snapshot(),before);
  });
}

test("Quality must be independent and explicitly confirm all device results", async () => {
  const batch = await rpc(createInput(await rpc(recipeInput())));
  const approve = {action:"approve",batch_id:batch.id,idempotency_key:"quality-approve-0001",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence};
  await assert.rejects(rpc(approve),/independent/);
  await act(quality);
  await assert.rejects(rpc({...approve,inspected_serial_numbers:[]}),/every device/);
  await act(operator);
  await assert.rejects(rpc({action:"complete",batch_id:batch.id,idempotency_key:"complete-before-qc1",evidence_urls:evidence}),/approval/);
});

test("cancellation restores exact source and packaging without deleting history", async () => {
  const batch = await rpc(createInput(await rpc(recipeInput())));
  await rpc({action:"cancel",batch_id:batch.id,idempotency_key:"cancel-conversion-1",reason:"Event postponed",evidence_urls:evidence});
  assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status,"in_stock");
  assert.equal((await db.query("select quantity from warehouse.stock_levels")).rows[0].quantity,10);
  assert.equal((await db.query("select count(*)::int n from warehouse.stock_levels")).rows[0].n,1);
  assert.equal((await db.query("select status from private.stock_conversion_batches")).rows[0].status,"cancelled");
  await assert.rejects(db.query("delete from private.stock_conversion_batches"),/history/);
});

for (const [name,sql] of [
  ["issued", "update warehouse.inventory_units set status='issued'"],
  ["disposed", "update warehouse.inventory_units set status='disposed'"],
  ["foreign event", "update warehouse.inventory_units set event_id='foreign'"],
  ["allocated", "update warehouse.inventory_units set assigned_to='order-1'"],
  ["wrong bin", "update warehouse.inventory_units set bin_id='out'"],
  ["unaccepted inspection", "update warehouse.quality_inspections set disposition='damaged'"],
  ["insufficient packaging", "update warehouse.stock_levels set quantity=1"],
  ["hold", `insert into warehouse.inventory_holds(inspection_id,product_id,location_id,serial_number,quantity,status,reason,created_by) values('${inspection}','base','wh','WATCH-1',1,'active','Hold','${quality}')`],
  ["active reservation", "insert into warehouse.fulfillment_reservations values(gen_random_uuid(),'base','wh','bin',1,'active')"],
]) test(`rejects ${name} sources and rolls back all writes`, async () => {
  const recipe = await rpc(recipeInput());
  await db.exec(sql);
  const before = await snapshot();
  await assert.rejects(rpc(createInput(recipe)));
  assert.deepEqual(await snapshot(),before);
});

test("Product recipe must match active kit components; no implicit packaging", async () => {
  await assert.rejects(rpc({...recipeInput(),packaging:[]}),/packaging/);
  await db.exec("select set_config('test.launch','off',false)");
  await assert.rejects(rpc(recipeInput()),/readiness/);
});

test("failure on last source leaves first source and component stock intact", async () => {
  const recipe = await rpc(recipeInput());
  const input = createInput(recipe);
  input.units.push({serial_number:"FOREIGN",inspection_id:inspection});
  const before = await snapshot();
  await assert.rejects(rpc(input));
  assert.deepEqual(await snapshot(),before);
});

test("pending inspection packaging cannot be consumed", async () => {
  const recipe = await rpc(recipeInput());
  await db.exec(`insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,status,reason,created_by)
    values('${inspection}','bag','wh',10,'active','Awaiting independent quality inspection','${quality}')`);
  const before = await snapshot();
  await assert.rejects(rpc(createInput(recipe)),/Packaging/);
  assert.deepEqual(await snapshot(),before);
});

test("late movement failure rolls back unit, packaging, lineage, command and audit", async () => {
  const batch = await rpc(createInput(await rpc(recipeInput())));
  await act(quality);
  await rpc({action:"approve",batch_id:batch.id,idempotency_key:"approve-late-error-1",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await act(operator);
  await db.exec(`create function private.fail_conversion_movement() returns trigger language plpgsql as $$ begin
    if new.type='stock_conversion_in' then raise exception 'Late injected failure';end if; return new;end $$;
    create trigger fail_conversion_movement before insert on warehouse.movements for each row execute function private.fail_conversion_movement();`);
  const before=await snapshot();
  try {
    await assert.rejects(rpc({action:"complete",batch_id:batch.id,idempotency_key:"complete-late-error1",evidence_urls:evidence}),/Late injected failure/);
    assert.deepEqual(await snapshot(),before);
  } finally { await db.exec("drop trigger fail_conversion_movement on warehouse.movements;drop function private.fail_conversion_movement();"); }
});

test("two submitted batches cannot claim the same device", async () => {
  const recipe=await rpc(recipeInput());
  const results=await Promise.allSettled([rpc(createInput(recipe)),rpc({...createInput(recipe),idempotency_key:"parallel-conversion2"})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.query("select count(*)::int n from private.stock_conversion_claims where released_at is null")).rows[0].n,1);
});

test("private tables and helpers are not executable or writable by clients", async () => {
  const {rows}=await db.query(`select has_table_privilege('authenticated','private.stock_conversion_claims','INSERT') writable,
    has_function_privilege('authenticated','private.stock_conversion_evidence(jsonb)','EXECUTE') helper,
    has_function_privilege('anon','warehouse.execute_stock_conversion(jsonb)','EXECUTE') anonymous`);
  assert.deepEqual(rows,[{writable:false,helper:false,anonymous:false}]);
});

test("closed event cannot begin new forward conversion", async () => {
  const recipe=await rpc(recipeInput());
  await db.exec("update warehouse.events set status='closed'");
  await assert.rejects(rpc(createInput(recipe)),/Closed/);
});

test("a hold placed on claimed packaging blocks completion without partial output", async () => {
  const batch=await rpc(createInput(await rpc(recipeInput())));
  await act(quality);
  await rpc({action:"approve",batch_id:batch.id,idempotency_key:"late-packaging-hold1",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await db.exec(`insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,status,reason,created_by)
    values('${inspection}','bag','wh',1,'active','Safety hold','${quality}')`);
  await act(operator);
  const before=await snapshot();
  await assert.rejects(rpc({action:"complete",batch_id:batch.id,idempotency_key:"complete-held-bags1",evidence_urls:evidence}),/Packaging/);
  assert.deepEqual(await snapshot(),before);
});

test("recovery requires the event ledger integration and exact original conversion", async () => {
  const forward = await rpc(createInput(await rpc(recipeInput())));
  await act(quality);
  await rpc({action:"approve",batch_id:forward.id,idempotency_key:"approve-forward-0001",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await act(operator);
  await rpc({action:"complete",batch_id:forward.id,idempotency_key:"complete-forward-001",evidence_urls:evidence});
  await db.exec("update warehouse.events set status='closed'");
  const recovery = await rpc(recipeInput("recovery"));
  await db.exec(`update warehouse.inventory_units set bin_id='bin';
    update warehouse.quality_inspections set product_id='variant',source_type='return',source_id='return-1',inspected_at=now();
    insert into warehouse.returns(id,source,event_id,actor,lines) values('return-1','event','event','${operator}','[{"allocationId":"allocation-1","productId":"variant","serialNumber":"WATCH-1","quantity":1}]');`);
  const input = {...createInput(recovery),idempotency_key:"recovery-batch-00001",units:[{serial_number:"WATCH-1",inspection_id:inspection,return_id:"return-1",allocation_id:"allocation-1",original_conversion_id:forward.id}]};
  await assert.rejects(rpc(input),/lineage/);
  await db.exec(`insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('allocation-1','event','variant',1,'returned');
    insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,serial_numbers,acknowledged_at)
      values('allocation-1','event',gen_random_uuid(),'variant',1,array['WATCH-1'],now());`);
  await db.exec("insert into private.event_custody_entries(allocation_id,kind,serial_numbers) values('allocation-1','sale',array['WATCH-1'])");
  await assert.rejects(rpc(input),/lineage/);
  await db.exec("insert into private.event_custody_entries(allocation_id,kind,serial_numbers,reverses_id) select allocation_id,'reversal',serial_numbers,id from private.event_custody_entries where kind='sale'");
  const batch = await rpc(input);
  await act(quality);
  await rpc({action:"approve",batch_id:batch.id,idempotency_key:"approve-recovery-001",inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
  await act(operator);
  await rpc({action:"complete",batch_id:batch.id,idempotency_key:"complete-recovery-01",evidence_urls:evidence});
  assert.equal((await db.query("select product_id from warehouse.inventory_units")).rows[0].product_id,"base");
  assert.equal((await db.query("select count(*)::int n from private.stock_conversion_lines")).rows[0].n,2);
  assert.equal((await db.query("select count(*)::int n from warehouse.kit_definitions")).rows[0].n,1);
});

test("repeat conversion and recovery cycles preserve the original receipt identity and distinct return lineage", async () => {
  const conversionRecipe=await rpc(recipeInput());
  const recoveryRecipe=await rpc(recipeInput("recovery"));
  const finish=async (batch, key) => {
    await act(quality,"inspect_quality");
    await rpc({action:"approve",batch_id:batch.id,idempotency_key:`cycle-approve-${key}`,inspected_serial_numbers:["WATCH-1"],evidence_urls:evidence});
    await act(operator,"manage_returns");
    await rpc({action:"complete",batch_id:batch.id,idempotency_key:`cycle-complete-${key}`,evidence_urls:evidence});
  };
  let sourceInspection=inspection;
  for (let cycle=1;cycle<=2;cycle++) {
    const forward=await rpc({...createInput(conversionRecipe),idempotency_key:`cycle-forward-batch-${cycle}`,
      units:[{serial_number:"WATCH-1",inspection_id:sourceInspection}]});
    await finish(forward,`forward-${cycle}`);
    await db.exec("update warehouse.inventory_units set status='issued',event_id='event'; update warehouse.inventory_units set status='in_stock',event_id=null");
    await db.query(`insert into warehouse.allocations(id,event_id,product_id,quantity,status) values($1,'event','variant',1,'returned');`,[`cycle-allocation-${cycle}`]);
    await db.query(`insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,serial_numbers,acknowledged_at)
      values($1,'event',gen_random_uuid(),'variant',1,array['WATCH-1'],now())`,[`cycle-allocation-${cycle}`]);
    await db.query(`insert into warehouse.returns(id,source,event_id,actor,lines) values($1,'event','event',$2,$3::jsonb)`,
      [`cycle-return-${cycle}`,operator,JSON.stringify([{allocationId:`cycle-allocation-${cycle}`,productId:"variant",serialNumber:"WATCH-1",quantity:1}])]);
    const returnInspection=(await db.query(`insert into warehouse.quality_inspections(source_type,source_id,product_id,serial_number,location_id,bin_id,quantity,disposition,evidence_urls,inspected_by,inspected_by_email)
      values('return',$1,'variant','WATCH-1','wh','out',1,'accepted',$2::jsonb,$3,'quality@test.invalid') returning id`,[`cycle-return-${cycle}`,JSON.stringify(evidence),quality])).rows[0].id;
    const recover=await rpc({...createInput(recoveryRecipe),idempotency_key:`cycle-recover-batch-${cycle}`,source_bin_id:"out",destination_bin_id:"bin",
      units:[{serial_number:"WATCH-1",inspection_id:returnInspection,return_id:`cycle-return-${cycle}`,allocation_id:`cycle-allocation-${cycle}`,original_conversion_id:forward.id}]});
    await finish(recover,`recovery-${cycle}`);
    if(cycle===1) {
      // A distinct accepted base-SKU return supplies fresh source inspection for
      // the next cycle. This does not exercise the effective intake/Quality RPCs.
      await db.exec("update warehouse.inventory_units set status='issued',event_id='event'; update warehouse.inventory_units set status='in_stock',event_id=null");
      await db.query(`insert into warehouse.returns(id,source,event_id,actor,lines) values('base-return','event','event',$1,'[{"productId":"base","serialNumber":"WATCH-1","quantity":1}]')`,[operator]);
      sourceInspection=(await db.query(`insert into warehouse.quality_inspections(source_type,source_id,product_id,serial_number,location_id,bin_id,quantity,disposition,evidence_urls,inspected_by,inspected_by_email)
        values('return','base-return','base','WATCH-1','wh','bin',1,'accepted',$1::jsonb,$2,'quality@test.invalid') returning id`,[JSON.stringify(evidence),quality])).rows[0].id;
    }
  }
  assert.deepEqual((await db.query("select id,serial_number,product_id from warehouse.inventory_units")).rows,[{id:"unit",serial_number:"WATCH-1",product_id:"base"}]);
  assert.equal((await db.query("select count(*)::int n from private.stock_conversion_lines")).rows[0].n,4);
  assert.equal((await db.query("select count(distinct return_id)::int n from private.stock_conversion_lines")).rows[0].n,2);
  assert.equal((await db.query("select product_id from warehouse.procurement_receipt_serial_claims")).rows[0].product_id,"base");
});
