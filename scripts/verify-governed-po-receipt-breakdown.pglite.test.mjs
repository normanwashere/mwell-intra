import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260826015244_governed_po_receipt_breakdown.sql",
  import.meta.url,
);
const convergenceMigrationUrl = new URL(
  "../supabase/migrations/20260826032845_converge_receipt_quality_custody.sql",
  import.meta.url,
);
const serialCustodyMigrationUrl = new URL(
  "../supabase/migrations/20260826160000_harden_serial_custody_concurrency.sql",
  import.meta.url,
);
const receiptAuthorityUrl = new URL(
  "../supabase/migrations/20260714175318_single_po_receipt_authority.sql",
  import.meta.url,
);
const receiptConvergenceUrl = new URL(
  "../supabase/migrations/20260717143000_task3_receipt_authority_forward_convergence.sql",
  import.meta.url,
);
const actorId = "11111111-1111-4111-8111-111111111111";
const supervisorId = "33333333-3333-4333-8333-333333333333";

function functionDefinition(source, signature) {
  const start = source.indexOf(`create or replace function ${signature}`);
  assert.notEqual(start, -1, `${signature} definition must exist`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${signature} definition must terminate`);
  return source.slice(start, end + 4);
}

async function createDatabase({
  applyConvergence = true,
  applySerialCustodyHardening = true,
} = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema private;
    create schema procurement;
    create schema warehouse;

    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable
      as $$ select jsonb_build_object(
        'sub', current_setting('request.jwt.claim.sub', true),
        'email', current_setting('request.jwt.claim.email', true)
      ) $$;
    create function auth.role() returns text language sql stable
      as $$ select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated') $$;
    create function core.has_cap(text, text) returns boolean language sql stable
      as $$ select coalesce(current_setting('test.has_cap', true), 'on') = 'on' $$;
    create function core.has_live_cap(text, text) returns boolean language sql stable
      as $$ select coalesce(current_setting('test.has_live_cap', true), 'on') = 'on' $$;
    create function private.assert_goods_procurement_po(text) returns void
      language plpgsql as $$ begin end $$;

    select set_config('request.jwt.claim.sub', '${actorId}', false);
    select set_config('request.jwt.claim.email', 'receiver@mwell.test', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    select set_config('test.has_cap', 'on', false);
    select set_config('test.has_live_cap', 'on', false);

    create table auth.users (id uuid primary key, email text not null);
    insert into auth.users(id,email) values
      ('${actorId}','receiver@mwell.test'),
      ('${supervisorId}','supervisor@mwell.test');
    create table core.profiles (id uuid primary key, email text not null);
    insert into core.profiles(id,email) values
      ('${actorId}','receiver@mwell.test'),
      ('${supervisorId}','supervisor@mwell.test');

    create table warehouse.command_log (
      id uuid primary key default gen_random_uuid(),
      actor_id uuid not null,
      command_name text not null,
      idempotency_key text not null,
      payload_hash text not null,
      response jsonb,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      unique(actor_id, command_name, idempotency_key)
    );
    create function private.warehouse_payload_hash(payload jsonb) returns text
      language sql immutable as $$ select md5(payload::text) $$;
    create function private.begin_idempotent_command(
      p_command_name text, p_idempotency_key text, p_payload jsonb
    ) returns jsonb language plpgsql as $$
    declare v_id uuid; v_existing warehouse.command_log; v_hash text;
    begin
      v_hash := private.warehouse_payload_hash(p_payload);
      select * into v_existing from warehouse.command_log
       where actor_id=auth.uid() and command_name=p_command_name
         and idempotency_key=p_idempotency_key for update;
      if found then
        if v_existing.payload_hash <> v_hash then
          raise exception 'Idempotency key was reused with a different payload';
        end if;
        if v_existing.response is null then
          raise exception 'Idempotent command is still in progress';
        end if;
        return jsonb_build_object('command_id',v_existing.id,'replayed',true,
          'response',v_existing.response);
      end if;
      insert into warehouse.command_log(actor_id, command_name, idempotency_key, payload_hash)
      values(auth.uid(), p_command_name, p_idempotency_key, v_hash) returning id into v_id;
      return jsonb_build_object('command_id', v_id, 'replayed', false);
    end $$;
    create function private.finish_idempotent_command(p_command_id uuid, p_response jsonb)
      returns jsonb language plpgsql as $$
    begin
      update warehouse.command_log set response=p_response, completed_at=now()
      where id=p_command_id;
      return p_response;
    end $$;

    create table procurement.purchase_orders (
      id text primary key,
      status text not null,
      core_vendor_id uuid not null,
      vendor_name text,
      updated_at timestamptz default now()
    );
    create table procurement.purchase_order_lines (
      id text primary key,
      purchase_order_id text not null,
      description text not null,
      quantity integer not null,
      received_quantity integer not null default 0,
      receiving_status text not null default 'open',
      warehouse_product_id text
    );
    create table warehouse.products (
      id text primary key,
      serialized boolean not null default false,
      expiry_tracked boolean not null default false,
      unit_cost numeric not null default 0
    );
    create table warehouse.locations (
      id text primary key, type text not null, active boolean not null default true
    );
    create table warehouse.storage_areas (
      id text primary key, location_id text not null, active boolean not null default true
    );
    create table warehouse.operation_types (
      id uuid primary key default gen_random_uuid(), code text not null, active boolean not null
    );
    create table warehouse.operation_routes (
      id uuid primary key default gen_random_uuid(),
      operation_type_id uuid not null,
      active boolean not null,
      source_location_types text[] not null,
      destination_location_types text[] not null,
      requires_evidence boolean not null default true,
      created_at timestamptz not null default now()
    );
    create table warehouse.suppliers (
      id text primary key, name text not null, lead_time_days integer not null
    );
    create table warehouse.inventory_units (
      id text primary key,
      product_id text not null,
      serial_number text not null,
      location_id text not null,
      bin_id text,
      status text not null,
      unique(product_id, serial_number)
    );
    create table warehouse.stock_levels (
      product_id text not null,
      location_id text not null,
      bin_id text,
      lot_id text,
      quantity integer not null
    );
    create table warehouse.movements (
      id text primary key,
      type text not null,
      product_id text not null,
      quantity integer not null,
      to_location_id text,
      to_bin_id text,
      reason text,
      reference text,
      evidence_urls jsonb not null,
      actor text not null,
      created_at timestamptz not null default now()
    );
    create table warehouse.receipts (
      id text primary key,
      supplier_id text,
      location_id text not null,
      lines jsonb not null,
      evidence_urls jsonb not null,
      actor text not null,
      created_at timestamptz not null default now(),
      operation_route_id uuid,
      procurement_po_id text,
      quality_status text not null default 'pending',
      received_by uuid
    );
    create table warehouse.quality_inspections (
      id uuid primary key default gen_random_uuid(),
      source_type text not null,
      source_id text not null,
      product_id text not null,
      location_id text not null,
      bin_id text,
      lot_id text,
      serial_number text,
      quantity integer not null,
      disposition text not null,
      reason text,
      evidence_urls jsonb not null,
      inspected_by uuid not null,
      inspected_by_email text not null,
      inspected_at timestamptz not null default now(),
      procurement_po_line_id text
    );
    create table warehouse.inventory_holds (
      id uuid primary key default gen_random_uuid(),
      inspection_id uuid not null,
      product_id text not null,
      location_id text not null,
      bin_id text,
      lot_id text,
      serial_number text,
      quantity integer not null,
      status text not null,
      reason text not null,
      evidence_urls jsonb not null,
      created_by uuid not null,
      created_at timestamptz not null default now(),
      released_by uuid,
      released_at timestamptz,
      release_reason text,
      release_evidence_urls jsonb not null default '[]'::jsonb
    );
    create table warehouse.exceptions (
      id uuid primary key default gen_random_uuid(),
      exception_type text not null,
      severity text not null,
      source_type text not null,
      source_id text not null,
      status text not null,
      resolution text,
      evidence_urls jsonb not null default '[]'::jsonb,
      owner_id uuid,
      created_by uuid not null,
      updated_at timestamptz default now()
    );
    create table warehouse.procurement_receipt_exception_decisions (
      id uuid primary key default gen_random_uuid(),
      receipt_id text not null unique,
      purchase_order_id text not null,
      exception_id uuid not null unique,
      requested_disposition text not null,
      request_reason text not null,
      request_evidence_urls jsonb not null,
      facts jsonb not null,
      status text not null default 'pending',
      requested_by uuid not null,
      requested_at timestamptz not null default now(),
      decision text,
      decision_reason text,
      decision_evidence_urls jsonb not null default '[]'::jsonb,
      decided_by uuid,
      decided_at timestamptz
    );
    create table warehouse.procurement_receipt_exception_lines (
      decision_id uuid not null,
      po_line_id text not null,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      released_at timestamptz,
      primary key(decision_id, po_line_id)
    );
    create unique index procurement_receipt_exception_one_active_line
      on warehouse.procurement_receipt_exception_lines(po_line_id) where active;
    create table warehouse.procurement_receipt_excess_custody (
      id uuid primary key default gen_random_uuid(),
      decision_id uuid not null,
      receipt_id text not null,
      po_line_id text not null,
      product_id text,
      ordered_quantity integer not null,
      excess_quantity integer not null,
      status text not null default 'pending',
      resolution_reason text,
      resolution_evidence_urls jsonb not null default '[]'::jsonb,
      resolved_by uuid,
      resolved_at timestamptz,
      approved_amendment_id uuid
    );
    create table procurement.purchase_order_amendments (
      id uuid primary key default gen_random_uuid(),
      purchase_order_id text not null,
      po_line_id text not null,
      previous_quantity integer not null,
      amended_quantity integer not null,
      status text not null
    );
    create table warehouse.unidentified_receipt_custody (
      decision_id uuid not null,
      receipt_id text not null,
      po_line_id text not null,
      observed_description text not null,
      observed_identifiers jsonb not null,
      quantity integer not null,
      identified_product_id text,
      identified_by uuid,
      identified_at timestamptz,
      primary key(decision_id, po_line_id)
    );
    create table core.activity_log (
      module text, entity_type text, entity_id text, action text, actor uuid, detail jsonb
    );

    create function private.stamp_receipt_actor() returns trigger language plpgsql as $$
    begin
      new.received_by := auth.uid();
      new.actor := coalesce(auth.jwt()->>'email', auth.uid()::text);
      return new;
    end $$;
    create trigger warehouse_receipt_actor_stamp before insert on warehouse.receipts
      for each row execute function private.stamp_receipt_actor();

    create function private.enforce_independent_receipt_inspection()
      returns trigger language plpgsql as $$
    declare v_received_by uuid;
    begin
      if current_setting('warehouse.defer_independent_receipt_inspection', true) = 'on' then
        return new;
      end if;
      if ((tg_op='INSERT' and new.disposition<>'pending') or
          (tg_op='UPDATE' and old.disposition='pending' and new.disposition<>'pending')) then
        new.inspected_by := auth.uid();
        new.inspected_by_email := coalesce(auth.jwt()->>'email', auth.uid()::text);
        select received_by into v_received_by from warehouse.receipts where id=new.source_id;
        if new.source_type='receipt' and v_received_by=new.inspected_by then
          raise exception 'The receipt actor cannot inspect the same receipt';
        end if;
      end if;
      return new;
    end $$;
    create trigger warehouse_independent_receipt_inspection before insert
      on warehouse.quality_inspections for each row
      execute function private.enforce_independent_receipt_inspection();
    create trigger warehouse_independent_receipt_inspection_update before update of disposition
      on warehouse.quality_inspections for each row
      execute function private.enforce_independent_receipt_inspection();

    create function private.lock_warehouse_products(text[]) returns void
      language plpgsql as $$ begin end $$;
    create function private.warehouse_resolve_procurement_po_exception_v3(payload jsonb)
      returns jsonb language sql as $$ select jsonb_build_object('legacy_resolver', true) $$;
    create function private.warehouse_resolve_procurement_po_exception(payload jsonb)
      returns jsonb language sql as $$
        select private.warehouse_resolve_procurement_po_exception_v3(payload)
      $$;
    create function private.warehouse_inspect_quality_v2(payload jsonb)
      returns jsonb language sql as $$
        select jsonb_build_object('delegated', true, 'source_type', payload->>'source_type')
      $$;
    create function warehouse.resolve_procurement_po_exception(payload jsonb)
      returns jsonb language sql as $$
        select private.warehouse_resolve_procurement_po_exception(payload)
      $$;
    create function private.warehouse_resolve_procurement_receipt_excess(payload jsonb)
      returns jsonb language plpgsql as $$
    declare v_custody record; v_decision record; v_started jsonb; v_command_id uuid;
      v_response jsonb;
    begin
      if not core.has_cap('warehouse','resolve_exceptions')
         or not core.has_cap('warehouse','release_quality_hold') then
        raise exception 'Not authorized: governed excess receipt disposition';
      end if;
      v_started:=private.begin_idempotent_command(
        'resolve_procurement_receipt_excess',payload->>'idempotency_key',payload
      );
      if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
      v_command_id:=(v_started->>'command_id')::uuid;
      select * into v_custody from warehouse.procurement_receipt_excess_custody
       where id=(payload->>'custody_id')::uuid and status in ('pending','held') for update;
      if not found then raise exception 'Actionable excess custody not found'; end if;
      select * into v_decision from warehouse.procurement_receipt_exception_decisions
       where id=v_custody.decision_id for update;
      if v_decision.status<>'decided' or v_decision.decision<>'quarantine' then
        raise exception 'Excess custody requires the Warehouse Supervisor to quarantine the parent receipt first';
      end if;
      update warehouse.procurement_receipt_excess_custody
         set status=payload->>'outcome',resolution_reason=payload->>'reason',
             resolution_evidence_urls=payload->'evidence_urls',resolved_by=auth.uid(),resolved_at=now()
       where id=v_custody.id returning * into v_custody;
      perform private.release_procurement_receipt_line_claim(
        v_custody.receipt_id,v_custody.po_line_id
      );
      v_response:=jsonb_build_object('custody',to_jsonb(v_custody));
      return private.finish_idempotent_command(v_command_id,v_response);
    end $$;
    create function warehouse.resolve_procurement_receipt_excess(payload jsonb)
      returns jsonb language sql as $$
        select private.warehouse_resolve_procurement_receipt_excess(payload)
      $$;

    create function private.warehouse_receive_procurement_po(payload jsonb)
      returns jsonb language plpgsql as $$
    declare v_started jsonb; v_command_id uuid; v_response jsonb;
    begin
      v_started:=private.begin_idempotent_command(
        'receive_procurement_po',payload->>'idempotency_key',payload
      );
      if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
      v_command_id:=(v_started->>'command_id')::uuid;
      v_response:=jsonb_build_object('legacy',true,'payload',payload);
      return private.finish_idempotent_command(v_command_id,v_response);
    end $$;
    create function warehouse.receive_procurement_po(payload jsonb)
      returns jsonb language sql as $$ select private.warehouse_receive_procurement_po(payload) $$;

    insert into procurement.purchase_orders(id,status,core_vendor_id,vendor_name)
    values('po-0001','issued','22222222-2222-4222-8222-222222222222','Serialized Vendor');
    insert into procurement.purchase_order_lines(
      id,purchase_order_id,description,quantity,received_quantity,warehouse_product_id
    ) values('line-0001','po-0001','Smart watches',100,0,'smart-watch');
    insert into procurement.purchase_order_lines(
      id,purchase_order_id,description,quantity,received_quantity,warehouse_product_id
    ) values('line-unknown','po-0001','Unmarked device',1,0,null);
    insert into procurement.purchase_order_lines(
      id,purchase_order_id,description,quantity,received_quantity,warehouse_product_id
    ) values('line-0002','po-0001','Replacement smart watch',1,0,'smart-watch');
    insert into warehouse.products(id,serialized) values('smart-watch',true);
    insert into warehouse.locations(id,type) values('loc-wh','warehouse');
    insert into warehouse.storage_areas(id,location_id) values('bin-receiving','loc-wh');
    with operation as (
      insert into warehouse.operation_types(code,active) values('receipt',true) returning id
    ) insert into warehouse.operation_routes(
      operation_type_id,active,source_location_types,destination_location_types,requires_evidence
    ) select id,true,array['vendor'],array['warehouse'],true from operation;
  `);
  const receiptAuthority = await readFile(receiptAuthorityUrl, "utf8");
  const receiptConvergence = await readFile(receiptConvergenceUrl, "utf8");
  await db.exec(
    functionDefinition(
      receiptAuthority,
      "private.warehouse_resolve_procurement_po_exception_v3(payload jsonb)",
    ),
  );
  await db.exec(
    functionDefinition(
      receiptConvergence,
      "private.warehouse_resolve_procurement_receipt_excess(payload jsonb)",
    ),
  );
  await db.exec(await readFile(migrationUrl, "utf8"));
  if (applyConvergence) {
    await db.exec(await readFile(convergenceMigrationUrl, "utf8"));
    if (applySerialCustodyHardening) {
      await db.exec(await readFile(serialCustodyMigrationUrl, "utf8"));
    }
  }
  return db;
}

