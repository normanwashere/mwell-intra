import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../supabase/migrations/20260815154910_operations_launch_blocker_slice.sql", import.meta.url),
  "utf8",
);

const RECEIVER = "11111111-1111-4111-8111-111111111111";
const INSPECTOR = "22222222-2222-4222-8222-222222222222";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema warehouse; create schema private;
    create table core.profiles(id uuid primary key, email text not null unique);
    insert into core.profiles values
      ('${RECEIVER}', 'receiver@mwell.test'), ('${INSPECTOR}', 'inspector@mwell.test');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_cap(text, text) returns boolean language sql stable as $$ select true $$;
    create function core.has_live_cap(text, text) returns boolean language sql stable as $$ select true $$;
    create function warehouse.authoritative_actor() returns text language sql stable as $$
      select email from core.profiles where id = auth.uid()
    $$;
    create table warehouse.receipts(
      id text primary key, supplier_id text, location_id text not null, lines jsonb not null default '[]',
      evidence_urls jsonb not null default '[]', actor text not null, created_at timestamptz not null default now(),
      quality_status text not null default 'pending'
    );
    create table warehouse.quality_inspections(
      id uuid primary key default gen_random_uuid(), source_type text not null, source_id text not null,
      product_id text not null, lot_id text, serial_number text, location_id text not null, bin_id text,
      quantity integer not null, disposition text not null, reason text, evidence_urls jsonb not null default '[]',
      inspected_by uuid not null references core.profiles(id), inspected_by_email text not null,
      inspected_at timestamptz not null default now()
    );
    create table warehouse.inventory_holds(
      id uuid primary key default gen_random_uuid(), inspection_id uuid not null references warehouse.quality_inspections(id),
      product_id text not null, location_id text not null, bin_id text, lot_id text, serial_number text,
      quantity integer not null, status text not null default 'active', reason text not null,
      evidence_urls jsonb not null default '[]', created_by uuid not null references core.profiles(id),
      created_at timestamptz not null default now()
    );
    create table warehouse.exceptions(
      id uuid primary key default gen_random_uuid(), exception_type text not null, severity text not null,
      source_type text not null, source_id text not null, status text not null default 'open',
      created_by uuid not null references core.profiles(id)
    );
    create table warehouse.cycle_counts(
      id text primary key, location_id text not null, bin_id text, category text, lines jsonb not null,
      status text not null default 'draft', requested_by uuid, actor text not null,
      created_at timestamptz not null default now(), submitted_at timestamptz
    );
    create table warehouse.command_log(
      id uuid primary key default gen_random_uuid(), actor_id uuid not null, command_name text not null,
      idempotency_key text not null, response jsonb, completed_at timestamptz,
      unique(actor_id, command_name, idempotency_key)
    );
    create function private.begin_idempotent_command(text, text, jsonb) returns jsonb
    language plpgsql security definer set search_path='' as $$
    declare v_id uuid;
    begin
      insert into warehouse.command_log(actor_id, command_name, idempotency_key)
      values(auth.uid(), $1, $2) returning id into v_id;
      return jsonb_build_object('command_id', v_id, 'replayed', false);
    end $$;
    create function private.finish_idempotent_command(uuid, jsonb) returns jsonb
    language plpgsql security definer set search_path='' as $$
    begin update warehouse.command_log set response=$2, completed_at=now() where id=$1; return $2; end $$;
    create function private.warehouse_submit_cycle_count(jsonb) returns jsonb
    language plpgsql security definer set search_path='' as $$
    declare v_count warehouse.cycle_counts;
    begin
      update warehouse.cycle_counts set status='approved', submitted_at=now()
       where id=$1->>'cycle_count_id' returning * into v_count;
      return jsonb_build_object('cycle_count', to_jsonb(v_count), 'requests', '[]'::jsonb);
    end $$;
    create function private.assert_goods_procurement_po(text) returns void language sql as $$ select $$;
    create function private.warehouse_receive_procurement_po(jsonb) returns jsonb
    language plpgsql security definer set search_path='' as $$
    declare v_receipt warehouse.receipts; v_response jsonb; v_inspection uuid;
    begin
      insert into warehouse.receipts(id, location_id, actor, quality_status)
      values('receipt-po', 'warehouse-1', warehouse.authoritative_actor(), 'accepted') returning * into v_receipt;
      insert into warehouse.quality_inspections(
        source_type, source_id, product_id, location_id, quantity, disposition,
        inspected_by, inspected_by_email
      ) values('receipt', v_receipt.id, 'product-1', v_receipt.location_id, 2, 'pending', auth.uid(), warehouse.authoritative_actor())
      returning id into v_inspection;
      update warehouse.quality_inspections set disposition='accepted' where id=v_inspection;
      v_response:=jsonb_build_object('receipt', to_jsonb(v_receipt));
      insert into warehouse.command_log(actor_id, command_name, idempotency_key, response, completed_at)
      values(auth.uid(), 'receive_procurement_po', $1->>'idempotency_key', v_response, now())
      on conflict(actor_id, command_name, idempotency_key) do update set response=excluded.response;
      return v_response;
    end $$;
  `);
  await db.exec(migration);
  return db;
}

async function actor(db, id) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${id}', false)`);
}

