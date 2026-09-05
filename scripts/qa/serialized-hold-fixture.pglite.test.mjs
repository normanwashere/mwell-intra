import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { functionDefinition, installActualQualityChain } from "../quality-inspection-verifier-fixture.mjs";

const require = createRequire(new URL("../../apps/shell/package.json", import.meta.url));
const ts = require("typescript");
const source = await readFile(new URL("./full-intra-live-e2e.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("runner.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function find(root, predicate) {
  if (predicate(root)) return root;
  let result;
  ts.forEachChild(root, child => { result ??= find(child, predicate); });
  return result;
}
const serialExpression = find(ast, node => ts.isPropertyAssignment(node) && node.name.getText(ast) === "serializedIssueSerial").initializer.getText(ast);
const fixtureSerial = marker => new Function("marker", `return ${serialExpression}`)(marker);
function rpcPayload(variable, fixture) {
  const declaration = find(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === variable);
  assert.ok(declaration && ts.isAwaitExpression(declaration.initializer));
  const call = declaration.initializer.expression;
  assert.equal(call.expression.getText(ast), "callRpcAsBrowserUser");
  return new Function("fixture", `return (${call.arguments[3].getText(ast)})`)(fixture);
}
const sql = async name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const legacy = await sql("20260710160000_warehouse_w1_quality_and_approval_rpcs.sql");
const normalization = await sql("20260826160000_harden_serial_custody_concurrency.sql");
const fix = await sql("20260905203219_canonical_raw_receipt_inspection_serial_identity.sql");
const receiveSql = await sql("20260812220000_task8_database_authority_remediation.sql");
const independence = await sql("20260815154910_operations_launch_blocker_slice.sql");
const releaseSql = await sql("20260714175318_single_po_receipt_authority.sql");
const releaseWrapperSql = await sql("20260813203240_task_1_database_authority_remediation.sql");
const atpSql = await sql("20260718201000_refresh_atp_inside_product_lock.sql");
const receiver = "11111111-1111-4111-8111-111111111111";
const inspector = "22222222-2222-4222-8222-222222222222";

// Execute the production method and row mappers, substituting only transport/data loading.
const repositorySource = await readFile(new URL("../../packages/data-kit/src/supabase/SupabaseRepository.ts", import.meta.url), "utf8");
const repositoryAst = ts.createSourceFile("repo.ts", repositorySource, ts.ScriptTarget.Latest, true);
const receiveMethod = find(repositoryAst, n => ts.isMethodDeclaration(n) && n.name.getText(repositoryAst) === "receiveStock");
const mapperSource = await readFile(new URL("../../packages/data-kit/src/supabase/mappers.ts", import.meta.url), "utf8");
const mapperAst = ts.createSourceFile("mappers.ts", mapperSource, ts.ScriptTarget.Latest, true);
const mapperCode = ["unitToRow", "lotToRow", "movementToRow", "rowToReceipt"].map(name =>
  find(mapperAst, n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(mapperAst).replace(/^export /, "")).join("\n");
const receiveFromRepository = new Function(ts.transpileModule(`${mapperCode}\nreturn ({${receiveMethod.getText(repositoryAst)}}).receiveStock;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)();

async function repositoryReceipt(db, overrides = {}) {
  await seed(db, "repository-reset");
  await db.exec(`truncate warehouse.inventory_units,warehouse.receipts,warehouse.movements;
    select set_config('request.jwt.claim.sub','${receiver}',false)`);
  const receipt = await receiveFromRepository.call({
    findReceiptById: async () => undefined,
    getData: async () => ({ products: [{ id: "product", sku: "SER", serialized: true }] }),
    callRpc: async (name, payload) => {
      assert.equal(name, "receive_stock");
      assert.equal(payload.units[0].status, "pending_inspection");
      return (await db.query("select warehouse.receive_stock($1::jsonb) result", [JSON.stringify(payload)])).rows[0].result;
    },
  }, {
    idempotencyKey: "repository-pending-case", locationId: "warehouse", actor: "receiver@test",
    lines: [{ productId: "product", quantity: 1, serialNumbers: ["Raw-Mixed-Serial"], binId: "bin" }],
    evidenceUrls: ["test-evidence"], receiptException: { type: "non_po", reason: "Authorized exception", evidenceUrls: ["test-evidence"] },
    ...overrides,
  });
  await db.exec(`select set_config('request.jwt.claim.sub','${inspector}',false)`);
  return { source_type: "receipt", source_id: receipt.id, product_id: "product", serial_number: "raw-MIXED-serial",
    quantity: 1, disposition: "accepted", reason: "Independent QC", evidence_urls: [], idempotency_key: "repository-qc-case" };
}

async function database() {
  const db = new PGlite();
  // Surrounding services are minimal; serial normalization and the complete raw-receipt QC body are production SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema warehouse; create schema auth; create schema core;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function core.has_cap(text,text) returns boolean language sql as $$ select true $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$
      select auth.uid() is not null and current_setting('test.authorized',true) is distinct from 'false' $$;
    create table core.profiles(id uuid,email text);
    insert into core.profiles values ('${receiver}','receiver@test'),('${inspector}','inspector@test');
    create function warehouse.authoritative_actor() returns text language sql as $$ select email from core.profiles where id=auth.uid() $$;
    create function warehouse.force_actor_on_object(jsonb,text) returns jsonb language sql as $$ select $1 || jsonb_build_object('actor',$2) $$;
    create function warehouse.force_actor_on_array(jsonb,text) returns jsonb language sql as $$ select $1 $$;
    create function warehouse.register_evidence_docs(text,text,jsonb) returns void language sql as $$ select $$;
    create function private.begin_idempotent_command(text,text,jsonb) returns jsonb language sql as $$
      select jsonb_build_object('replayed',false,'command_id',gen_random_uuid()) $$;
    create function private.finish_idempotent_command(uuid,jsonb) returns jsonb language sql as $$ select $2 $$;
    create table warehouse.procurement_receipt_serial_claims(serial_number text,status text,outcome text,product_id text);
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text,
      location_id text,status text,bin_id text,lot_id text);
    create unique index warehouse_inventory_unit_serial_normalized_uq on warehouse.inventory_units(upper(btrim(serial_number)));
    create table warehouse.receipts(id text primary key,location_id text,lines jsonb,quality_status text,
      procurement_po_id text,received_by uuid,actor text,evidence_urls jsonb,created_at timestamptz,supplier_id text);
    create table warehouse.products(id text,serialized boolean);
    create table warehouse.command_log(command_name text,response jsonb);
    create table warehouse.lots(id text);
    create table warehouse.movements(id text,type text,product_id text,quantity integer,to_location_id text,
      reference text,evidence_urls jsonb,actor text,created_at timestamptz);
    create table warehouse.returns(id text,lines jsonb);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer,
      unique(product_id,location_id,bin_id,lot_id));
    create table warehouse.quality_inspections(id uuid default gen_random_uuid(),source_type text,source_id text,
      product_id text,lot_id text,serial_number text,location_id text,bin_id text,quantity integer,
      disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text,
      inspected_at timestamptz,procurement_po_line_id text);
    create table warehouse.inventory_holds(id uuid default gen_random_uuid(),inspection_id uuid,product_id text,
      location_id text,bin_id text,lot_id text,serial_number text,quantity integer,reason text,
      evidence_urls jsonb,created_by uuid,status text default 'active',released_by uuid,released_at timestamptz,
      release_reason text,release_evidence_urls jsonb);
    create table warehouse.exceptions(id uuid default gen_random_uuid(),exception_type text,severity text,
      source_type text,source_id text,status text,due_at timestamptz,created_by uuid,resolution text,evidence_urls jsonb);
    create table core.activity_log(module text,entity_type text,entity_id uuid,action text,actor uuid,detail jsonb);
  `);
  await db.exec(functionDefinition(normalization, "private.lock_serial_custody_identity"));
  await db.exec(functionDefinition(normalization, "private.normalize_inventory_unit_serial"));
  await db.exec(`create trigger warehouse_inventory_unit_serial_normalize
    before insert or update of serial_number,product_id,status on warehouse.inventory_units
    for each row execute function private.normalize_inventory_unit_serial();`);
  await db.exec(functionDefinition(legacy, "private.warehouse_inspect_quality"));
  await db.exec(functionDefinition(receiveSql, "warehouse.receive_stock"));
  await db.exec(functionDefinition(independence, "private.stamp_receipt_actor"));
  await db.exec(functionDefinition(independence, "private.enforce_independent_receipt_inspection"));
  await db.exec(`create trigger stamp_receipt before insert on warehouse.receipts
    for each row execute function private.stamp_receipt_actor();
    create trigger independent_inspector before insert or update of disposition on warehouse.quality_inspections
    for each row execute function private.enforce_independent_receipt_inspection();`);
  await installActualQualityChain(db);
  await db.exec(`create schema procurement;
    create table procurement.purchase_orders(id text,status text,updated_at timestamptz);
    create table procurement.purchase_order_lines(id text,purchase_order_id text,receiving_status text,
      quantity integer,received_quantity integer);
    create table warehouse.procurement_receipt_exception_lines(po_line_id text,active boolean);
    create table warehouse.allocations(product_id text,quantity integer,status text);
    alter table warehouse.exceptions add column updated_at timestamptz;`);
  await db.exec(functionDefinition(releaseSql, "private.warehouse_release_quality_hold"));
  await db.exec(functionDefinition(releaseWrapperSql, "warehouse.release_quality_hold"));
  await db.exec(functionDefinition(atpSql, "warehouse.available_to_promise"));
  await db.exec(await sql("20260905180530_authorize_accepted_provisional_quality_hold_release.sql"));
  await db.exec(`create trigger protect_provisional_hold before update of status on warehouse.inventory_holds
    for each row execute function private.protect_provisional_quality_hold()`);
  return db;
}
async function seed(db, marker, serial = fixtureSerial(marker)) {
  const fixture = { marker, locationId: "warehouse", ids: {
    serializedIssueSerial: serial, serializedIssueUnit: "unit", serializedIssueProduct: "product",
    serializedIssueReceipt: "receipt", vendor: "vendor",
  } };
  const receive = rpcPayload("serializedIssueReceipt", fixture);
  const hold = rpcPayload("serializedHoldResult", fixture);
  await db.exec(`truncate warehouse.inventory_units,warehouse.receipts,warehouse.quality_inspections,warehouse.inventory_holds,warehouse.exceptions,core.activity_log,warehouse.movements;
    select set_config('request.jwt.claim.sub','${receiver}',false);
    select set_config('test.authorized','true',false);`);
  await db.query("select warehouse.receive_stock($1::jsonb)", [JSON.stringify(receive)]);
  await db.exec(`select set_config('request.jwt.claim.sub','${inspector}',false)`);
  return hold;
}
const inspect = (db, payload) => db.query("select warehouse.inspect_quality($1::jsonb) result", [JSON.stringify(payload)]);

test("old mixed-case fixture reproduces CI156 source-location rejection with the real SQL guard", async () => {
  const db = await database();
  try {
    const marker = "QA-20260906-00003C1F-desktop-1440";
    const hold = await seed(db, marker, `${marker}-SERIAL-HELD`);
    assert.equal((await db.query("select serial_number from warehouse.inventory_units")).rows[0].serial_number, hold.serial_number.toUpperCase());
    await assert.rejects(inspect(db, hold), /Serialized unit is not available at the source location/);
    assert.equal((await db.query("select count(*)::int n from warehouse.inventory_holds")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("forward migration resolves mixed-case raw receipt through the actual public QC chain without rewriting evidence", async () => {
  const db = await database();
  try {
    const before = (await db.query("select oid::regprocedure::text signature,prosrc from pg_proc where oid in ('warehouse.inspect_quality(jsonb)'::regprocedure,'private.warehouse_inspect_quality_v2(jsonb)'::regprocedure,'private.warehouse_inspect_quality_v3(jsonb)'::regprocedure) order by 1")).rows;
    await db.exec(fix);
    assert.deepEqual((await db.query("select oid::regprocedure::text signature,prosrc from pg_proc where oid in ('warehouse.inspect_quality(jsonb)'::regprocedure,'private.warehouse_inspect_quality_v2(jsonb)'::regprocedure,'private.warehouse_inspect_quality_v3(jsonb)'::regprocedure) order by 1")).rows, before);
    for (const viewport of ["desktop-1440", "mobile-390"]) {
      const marker = `QA-20260906-00003C1F-${viewport}`;
      const payload = await seed(db, marker);
      assert.match(payload.serial_number, /desktop|mobile/, "live probe must remain mixed case");
      const evidence = (await db.query("select lines from warehouse.receipts")).rows;
      const { rows: [{ result }] } = await inspect(db, payload);
      assert.equal(result.hold.serial_number, payload.serial_number.toUpperCase());
      assert.equal(result.hold.status, "active");
      assert.equal(result.hold.location_id, "warehouse");
      assert.equal(result.hold.product_id, "product");
      assert.equal(result.hold.quantity, 1);
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "in_stock");
      assert.deepEqual((await db.query("select lines from warehouse.receipts")).rows, evidence);
      await assert.rejects(inspect(db, { ...payload, serial_number: payload.serial_number.toUpperCase(), idempotency_key: "different-command" }), /remaining source quantity/);
    }
  } finally { await db.close(); }
});

test("canonical matching preserves location, status, membership, quantity and independent actor rejections", async () => {
  const db = await database();
  try {
    await db.exec(fix);
    const cases = [
      ["update warehouse.inventory_units set location_id='elsewhere'", {}, /not available at the source location/],
      ["update warehouse.inventory_units set status='issued'", {}, /not available at the source location/],
      ["", { serial_number: "ANOTHER-SERIAL" }, /not part of the source record/],
      ["insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status) values('foreign','product','FOREIGN','warehouse','in_stock')",
        { serial_number: "foreign" }, /not part of the source record/],
      ["", { quantity: 2 }, /exactly one unit/],
      ["", { bin_id: "other-bin" }, /not part of the source record|bin does not match/],
      ["", { reason: "" }, /reason is required/],
      ["", { serial_number: "   " }, /Serial identity cannot be blank/],
      [`select set_config('request.jwt.claim.sub','${receiver}',false)`, {}, /cannot inspect the same receipt/],
      ["select set_config('request.jwt.claim.sub','',false)", {}, /Not authorized/],
      ["select set_config('test.authorized','false',false)", {}, /Not authorized/],
    ];
    for (const [mutation, overrides, error] of cases) {
      const payload = await seed(db, "QA-20260906-00003C1F-desktop-1440");
      if (mutation) await db.exec(mutation);
      await assert.rejects(inspect(db, { ...payload, ...overrides }), error);
      assert.equal((await db.query("select count(*)::int n from warehouse.inventory_holds")).rows[0].n, 0);
    }
  } finally { await db.close(); }
});

test("repository pending receipt requires independent exact-custody QC; completed QC preserves hold-based quarantine", async () => {
  const db = await database();
  try {
    const old = await repositoryReceipt(db);
    await assert.rejects(inspect(db, old), /not part of the source record|not available at the source location/);
    await db.exec(fix);
    for (const disposition of ["accepted", "hold", "damaged", "vendor_return", "unavailable"]) {
      const payload = await repositoryReceipt(db);
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "pending_inspection");
      const evidence = (await db.query("select lines from warehouse.receipts")).rows;
      const result = (await inspect(db, { ...payload, disposition })).rows[0].result;
      assert.equal(result.inspection.disposition, disposition);
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "in_stock");
      assert.equal((await db.query("select warehouse.available_to_promise('product') n")).rows[0].n,
        disposition === "accepted" ? 1 : 0);
      assert.equal((await db.query("select count(*)::int n from warehouse.inventory_holds where status='active'")).rows[0].n,
        disposition === "accepted" ? 0 : 1);
      assert.deepEqual((await db.query("select lines from warehouse.receipts")).rows, evidence);
    }
    for (const [mutation, error] of [
      [`select set_config('request.jwt.claim.sub','${receiver}',false)`, /cannot inspect the same receipt/],
      ["update warehouse.inventory_units set location_id='wrong'", /not available at the source location/],
      ["update warehouse.inventory_units set bin_id='wrong'", /bin does not match/],
      ["select set_config('request.jwt.claim.sub','',false)", /Not authorized/],
    ]) {
      const payload = await repositoryReceipt(db);
      await db.exec(mutation);
      await assert.rejects(inspect(db, payload), error);
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "pending_inspection");
      assert.equal((await db.query("select count(*)::int n from warehouse.quality_inspections")).rows[0].n, 0);
    }
    for (const override of [{ serial_number: "foreign" }, { lot_id: "wrong-lot" }]) {
      const payload = await repositoryReceipt(db);
      await assert.rejects(inspect(db, { ...payload, ...override }), /not part of the source record|lot does not match/);
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "pending_inspection");
    }
    const held = await repositoryReceipt(db);
    await db.exec(`insert into warehouse.inventory_holds(product_id,location_id,bin_id,serial_number,quantity,status,reason)
      values('product','warehouse','bin','Raw-Mixed-Serial',1,'active','Separate quarantine')`);
    await inspect(db, held);
    assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "in_stock");
    assert.equal((await db.query("select warehouse.available_to_promise('product') n")).rows[0].n, 0);
    assert.equal((await db.query("select status from warehouse.inventory_holds")).rows[0].status, "active");
    await assert.rejects(repositoryReceipt(db, { lines: [{ productId: "product", quantity: 2,
      serialNumbers: ["Case-Duplicate", "CASE-DUPLICATE"], binId: "bin" }] }), /unique constraint/);
    assert.equal((await db.query("select count(*)::int n from warehouse.receipts")).rows[0].n, 0);
    await assert.rejects(repositoryReceipt(db, { receiptException: undefined }), /evidenced receiving exception/);
    const rollback = await repositoryReceipt(db);
    await db.exec(`create function private.reject_test_hold() returns trigger language plpgsql as $$
      begin raise exception 'Simulated hold persistence failure'; end $$;
      create trigger reject_test_hold before insert on warehouse.inventory_holds
      for each row execute function private.reject_test_hold()`);
    await assert.rejects(inspect(db, { ...rollback, disposition: "hold" }), /Simulated hold persistence failure/);
    assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "pending_inspection");
    assert.equal((await db.query("select warehouse.available_to_promise('product') n")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from warehouse.quality_inspections")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("actual hold release restores ATP after raw QC without stranded pending units or self-release", async () => {
  const db = await database();
  const releaser = "33333333-3333-4333-8333-333333333333";
  try {
    await db.exec(fix);
    await db.exec(`insert into core.profiles values('${releaser}','releaser@test')`);
    for (const separateHold of [false, true]) {
      const payload = await repositoryReceipt(db);
      let holdId;
      if (separateHold) {
        // A separate existing inspection's quarantine must survive receipt acceptance.
        const qualityId = (await db.query(`insert into warehouse.quality_inspections(source_type,source_id,
          product_id,quantity,disposition,serial_number,location_id,bin_id)
          values('return','separate-return','product',1,'hold','RAW-MIXED-SERIAL','warehouse','bin') returning id`)).rows[0].id;
        holdId = (await db.query(`insert into warehouse.inventory_holds(inspection_id,product_id,location_id,
          bin_id,serial_number,quantity,status,reason,created_by)
          values($1,'product','warehouse','bin','RAW-MIXED-SERIAL',1,'active','Separate quarantine',$2) returning id`,
          [qualityId, inspector])).rows[0].id;
        await inspect(db, payload);
      } else {
        holdId = (await inspect(db, { ...payload, disposition: "hold" })).rows[0].result.hold.id;
      }
      const release = { hold_id: holdId, target_disposition: "accepted", reason: "Independent release review",
        evidence_urls: ["release-evidence"], idempotency_key: "release-pending-case" };
      const runRelease = () => db.query("select warehouse.release_quality_hold($1::jsonb)", [JSON.stringify(release)]);
      assert.equal((await db.query("select warehouse.available_to_promise('product') n")).rows[0].n, 0);
      await assert.rejects(runRelease(), /cannot release their own hold/);
      await db.exec("select set_config('request.jwt.claim.sub','',false)");
      await assert.rejects(runRelease(), /Not authorized/);
      assert.equal((await db.query("select status from warehouse.inventory_holds where id=$1", [holdId])).rows[0].status, "active");
      await db.exec(`select set_config('request.jwt.claim.sub','${releaser}',false)`);
      await runRelease();
      assert.equal((await db.query("select status from warehouse.inventory_holds where id=$1", [holdId])).rows[0].status, "released");
      assert.equal((await db.query("select status from warehouse.inventory_units")).rows[0].status, "in_stock");
      assert.equal((await db.query("select warehouse.available_to_promise('product') n")).rows[0].n, 1);
    }
  } finally { await db.close(); }
});

test("case duplicates are rejected at inventory insertion and ambiguous historical receipt matching", async () => {
  const db = await database();
  try {
    await db.exec(fix);
    const payload = await seed(db, "QA-20260906-00003C1F-desktop-1440");
    await assert.rejects(db.query(`insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status)
      values('duplicate','product',$1,'warehouse','in_stock')`, [payload.serial_number.toLowerCase()]), /unique constraint/);
    const lines = [{ productId: "product", quantity: 2, serialNumbers: [payload.serial_number, payload.serial_number.toUpperCase()] }];
    await db.query("update warehouse.receipts set lines=$1", [JSON.stringify(lines)]);
    await assert.rejects(inspect(db, payload), /Duplicate canonical serial identity/);
    assert.deepEqual((await db.query("select lines from warehouse.receipts")).rows[0].lines, lines);
    assert.equal((await db.query("select count(*)::int n from warehouse.inventory_holds")).rows[0].n, 0);

    // Real raw receiving is atomic when two newly supplied units differ only by case.
    await db.exec("truncate warehouse.inventory_units,warehouse.receipts,warehouse.movements");
    await db.exec(`select set_config('request.jwt.claim.sub','${receiver}',false)`);
    const unit = { product_id: "product", location_id: "warehouse", status: "in_stock" };
    await assert.rejects(db.query("select warehouse.receive_stock($1::jsonb)", [JSON.stringify({
      units: [{ ...unit, id: "a", serial_number: "Case-Serial" }, { ...unit, id: "b", serial_number: "CASE-SERIAL" }],
      receipt: { id: "duplicate-receipt", location_id: "warehouse", lines, evidence_urls: [] },
    })]), /unique constraint/);
    assert.equal((await db.query("select count(*)::int n from warehouse.inventory_units")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from warehouse.receipts")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("canonical fallback counts legacy inspections and does not delete a different pending serial", async () => {
  const db = await database();
  try {
    await db.exec(fix);
    const payload = await seed(db, "QA-20260906-00003C1F-desktop-1440");
    await db.query(`insert into warehouse.quality_inspections(source_type,source_id,product_id,quantity,
      disposition,serial_number,location_id) values('receipt','receipt','product',1,'accepted',$1,'warehouse')`, [payload.serial_number.toLowerCase()]);
    const history = (await db.query("select to_jsonb(i) record from warehouse.quality_inspections i")).rows;
    await assert.rejects(inspect(db, payload), /remaining source quantity/);
    assert.deepEqual((await db.query("select to_jsonb(i) record from warehouse.quality_inspections i")).rows, history);
    await seed(db, "QA-20260906-00003C1F-desktop-1440");
    await db.exec(`insert into warehouse.quality_inspections(source_type,source_id,product_id,quantity,
      disposition,serial_number,location_id) values('receipt','receipt','product',1,'pending','OTHER-SERIAL','warehouse')`);
    await inspect(db, { ...payload, serial_number: `  ${payload.serial_number.toLowerCase()}  ` });
    assert.equal((await db.query("select count(*)::int n from warehouse.quality_inspections where serial_number='OTHER-SERIAL' and disposition='pending'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("PO v3 still requires exact line, serial and bin and denies self inspection", async () => {
  const db = await database();
  try {
    await db.exec(fix);
    const payload = await seed(db, "QA-20260906-00003C1F-desktop-1440");
    await db.exec("update warehouse.receipts set procurement_po_id='po'");
    await db.query(`insert into warehouse.quality_inspections(source_type,source_id,product_id,quantity,
      disposition,reason,serial_number,location_id,procurement_po_line_id)
      values('receipt','receipt','product',1,'pending','Awaiting independent quality inspection',$1,'warehouse','line')`, [payload.serial_number]);
    await db.exec(`insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,serial_number,status,reason)
      select id,product_id,location_id,quantity,serial_number,'active','Awaiting independent quality inspection' from warehouse.quality_inspections`);
    for (const [override, error] of [
      [{}, /PO-line identity is required/],
      [{ procurement_po_line_id: "wrong" }, /Actionable provisional receipt inspection not found/],
      [{ procurement_po_line_id: "line", serial_number: "FOREIGN" }, /Actionable provisional receipt inspection not found/],
      [{ procurement_po_line_id: "line", bin_id: "wrong" }, /Actionable provisional receipt inspection not found/],
    ]) await assert.rejects(inspect(db, { ...payload, ...override }), error);
    await db.exec(`select set_config('request.jwt.claim.sub','${receiver}',false)`);
    await assert.rejects(inspect(db, { ...payload, procurement_po_line_id: "line" }), /cannot inspect the same receipt/);
    await db.exec(`select set_config('request.jwt.claim.sub','${inspector}',false)`);
    const { rows: [{ result }] } = await inspect(db, { ...payload, procurement_po_line_id: "line", serial_number: payload.serial_number.toLowerCase() });
    assert.equal(result.inspection.disposition, "hold");
    assert.equal(result.hold.status, "active");
  } finally { await db.close(); }
});