function serials(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`,
  );
}

async function actAs(db, id, email) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claim.email',$1,false)", [email]);
}

function payload(overrides = {}) {
  return {
    idempotency_key: "po-0001-receipt-0001",
    po_id: "po-0001",
    location_id: "loc-wh",
    bin_id: "bin-receiving",
    evidence_urls: ["evidence/po-0001.jpg"],
    exception_reason: "Mixed physical outcomes documented at receiving",
    lines: [
      {
        line_id: "line-0001",
        product_id: "smart-watch",
        expected_quantity: 100,
        outcomes: {
          clean: { quantity: 50, serial_numbers: serials("CLEAN", 50) },
          damaged: { quantity: 20, serial_numbers: serials("DAMAGED", 20) },
          unidentified: {
            quantity: 10,
            serial_numbers: serials("UNKNOWN", 10),
            observed_description: "Unmarked smart watches",
            observed_identifiers: "Carton A",
          },
          short: { quantity: 20 },
          excess: { quantity: 0, serial_numbers: [] },
        },
      },
    ],
    ...overrides,
  };
}

test("one governed command records the PO-0001 mixed serialized breakdown atomically", async () => {
  const db = await createDatabase();
  const input = payload();
  const result = await db.query(
    "select warehouse.receive_procurement_po($1::jsonb) response",
    [JSON.stringify(input)],
  );
  assert.equal(result.rows[0].response.receipt.procurement_po_id, "po-0001");

  const line = await db.query(
    "select received_quantity from procurement.purchase_order_lines where id='line-0001'",
  );
  assert.equal(line.rows[0].received_quantity, 50);
  const commands = await db.query(
    "select command_name, count(*)::integer total from warehouse.command_log group by command_name",
  );
  assert.deepEqual(commands.rows, [
    { command_name: "receive_procurement_po", total: 1 },
  ]);
  const receipt = await db.query(
    "select lines, quality_status from warehouse.receipts where procurement_po_id='po-0001'",
  );
  assert.equal(receipt.rows[0].quality_status, "pending");
  assert.equal(receipt.rows[0].lines[0].quantity, 80);
  assert.equal(receipt.rows[0].lines[0].serialNumbers.length, 80);
  assert.equal(receipt.rows[0].lines[0].outcomes.short.quantity, 20);
  const units = await db.query(
    "select count(*)::integer total from warehouse.inventory_units",
  );
  assert.equal(units.rows[0].total, 50);
  const decisions = await db.query(
    "select requested_disposition, facts from warehouse.procurement_receipt_exception_decisions order by requested_disposition",
  );
  assert.deepEqual(
    decisions.rows.map((row) => [
      row.requested_disposition,
      row.facts[0].outcome,
      row.facts[0].actual_quantity,
    ]),
    [
      ["damaged", "damaged", 20],
      ["short", "short", 0],
      ["unidentified", "unidentified", 10],
    ],
  );
  const custody = await db.query(
    "select quantity from warehouse.unidentified_receipt_custody",
  );
  assert.deepEqual(custody.rows, [{ quantity: 10 }]);
  const quality = await db.query(`
    select disposition,quantity,count(*)::integer total
      from warehouse.quality_inspections
     group by disposition,quantity
  `);
  assert.deepEqual(quality.rows, [
    { disposition: "pending", quantity: 1, total: 50 },
  ]);
  const holds = await db.query(`
    select status,quantity,count(*)::integer total
      from warehouse.inventory_holds
     group by status,quantity
  `);
  assert.deepEqual(holds.rows, [
    { status: "active", quantity: 1, total: 50 },
  ]);
  const serialClaims = await db.query(
    "select outcome,status,count(*)::integer total from warehouse.procurement_receipt_serial_claims group by outcome,status order by outcome",
  );
  assert.deepEqual(serialClaims.rows, [
    { outcome: "clean", status: "posted", total: 50 },
    { outcome: "damaged", status: "pending", total: 20 },
    { outcome: "unidentified", status: "pending", total: 10 },
  ]);
  const privileges = await db.query(`
    select
      has_function_privilege('anon', 'warehouse.receive_procurement_po(jsonb)', 'execute') anon_public,
      has_function_privilege('authenticated', 'warehouse.receive_procurement_po(jsonb)', 'execute') authenticated_public,
      has_function_privilege('authenticated', 'private.warehouse_receive_procurement_po_breakdown(jsonb)', 'execute') authenticated_private,
      has_function_privilege('service_role', 'private.warehouse_receive_procurement_po_breakdown(jsonb)', 'execute') service_private
  `);
  assert.deepEqual(privileges.rows, [
    {
      anon_public: false,
      authenticated_public: true,
      authenticated_private: false,
      service_private: true,
    },
  ]);
  await db.close();
});

test("quality accepts one staged serial by transitioning its provisional records without reposting stock", async () => {
  const db = await createDatabase();
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);
  const unitsBefore = await db.query(
    "select count(*)::integer total from warehouse.inventory_units",
  );
  await actAs(db, supervisorId, "supervisor@mwell.test");
  const inspectionPayload = {
      idempotency_key: "qc-clean-serial-001",
      source_type: "receipt",
      source_id: (await db.query("select id from warehouse.receipts limit 1")).rows[0].id,
      product_id: "smart-watch",
      procurement_po_line_id: "line-0001",
      bin_id: "bin-receiving",
      serial_number: " clean-001 ",
      quantity: 1,
      disposition: "accepted",
      evidence_urls: ["evidence/qc-clean-001.jpg"],
  };
  await db.query("select warehouse.inspect_quality($1::jsonb)", [
    JSON.stringify(inspectionPayload),
  ]);

  const result = await db.query(`
    select quality.disposition, quality.serial_number, hold.status, hold.quantity
      from warehouse.quality_inspections quality
      join warehouse.inventory_holds hold on hold.inspection_id=quality.id
     where quality.serial_number='CLEAN-001'
  `);
  assert.deepEqual(result.rows, [{
    disposition: "accepted",
    serial_number: "CLEAN-001",
    status: "released",
    quantity: 1,
  }]);
  const unitsAfter = await db.query(
    "select count(*)::integer total from warehouse.inventory_units",
  );
  assert.equal(unitsAfter.rows[0].total, unitsBefore.rows[0].total);
  await db.exec("select set_config('test.has_live_cap','off',false)");
  await assert.rejects(
    db.query("select warehouse.inspect_quality($1::jsonb)", [
      JSON.stringify(inspectionPayload),
    ]),
    /not authorized: warehouse\.inspect_quality/i,
  );
  await db.close();
});

test("quality converts a staged serial into one actionable hold without duplicating custody", async () => {
  const db = await createDatabase();
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);
  const receiptId = (await db.query("select id from warehouse.receipts limit 1")).rows[0].id;
  await actAs(db, supervisorId, "supervisor@mwell.test");
  await db.query("select warehouse.inspect_quality($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "qc-hold-serial-002",
      source_type: "receipt",
      source_id: receiptId,
      product_id: "smart-watch",
      procurement_po_line_id: "line-0001",
      bin_id: "bin-receiving",
      serial_number: "CLEAN-002",
      quantity: 1,
      disposition: "hold",
      reason: "Seal failed inspection",
      evidence_urls: ["evidence/qc-hold-002.jpg"],
    }),
  ]);

  const result = await db.query(`
    select quality.disposition, hold.status, hold.reason, count(*) over ()::integer total
      from warehouse.quality_inspections quality
      join warehouse.inventory_holds hold on hold.inspection_id=quality.id
     where quality.serial_number='CLEAN-002'
  `);
  assert.deepEqual(result.rows, [{
    disposition: "hold",
    status: "active",
    reason: "Seal failed inspection",
    total: 1,
  }]);
  await db.close();
});

test("non-procurement quality delegates without opening a governed command", async () => {
  const db = await createDatabase();
  const result = await db.query("select warehouse.inspect_quality($1::jsonb) response", [
    JSON.stringify({
      idempotency_key: "return-quality-delegate-001",
      source_type: "return",
      source_id: "return-001",
      product_id: "smart-watch",
      quantity: 1,
      disposition: "accepted",
    }),
  ]);
  assert.equal(result.rows[0].response.delegated, true);
  const commands = await db.query(`
    select count(*)::integer total from warehouse.command_log
     where idempotency_key='return-quality-delegate-001'
  `);
  assert.equal(commands.rows[0].total, 0);
  await db.close();
});

test("normalized serial identity is unique across receipt claims and inventory units", async () => {
  const db = await createDatabase();
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);
  const duplicate = payload({
    idempotency_key: "normalized-duplicate-0002",
    lines: [{
      line_id: "line-0002",
      product_id: "smart-watch",
      expected_quantity: 1,
      outcomes: {
        clean: { quantity: 1, serial_numbers: [" clean-001 "] },
        damaged: { quantity: 0, serial_numbers: [] },
        unidentified: { quantity: 0, serial_numbers: [], observed_description: "", observed_identifiers: "" },
        short: { quantity: 0 },
        excess: { quantity: 0, serial_numbers: [] },
      },
    }],
  });
  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [JSON.stringify(duplicate)]),
    /serial.*already|duplicate/i,
  );
  await db.close();
});

test("active damaged and unidentified claims block same-product in-stock units", async () => {
  const db = await createDatabase();
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);

  for (const serialNumber of ["DAMAGED-001", "UNKNOWN-001"]) {
    await assert.rejects(
      db.query(`
        insert into warehouse.inventory_units(
          id, product_id, serial_number, location_id, bin_id, status
        ) values($1, 'smart-watch', $2, 'loc-wh', 'bin-receiving', 'in_stock')
      `, [`unit-for-${serialNumber.toLowerCase()}`, serialNumber]),
      /reserved by governed non-clean receipt custody/i,
    );
  }
  await db.close();
});

test("an active excess claim blocks a same-product in-stock unit", async () => {
  const db = await createDatabase();
  const excessReceipt = payload({
    idempotency_key: "po-0001-excess-custody-0001",
    lines: [{
      line_id: "line-0001",
      product_id: "smart-watch",
      expected_quantity: 100,
      outcomes: {
        clean: { quantity: 0, serial_numbers: [] },
        damaged: { quantity: 0, serial_numbers: [] },
        unidentified: {
          quantity: 0,
          serial_numbers: [],
          observed_description: "",
          observed_identifiers: "",
        },
        short: { quantity: 100 },
        excess: { quantity: 1, serial_numbers: ["EXCESS-BLOCK-001"] },
      },
    }],
  });
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(excessReceipt),
  ]);

  await assert.rejects(
    db.query(`
      insert into warehouse.inventory_units(
        id, product_id, serial_number, location_id, bin_id, status
      ) values(
        'unit-for-excess-block-001', 'smart-watch', ' excess-block-001 ',
        'loc-wh', 'bin-receiving', 'in_stock'
      )
    `),
    /reserved by governed non-clean receipt custody/i,
  );
  await db.close();
});

test("quarantining a damaged serial keeps claim custody and creates no unit", async () => {
  const db = await createDatabase();
  const quarantineReceipt = payload({
    idempotency_key: "damaged-quarantine-0001",
    lines: [{
      line_id: "line-0001",
      product_id: "smart-watch",
      expected_quantity: 100,
      outcomes: {
        clean: { quantity: 0, serial_numbers: [] },
        damaged: { quantity: 1, serial_numbers: ["DAMAGE-HOLD-001"] },
        unidentified: {
          quantity: 0,
          serial_numbers: [],
          observed_description: "",
          observed_identifiers: "",
        },
        short: { quantity: 99 },
        excess: { quantity: 0, serial_numbers: [] },
      },
    }],
  });
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(quarantineReceipt),
  ]);
  await actAs(db, supervisorId, "supervisor@mwell.test");
  const decision = await db.query(`
    select id from warehouse.procurement_receipt_exception_decisions
     where requested_disposition='damaged'
  `);
  await db.query("select warehouse.resolve_procurement_po_exception($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "damage-quarantine-resolution-0001",
      decision_id: decision.rows[0].id,
      decision: "quarantine",
      reason: "Damage requires controlled assessment",
      evidence_urls: ["evidence/damage-hold.jpg"],
    }),
  ]);

  const claim = await db.query(`
    select status from warehouse.procurement_receipt_serial_claims
     where serial_number='DAMAGE-HOLD-001'
  `);
  const unit = await db.query(`
    select count(*)::integer total from warehouse.inventory_units
     where serial_number='DAMAGE-HOLD-001'
  `);
  assert.deepEqual(claim.rows, [{ status: "held" }]);
  assert.equal(unit.rows[0].total, 0);
  await db.close();
});

test("claim and inventory triggers acquire the same normalized serial advisory lock", async () => {
  const db = await createDatabase();
  const definitions = await db.query(`
    select
      pg_get_functiondef('private.lock_serial_custody_identity(text)'::regprocedure) lock_definition,
      pg_get_functiondef('private.normalize_receipt_serial_claim()'::regprocedure) claim_definition,
      pg_get_functiondef('private.normalize_inventory_unit_serial()'::regprocedure) unit_definition
  `);
  const { lock_definition: lockDefinition, claim_definition: claimDefinition,
    unit_definition: unitDefinition } = definitions.rows[0];
  assert.match(lockDefinition, /pg_advisory_xact_lock/);
  assert.match(lockDefinition, /upper\s*\(.*btrim/s);
  assert.match(claimDefinition, /lock_serial_custody_identity\(new\.serial_number\)/i);
  assert.match(unitDefinition, /lock_serial_custody_identity\(new\.serial_number\)/i);
  const normalizedKeys = await db.query(`
    select
      private.lock_serial_custody_identity(' lock-key-001 ') first_key,
      private.lock_serial_custody_identity('LOCK-KEY-001') second_key
  `);
  assert.equal(normalizedKeys.rows[0].first_key, "LOCK-KEY-001");
  assert.equal(normalizedKeys.rows[0].second_key, "LOCK-KEY-001");
  await db.close();
});

test("an existing normalized inventory unit blocks a later non-clean claim", async () => {
  const db = await createDatabase();
  await db.exec(`
    insert into warehouse.inventory_units(
      id, product_id, serial_number, location_id, bin_id, status
    ) values(
      'unit-existing-before-claim', 'smart-watch', ' reverse-race-001 ',
      'loc-wh', 'bin-receiving', 'in_stock'
    )
  `);
  const laterClaim = payload({
    idempotency_key: "reverse-race-claim-0001",
    lines: [{
      line_id: "line-0001",
      product_id: "smart-watch",
      expected_quantity: 100,
      outcomes: {
        clean: { quantity: 0, serial_numbers: [] },
        damaged: { quantity: 1, serial_numbers: ["REVERSE-RACE-001"] },
        unidentified: {
          quantity: 0,
          serial_numbers: [],
          observed_description: "",
          observed_identifiers: "",
        },
        short: { quantity: 99 },
        excess: { quantity: 0, serial_numbers: [] },
      },
    }],
  });

  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [
      JSON.stringify(laterClaim),
    ]),
    /serial.*already exists/i,
  );
  await db.close();
});

test("serial hardening refuses to install over an invalid active non-clean overlap", async () => {
  const db = await createDatabase({ applySerialCustodyHardening: false });
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);
  await db.exec(`
    insert into warehouse.inventory_units(
      id, product_id, serial_number, location_id, bin_id, status
    ) values(
      'unit-invalid-preflight', 'smart-watch', 'DAMAGED-001',
      'loc-wh', 'bin-receiving', 'in_stock'
    )
  `);

  await assert.rejects(
    db.exec(await readFile(serialCustodyMigrationUrl, "utf8")),
    /active non-clean receipt serial claims already overlap inventory units/i,
  );
  await db.close();
});

test("governed receipt and resolution require current live certification", async () => {
  const db = await createDatabase();
  await db.query("select set_config('test.has_live_cap','off',false)");
  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [JSON.stringify(payload())]),
    /not authorized: warehouse\.receive_stock/i,
  );
  const definitions = await db.query(`
    select
      pg_get_functiondef('private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)'::regprocedure) resolver,
      pg_get_functiondef('private.warehouse_receive_procurement_po_breakdown(jsonb)'::regprocedure) receiver
  `);
  assert.match(definitions.rows[0].resolver, /has_live_cap/);
  assert.match(definitions.rows[0].receiver, /has_live_cap/);
  await db.close();
});

test("governed receipt rejects an inactive warehouse destination", async () => {
  const db = await createDatabase();
  await db.exec("update warehouse.locations set active=false where id='loc-wh'");
  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [JSON.stringify(payload())]),
    /receiving destination.*active warehouse/i,
  );
  await db.close();
});

test("forward convergence splits an already-applied aggregate serialized staging hold", async () => {
  const db = await createDatabase({ applyConvergence: false });
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);
  const before = await db.query(
    "select quantity,serial_number from warehouse.quality_inspections",
  );
  assert.deepEqual(before.rows, [{ quantity: 50, serial_number: null }]);

  await db.exec(await readFile(convergenceMigrationUrl, "utf8"));
  const after = await db.query(`
    select quantity,count(*)::integer total,count(distinct serial_number)::integer serials
      from warehouse.quality_inspections group by quantity
  `);
  assert.deepEqual(after.rows, [{ quantity: 1, total: 50, serials: 50 }]);
  await db.close();
});

test("clean staging and every mixed exception outcome complete through independent actors", async () => {
  const db = await createDatabase();
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(payload()),
  ]);

  await assert.rejects(
    db.query(`
      update warehouse.quality_inspections
         set disposition='accepted'
       where source_type='receipt' and serial_number='CLEAN-001'
    `),
    /receipt actor cannot inspect the same receipt/i,
  );

  await actAs(db, supervisorId, "supervisor@mwell.test");
  const receiptId = (await db.query("select id from warehouse.receipts limit 1")).rows[0].id;
  await db.query("select warehouse.inspect_quality($1::jsonb)", [JSON.stringify({
    idempotency_key: "inspect-clean-outcome-0001",
    source_type: "receipt",
    source_id: receiptId,
    product_id: "smart-watch",
    procurement_po_line_id: "line-0001",
    bin_id: "bin-receiving",
    serial_number: "CLEAN-001",
    quantity: 1,
    disposition: "accepted",
    evidence_urls: ["evidence/clean-review.jpg"],
  })]);

  const decisions = await db.query(
    "select id,requested_disposition from warehouse.procurement_receipt_exception_decisions",
  );
  const decisionId = (outcome) =>
    decisions.rows.find((row) => row.requested_disposition === outcome).id;

  await db.query("select warehouse.resolve_procurement_po_exception($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "resolve-damaged-0001",
      decision_id: decisionId("damaged"),
      decision: "accept",
      reason: "Damage assessed and acceptable",
      evidence_urls: ["evidence/damage-review.jpg"],
    }),
  ]);
  await db.query("select warehouse.resolve_procurement_po_exception($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "resolve-unidentified-0001",
      decision_id: decisionId("unidentified"),
      decision: "accept",
      reason: "Identity verified against vendor manifest",
      evidence_urls: ["evidence/identity-review.jpg"],
      identifications: [
        { po_line_id: "line-0001", product_id: "smart-watch" },
      ],
    }),
  ]);
  await db.query("select warehouse.resolve_procurement_po_exception($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "resolve-short-0001",
      decision_id: decisionId("short"),
      decision: "accept",
      reason: "Short delivery confirmed with vendor",
      evidence_urls: ["evidence/short-review.jpg"],
    }),
  ]);

  const line = await db.query(
    "select received_quantity from procurement.purchase_order_lines where id='line-0001'",
  );
  assert.equal(line.rows[0].received_quantity, 80);
  const units = await db.query(
    "select count(*)::integer total from warehouse.inventory_units",
  );
  assert.equal(units.rows[0].total, 80);
  const resolved = await db.query(`
    select requested_disposition,status,decision
      from warehouse.procurement_receipt_exception_decisions
     order by requested_disposition
  `);
  assert.deepEqual(resolved.rows, [
    { requested_disposition: "damaged", status: "decided", decision: "accept" },
    { requested_disposition: "short", status: "decided", decision: "accept" },
    { requested_disposition: "unidentified", status: "decided", decision: "accept" },
  ]);
  const claims = await db.query(`
    select outcome,status,count(*)::integer total
      from warehouse.procurement_receipt_serial_claims
     group by outcome,status order by outcome
  `);
  assert.deepEqual(claims.rows, [
    { outcome: "clean", status: "posted", total: 50 },
    { outcome: "damaged", status: "released", total: 20 },
    { outcome: "unidentified", status: "released", total: 10 },
  ]);
  const inspectors = await db.query(`
    select distinct inspected_by from warehouse.quality_inspections
     where disposition='accepted'
  `);
  assert.deepEqual(inspectors.rows, [{ inspected_by: supervisorId }]);
  await db.close();
});

test("serialized excess stays reserved through quarantine and releases on vendor return", async () => {
  const db = await createDatabase();
  const input = payload({ idempotency_key: "po-0001-excess-resolver-0001" });
  input.lines[0].outcomes.clean = {
    quantity: 100,
    serial_numbers: serials("CLEAN", 100),
  };
  input.lines[0].outcomes.damaged = { quantity: 0, serial_numbers: [] };
  input.lines[0].outcomes.unidentified = {
    quantity: 0,
    serial_numbers: [],
    observed_description: "",
    observed_identifiers: "",
  };
  input.lines[0].outcomes.short.quantity = 0;
  input.lines[0].outcomes.excess = {
    quantity: 1,
    serial_numbers: ["EXCESS-001"],
  };
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(input),
  ]);
  await actAs(db, supervisorId, "supervisor@mwell.test");
  const decision = await db.query(
    "select id from warehouse.procurement_receipt_exception_decisions where requested_disposition='excess'",
  );
  await db.query("select warehouse.resolve_procurement_po_exception($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "quarantine-excess-0001",
      decision_id: decision.rows[0].id,
      decision: "quarantine",
      reason: "Hold excess pending vendor disposition",
      evidence_urls: ["evidence/excess-hold.jpg"],
    }),
  ]);
  const custody = await db.query(
    "select id,status from warehouse.procurement_receipt_excess_custody",
  );
  assert.equal(custody.rows[0].status, "held");
  const heldClaim = await db.query(
    "select status from warehouse.procurement_receipt_serial_claims where serial_number='EXCESS-001'",
  );
  assert.equal(heldClaim.rows[0].status, "held");
  await db.query("select warehouse.resolve_procurement_receipt_excess($1::jsonb)", [
    JSON.stringify({
      idempotency_key: "return-excess-0001",
      custody_id: custody.rows[0].id,
      outcome: "vendor_return",
      reason: "Vendor authorized return",
      evidence_urls: ["evidence/vendor-rma.jpg"],
    }),
  ]);
  const released = await db.query(
    "select status from warehouse.procurement_receipt_serial_claims where serial_number='EXCESS-001'",
  );
  assert.equal(released.rows[0].status, "released");
  const returned = await db.query(
    "select status from warehouse.procurement_receipt_excess_custody",
  );
  assert.equal(returned.rows[0].status, "vendor_return");
  await db.close();
});

test("the governed command rejects reconciliation and serial violations without partial writes", async () => {
  const cases = [
    {
      name: "reconciliation",
      mutate: (input) => {
        input.lines[0].outcomes.short.quantity = 19;
      },
      message: /reconcile to the locked expected quantity/i,
    },
    {
      name: "missing serial",
      mutate: (input) => {
        input.lines[0].outcomes.clean.serial_numbers.pop();
      },
      message: /serial count must match its physical quantity/i,
    },
    {
      name: "duplicate serial",
      mutate: (input) => {
        input.lines[0].outcomes.damaged.serial_numbers[0] = "CLEAN-001";
      },
      message: /duplicate serial number in receipt breakdown/i,
    },
  ];

  for (const scenario of cases) {
    const db = await createDatabase();
    const input = payload({
      idempotency_key: `po-0001-${scenario.name.replace(" ", "-")}-0001`,
    });
    scenario.mutate(input);
    await assert.rejects(
      db.query("select warehouse.receive_procurement_po($1::jsonb)", [
        JSON.stringify(input),
      ]),
      scenario.message,
    );
    const line = await db.query(
      "select received_quantity from procurement.purchase_order_lines where id='line-0001'",
    );
    assert.equal(line.rows[0].received_quantity, 0, scenario.name);
    const commands = await db.query(
      "select count(*)::integer total from warehouse.command_log",
    );
    assert.equal(commands.rows[0].total, 0, scenario.name);
    await db.close();
  }
});

test("a pending serialized outcome cannot be claimed by another receipt command", async () => {
  const db = await createDatabase();
  const first = payload({ idempotency_key: "reserve-damaged-serial-0001" });
  first.lines[0].outcomes.clean = { quantity: 0, serial_numbers: [] };
  first.lines[0].outcomes.damaged = {
    quantity: 1,
    serial_numbers: ["RESERVED-001"],
  };
  first.lines[0].outcomes.unidentified = {
    quantity: 0,
    serial_numbers: [],
    observed_description: "",
    observed_identifiers: "",
  };
  first.lines[0].outcomes.short.quantity = 99;
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(first),
  ]);

  const second = payload({
    idempotency_key: "reuse-damaged-serial-0002",
    lines: [
      {
        line_id: "line-0002",
        product_id: "smart-watch",
        expected_quantity: 1,
        outcomes: {
          clean: { quantity: 0, serial_numbers: [] },
          damaged: { quantity: 1, serial_numbers: ["RESERVED-001"] },
          unidentified: {
            quantity: 0,
            serial_numbers: [],
            observed_description: "",
            observed_identifiers: "",
          },
          short: { quantity: 0 },
          excess: { quantity: 0, serial_numbers: [] },
        },
      },
    ],
  });
  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [
      JSON.stringify(second),
    ]),
    /serial.*already.*claimed|duplicate key/i,
  );
  const command = await db.query(
    "select count(*)::integer total from warehouse.command_log where idempotency_key='reuse-damaged-serial-0002'",
  );
  assert.equal(command.rows[0].total, 0);
  await db.close();
});

test("receive capability is checked before a breakdown replay", async () => {
  const db = await createDatabase();
  const input = payload({ idempotency_key: "authorized-replay-check-0001" });
  input.lines[0].outcomes.clean = {
    quantity: 100,
    serial_numbers: serials("AUTH", 100),
  };
  input.lines[0].outcomes.damaged = { quantity: 0, serial_numbers: [] };
  input.lines[0].outcomes.unidentified = {
    quantity: 0,
    serial_numbers: [],
    observed_description: "",
    observed_identifiers: "",
  };
  input.lines[0].outcomes.short.quantity = 0;
  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(input),
  ]);
  await db.exec("select set_config('test.has_live_cap','off',false)");
  await assert.rejects(
    db.query("select warehouse.receive_procurement_po($1::jsonb)", [
      JSON.stringify(input),
    ]),
    /not authorized: warehouse\.receive_stock/i,
  );
  await db.close();
});

test("legacy receipt payloads replay without a breakdown field changing their hash", async () => {
  const db = await createDatabase();
  const legacy = {
    idempotency_key: "legacy-receipt-replay-0001",
    po_id: "po-0001",
    location_id: "loc-wh",
    bin_id: "bin-receiving",
    lines: [
      {
        line_id: "line-0001",
        product_id: "smart-watch",
        quantity: 100,
        serial_numbers: serials("LEGACY", 100),
      },
    ],
    evidence_urls: ["evidence/legacy.jpg"],
  };
  const first = await db.query(
    "select warehouse.receive_procurement_po($1::jsonb) response",
    [JSON.stringify(legacy)],
  );
  const replay = await db.query(
    "select warehouse.receive_procurement_po($1::jsonb) response",
    [JSON.stringify(legacy)],
  );
  assert.deepEqual(replay.rows[0].response, first.rows[0].response);
  assert.equal("exception_reason" in first.rows[0].response.payload, false);
  const commands = await db.query(
    "select count(*)::integer total from warehouse.command_log where idempotency_key='legacy-receipt-replay-0001'",
  );
  assert.equal(commands.rows[0].total, 1);
  await db.close();
});

test("excess remains valid above the reconciled expected balance and enters custody", async () => {
  const db = await createDatabase();
  const input = payload({ idempotency_key: "po-0001-excess-0001" });
  input.lines[0].outcomes.clean = {
    quantity: 100,
    serial_numbers: serials("CLEAN", 100),
  };
  input.lines[0].outcomes.damaged = { quantity: 0, serial_numbers: [] };
  input.lines[0].outcomes.unidentified = {
    quantity: 0,
    serial_numbers: [],
    observed_description: "",
    observed_identifiers: "",
  };
  input.lines[0].outcomes.short.quantity = 0;
  input.lines[0].outcomes.excess = {
    quantity: 1,
    serial_numbers: ["EXCESS-001"],
  };

  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(input),
  ]);
  const custody = await db.query(
    "select excess_quantity from warehouse.procurement_receipt_excess_custody",
  );
  assert.deepEqual(custody.rows, [{ excess_quantity: 1 }]);
  const receipt = await db.query(
    "select lines from warehouse.receipts where procurement_po_id='po-0001'",
  );
  assert.equal(receipt.rows[0].lines[0].quantity, 101);
  assert.equal(receipt.rows[0].lines[0].outcomes.excess.quantity, 1);
  await db.close();
});

test("unidentified-only receipt facts do not force a Warehouse product mapping", async () => {
  const db = await createDatabase();
  const input = payload({
    idempotency_key: "po-0001-unidentified-0001",
    lines: [
      {
        line_id: "line-unknown",
        product_id: null,
        expected_quantity: 1,
        outcomes: {
          clean: { quantity: 0, serial_numbers: [] },
          damaged: { quantity: 0, serial_numbers: [] },
          unidentified: {
            quantity: 1,
            serial_numbers: [],
            observed_description: "Device with no readable label",
            observed_identifiers: "Blue carton",
          },
          short: { quantity: 0 },
          excess: { quantity: 0, serial_numbers: [] },
        },
      },
    ],
  });

  await db.query("select warehouse.receive_procurement_po($1::jsonb)", [
    JSON.stringify(input),
  ]);
  const line = await db.query(
    "select warehouse_product_id from procurement.purchase_order_lines where id='line-unknown'",
  );
  assert.equal(line.rows[0].warehouse_product_id, null);
  const custody = await db.query(
    "select quantity from warehouse.unidentified_receipt_custody",
  );
  assert.deepEqual(custody.rows, [{ quantity: 1 }]);
  await db.close();
});