test("enforces independent custody actors and atomic evidenced counts", async () => {
  const db = await database();
  await actor(db, RECEIVER);
  await db.exec("insert into warehouse.receipts(id, location_id, actor) values('receipt-1','warehouse-1','spoofed')");
  const stamped = await db.query("select received_by, actor from warehouse.receipts where id='receipt-1'");
  assert.equal(stamped.rows[0].received_by, RECEIVER);
  assert.equal(stamped.rows[0].actor, "receiver@mwell.test");

  await assert.rejects(
    db.exec(`insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,quantity,disposition,inspected_by,inspected_by_email)
      values('receipt','receipt-1','product-1','warehouse-1',1,'accepted','${INSPECTOR}','spoofed')`),
    /cannot inspect/i,
  );
  await db.exec(`insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,quantity,disposition,inspected_by,inspected_by_email)
    values('receipt','receipt-1','product-1','warehouse-1',1,'pending','${RECEIVER}','receiver@mwell.test')`);
  await actor(db, INSPECTOR);
  await db.exec("update warehouse.quality_inspections set disposition='accepted' where source_id='receipt-1'");

  await actor(db, RECEIVER);
  const exception = await db.query(`insert into warehouse.exceptions(exception_type,severity,source_type,source_id,created_by)
    values('quality','P2','quality_inspection','source-1','${RECEIVER}') returning id`);
  await assert.rejects(
    db.exec(`update warehouse.exceptions set status='resolved' where id='${exception.rows[0].id}'`),
    /creator cannot resolve/i,
  );
  await actor(db, INSPECTOR);
  await db.exec(`update warehouse.exceptions set status='resolved' where id='${exception.rows[0].id}'`);

  await assert.rejects(
    db.query("select warehouse.create_and_submit_cycle_count('{\"idempotency_key\":\"atomic-count-no-evidence\",\"cycle_count\":{\"location_id\":\"warehouse-1\",\"lines\":[{\"productId\":\"product-1\",\"counted\":1}]},\"reason\":\"test\",\"evidence_urls\":[]}'::jsonb)"),
    /evidence is required/i,
  );
  await db.query("select warehouse.create_and_submit_cycle_count('{\"idempotency_key\":\"atomic-count-with-evidence\",\"cycle_count\":{\"location_id\":\"warehouse-1\",\"lines\":[{\"productId\":\"product-1\",\"counted\":1}]},\"reason\":\"test\",\"evidence_urls\":[\"evidence/count.jpg\"]}'::jsonb)");
  const counts = await db.query("select status from warehouse.cycle_counts");
  assert.deepEqual(counts.rows, [{ status: "approved" }]);
  await db.close();
});

test("keeps clean PO receipts held until a different inspector acts", async () => {
  const db = await database();
  await actor(db, RECEIVER);
  const result = await db.query("select warehouse.receive_procurement_po('{\"idempotency_key\":\"receive-po-independent-01\",\"po_id\":\"po-1\"}'::jsonb) response");
  assert.equal(result.rows[0].response.receipt.quality_status, "pending");
  const state = await db.query(`select inspection.disposition, hold.status
    from warehouse.quality_inspections inspection
    join warehouse.inventory_holds hold on hold.inspection_id=inspection.id
    where inspection.source_id='receipt-po'`);
  assert.deepEqual(state.rows, [{ disposition: "pending", status: "active" }]);
  await assert.rejects(
    db.exec("update warehouse.quality_inspections set disposition='accepted' where source_id='receipt-po'"),
    /cannot inspect/i,
  );
  await db.close();
});
