import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATION = resolve(
  ROOT,
  "supabase",
  "migrations",
  "20260813203240_task_1_database_authority_remediation.sql",
);

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const THIRD_ACTOR_ID = "44444444-4444-4444-8444-444444444444";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";

const renamedFunctions = [
  ["warehouse", "issue"],
  ["warehouse", "record_return"],
  ["warehouse", "record_cycle_count"],
  ["warehouse", "receive_against_po"],
  ["warehouse", "adjust_stock"],
  ["procurement", "decide_request_step"],
  ["core", "manage_finance_close_entry"],
  ["product", "submit_readiness_package"],
  ["product", "decide_readiness_package"],
  ["product", "acknowledge_operations_handoff"],
  ["product", "submit_price_proposal"],
  ["product", "decide_price_proposal"],
  ["procurement", "manage_replenishment_recommendation"],
  ["procurement", "release_payment"],
  ["procurement", "review_payment_readiness"],
  ["warehouse", "register_export_job"],
  ["warehouse", "review_export_job"],
  ["legal", "approve_accreditation_case"],
];

const privateWarehouseFunctions = [
  "warehouse_update_operation_route",
  "warehouse_inspect_quality",
  "warehouse_release_quality_hold",
  "warehouse_create_vendor_return",
  "warehouse_submit_cycle_count",
  "warehouse_decide_stock_change",
  "warehouse_resolve_exception",
  "warehouse_transfer",
  "warehouse_apply_import_job",
  "warehouse_create_kit_definition",
];

let db;

async function exec(sql) {
  return db.exec(sql);
}

async function value(sql) {
  const result = await db.query(sql);
  return result.rows[0];
}

async function setAuthority({ raw = "", live = "", role = "authenticated", uid = ACTOR_ID } = {}) {
  await db.query(
    "select set_config('app.raw_cap', $1, false), set_config('app.live_cap', $2, false), set_config('app.auth_role', $3, false), set_config('app.uid', $4, false)",
    [raw, live, role, uid],
  );
}

before(async () => {
  db = new PGlite();
  await exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema learning;
    create schema warehouse;
    create schema procurement;
    create schema product;
    create schema legal;
    create schema private;
    create schema storage;
    create schema extensions;

    create function auth.role() returns text language sql stable
      as $$ select nullif(current_setting('app.auth_role', true), '') $$;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable
      as $$ select jsonb_build_object('email', 'actor@example.test') $$;
    create function core.has_cap(p_module text, p_cap text) returns boolean language sql stable
      as $$ select current_setting('app.raw_cap', true) = p_module || ':' || p_cap $$;
    create function core.has_live_cap(p_module text, p_cap text) returns boolean language sql stable
      as $$ select current_setting('app.live_cap', true) = p_module || ':' || p_cap $$;
    create function core.current_vendor_id() returns uuid language sql stable
      as $$ select '${VENDOR_ID}'::uuid $$;
    create function storage.foldername(p_name text) returns text[] language sql immutable
      as $$ select string_to_array(p_name, '/') $$;
    create function extensions.digest(data bytea, algorithm text) returns bytea language sql immutable
      as $$ select decode(repeat('00', 32), 'hex') $$;

    create table core.capabilities(module text, cap text, primary key(module, cap));
    create table core.role_capabilities(module text, role text, cap text, primary key(module, role, cap));
    create table core.vendors(id uuid primary key, accreditation_status text default 'draft', accreditation_expires_at date);
    create table core.profiles(id uuid primary key, vendor_id uuid references core.vendors(id), kind text, status text default 'active');
    create table core.activity_log(module text, entity_type text, entity_id text, action text, actor uuid, detail jsonb);
    create table core.finance_close_entries(
      id uuid primary key default gen_random_uuid(), period_start date, period_end date,
      entry_type text, source_module text, source_reference text, cost_center text,
      amount numeric, status text default 'draft', evidence_url text,
      reconciliation_note text, prepared_by uuid, prepared_at timestamptz default now(),
      posted_by uuid, posted_at timestamptz, updated_at timestamptz default now(),
      unique(entry_type, source_module, source_reference, period_end)
    );
    alter table core.finance_close_entries enable row level security;
    create policy finance_close_entries_read on core.finance_close_entries for select to authenticated using (true);

    create table warehouse.products(id text primary key);
    create table warehouse.events(
      id text primary key, name text default 'Event', type text default 'other',
      start_date date not null default current_date, end_date date,
      status text default 'planned', updated_at timestamptz default now()
    );
    create table warehouse.event_reconciliations(
      event_id text primary key references warehouse.events(id), status text default 'draft',
      sold_units integer default 0, giveaway_units integer default 0, returned_units integer default 0,
      lost_units integer default 0, damaged_units integer default 0, rekit_units integer default 0,
      gross_sales_amount numeric default 0, finance_reference text, evidence_url text, note text,
      prepared_by uuid, prepared_at timestamptz, approved_by uuid, approved_at timestamptz,
      updated_at timestamptz default now()
    );
    create table warehouse.receipts(
      id text primary key, location_id text default 'location', lines jsonb default '[]',
      evidence_urls jsonb default '[]', actor text default 'actor', created_at timestamptz default now(),
      procurement_po_id text, quality_status text default 'pending'
    );
    create table warehouse.allocations(
      id text primary key, event_id text, quantity integer default 0, status text default 'reserved',
      created_at timestamptz default now()
    );
    create table warehouse.cycle_counts(
      id text primary key, status text default 'draft', submitted_at timestamptz,
      created_at timestamptz default now()
    );
    create table warehouse.kit_definitions(
      id uuid primary key default gen_random_uuid(), product_id text references warehouse.products(id),
      status text default 'draft'
    );

    create table procurement.requests(
      id text primary key, title text default 'Request', status text default 'draft', submitted_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table procurement.purchase_orders(
      id text primary key, request_id text references procurement.requests(id), status text default 'draft',
      updated_at timestamptz default now(),
      constraint purchase_orders_status_check check (status in ('draft','pending_approval','approved','issued','closed','cancelled'))
    );
    create table procurement.receipts(
      id text primary key, purchase_order_id text references procurement.purchase_orders(id)
    );
    create table procurement.acceptance_packs(
      id uuid primary key default gen_random_uuid(), purchase_order_id text references procurement.purchase_orders(id),
      status text default 'accepted'
    );
    create table procurement.payment_readiness_packs(
      id uuid primary key default gen_random_uuid(), purchase_order_id text references procurement.purchase_orders(id),
      status text default 'draft', prepared_at timestamptz default now()
    );
    create table procurement.payment_releases(
      id uuid primary key default gen_random_uuid(), purchase_order_id text references procurement.purchase_orders(id),
      status text default 'posted'
    );

    create table product.readiness_packages(
      id uuid primary key default gen_random_uuid(), product_id text references warehouse.products(id),
      version integer not null default 1, status text default 'submitted', is_current boolean default false,
      operations_acknowledged_at timestamptz
    );
    create function product.can_launch(p_product_id text) returns boolean language sql stable
      as $$ select exists(select 1 from product.readiness_packages where product_id=p_product_id and status='approved' and is_current and operations_acknowledged_at is not null) $$;

    create table learning.mutation_capability_rules(
      module text not null, capability text not null, created_at timestamptz default now(),
      primary key(module, capability)
    );

    create table legal.accreditation_cases(
      id text primary key, vendor_id uuid not null references core.vendors(id), vendor_name text not null,
      status text not null default 'draft', entity_type text, jurisdiction text, risk_tier text,
      handles_personal_data boolean, submitted_at timestamptz, decided_at timestamptz,
      decided_by_email text, decision_note text, expires_at date, scope text,
      pending_decision_status text, pending_decision_proposed_by_email text,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      constraint accreditation_cases_status_check check (status in ('draft','submitted','under_review','approved','provisional','rejected','expired','renewal_due'))
    );
    create table legal.requirement_checklist_items(
      id text primary key, case_id text references legal.accreditation_cases(id), code text,
      required boolean default true, instrument boolean default false, instrument_code text,
      decision text default 'pending', document_ids text[] default '{}'
    );
    create table legal.accreditation_docs(
      id text primary key, case_id text not null references legal.accreditation_cases(id),
      vendor_id uuid not null references core.vendors(id), requirement_id text,
      filename text not null, storage_path text, status text default 'submitted',
      version integer default 1, uploaded_at timestamptz default now()
    );
    create table legal.signed_instruments(id text primary key, case_id text, code text, revoked_at timestamptz);
    create table legal.case_timeline(id bigint generated always as identity, case_id text, actor_email text, action text, detail text);
    create table legal.policy_definitions(id text, version text, primary key(id, version));
    insert into legal.policy_definitions values ('vendor-accreditation', '2025');
    create table legal.vendor_application_snapshots(
      id uuid primary key default gen_random_uuid(), case_id text not null references legal.accreditation_cases(id),
      vendor_id uuid not null references core.vendors(id), policy_id text, policy_version text,
      payload jsonb not null, document_hash text not null, status text not null default 'draft',
      signed_by_name text, signed_by_title text, signature jsonb not null default '{}',
      signed_at timestamptz, submitted_at timestamptz, created_by uuid not null,
      created_at timestamptz default now(), version integer not null default 1,
      updated_at timestamptz default now(), discarded_at timestamptz, idempotency_key text
    );
    create table legal.vendor_lifecycle_reviews(
      id uuid primary key default gen_random_uuid(), vendor_id uuid not null references core.vendors(id),
      review_type text not null, status text not null default 'open', due_date date,
      risk_rating text, score numeric, reason text not null, evidence_url text,
      decision_note text, opened_by uuid not null, opened_at timestamptz default now(),
      decided_by uuid, decided_at timestamptz,
      constraint vendor_lifecycle_reviews_review_type_check check (review_type in ('renewal','document_expiry','performance','reassessment','suspension','offboarding'))
    );

    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create policy documents_auth_read on storage.objects for select to authenticated using (true);
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;

    insert into core.vendors(id) values ('${VENDOR_ID}');
    insert into core.profiles(id, vendor_id, kind) values
      ('${ACTOR_ID}', '${VENDOR_ID}', 'vendor'),
      ('${SECOND_ACTOR_ID}', null, 'internal'),
      ('${THIRD_ACTOR_ID}', null, 'internal');
  `);

  for (const [schema, name] of renamedFunctions) {
    await exec(`create function ${schema}.${name}(payload jsonb) returns jsonb language sql as $$ select payload $$;`);
  }
  for (const name of privateWarehouseFunctions) {
    await exec(`create function private.${name}(payload jsonb) returns jsonb language sql as $$ select payload $$;`);
  }
  await exec(`
    create function warehouse.reserve(payload jsonb) returns jsonb language plpgsql security definer as $$
    begin
      if not core.has_cap('warehouse', 'reserve_allocate') then raise exception 'raw reserve denied'; end if;
      return payload;
    end $$;
    create function warehouse.create_event(payload jsonb) returns jsonb language plpgsql security definer as $$
    begin
      if not core.has_cap('events', 'create_event') then raise exception 'raw create event denied'; end if;
      return payload;
    end $$;
    create function warehouse.request_event_fulfillment(payload jsonb) returns jsonb language plpgsql security definer as $$
    begin
      if not core.has_cap('events', 'request_fulfillment') then raise exception 'raw event fulfillment denied'; end if;
      return payload;
    end $$;
    create function warehouse.save_event_reconciliation(payload jsonb) returns jsonb language plpgsql security definer as $$
    begin
      if not core.has_cap('events', case when payload->>'action' = 'approve' then 'approve_settlement' else 'manage_events' end)
      then raise exception 'raw reconciliation denied'; end if;
      return payload;
    end $$;
    create function warehouse.update_operation_route(payload jsonb) returns jsonb language sql security invoker
      as $$ select private.warehouse_update_operation_route(payload) $$;
    create function warehouse.apply_import_job(payload jsonb) returns jsonb language sql security invoker
      as $$ select private.warehouse_apply_import_job(payload) $$;
    create function warehouse.create_kit_definition(payload jsonb) returns jsonb language sql security definer
      as $$ select private.warehouse_create_kit_definition(payload) $$;
    create function procurement.issue_purchase_order(payload jsonb) returns jsonb language sql as $$ select payload $$;
    create function core.insights_snapshot() returns table(
      id text, area text, label text, value numeric, unit text, target_direction text,
      target_min numeric, target_max numeric, data_status text, sample_count bigint,
      detail text, source_href text, reporting_period_start timestamptz,
      reporting_period_end timestamptz, source_updated_at timestamptz, extracted_at timestamptz
    ) language sql as $$ select null::text, null::text, null::text, null::numeric,
      null::text, null::text, null::numeric, null::numeric, null::text, null::bigint,
      null::text, null::text, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz where false $$;
  `);

  await exec(readFileSync(MIGRATION, "utf8"));
});

after(async () => {
  await db?.close();
});

test("new mutation capabilities are present in the effective certification catalog", async () => {
  const required = [
    "core:manage_own_accreditation_draft",
    "warehouse:recommend_replenishment",
    "procurement:manage_replenishment",
    "procurement:cancel_purchase_order",
    "procurement:release_payment",
    "procurement:review_payment_readiness",
    "warehouse:register_exports",
    "warehouse:review_exports",
    "insights:prepare_exports",
  ];
  const result = await db.query(`select module || ':' || capability as rule from learning.mutation_capability_rules order by 1`);
  const actual = new Set(result.rows.map(({ rule }) => rule));
  for (const rule of required) assert.ok(actual.has(rule), `missing effective rule ${rule}`);
});

test("private import and operation-route implementations have effective browser denials", async () => {
  for (const name of ["warehouse_apply_import_job", "warehouse_update_operation_route"]) {
    const privilege = await value(
      `select has_function_privilege('authenticated', 'private.${name}(jsonb)', 'execute') as allowed`,
    );
    assert.equal(privilege.allowed, false, `${name} remains browser executable`);
  }

  for (const name of ["apply_import_job", "update_operation_route"]) {
    const metadata = await value(`
      select p.prosecdef as security_definer,
        has_function_privilege('authenticated', 'warehouse.${name}(jsonb)', 'execute') as allowed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'warehouse' and p.proname = '${name}'
    `);
    assert.equal(metadata.security_definer, true, `${name} is not a definer boundary`);
    assert.equal(metadata.allowed, true, `${name} is not usable by authenticated callers`);
  }
});

test("raw Warehouse and Event caps cannot bypass live certification", async () => {
  for (const [call, raw] of [
    ["warehouse.reserve('{}'::jsonb)", "warehouse:reserve_allocate"],
    ["warehouse.create_event('{}'::jsonb)", "events:create_event"],
    ["warehouse.request_event_fulfillment('{}'::jsonb)", "events:request_fulfillment"],
    ["warehouse.save_event_reconciliation('{\"action\":\"approve\"}'::jsonb)", "events:approve_settlement"],
  ]) {
    await setAuthority({ raw });
    await assert.rejects(db.query(`select ${call}`), /Not authorized|live/i, call);
  }
});

test("Legal audit columns match text IDs and service access remains attributable", async () => {
  const result = await db.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'legal' and table_name = 'document_access_audit'
      and column_name in ('document_id', 'case_id', 'actor_id', 'actor_role')
  `);
  const columns = Object.fromEntries(result.rows.map((row) => [row.column_name, row]));
  assert.equal(columns.document_id.data_type, "text");
  assert.equal(columns.case_id.data_type, "text");
  assert.equal(columns.actor_id.is_nullable, "YES");
  assert.equal(columns.actor_role.is_nullable, "NO");
});

test("authenticated users cannot read raw objects even after governed authorization", async () => {
  await exec(`insert into storage.objects(bucket_id, name, owner) values ('documents', 'vendor/${VENDOR_ID}/secret.pdf', '${ACTOR_ID}')`);
  await setAuthority({ live: "legal:manage_documents" });
  await exec("set role authenticated");
  try {
    const result = await db.query("select name from storage.objects");
    assert.deepEqual(result.rows, []);
  } finally {
    await exec("reset role");
  }
});

test("Finance reconciliation records a third actor and rejects the poster", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  await db.query(`
    insert into core.finance_close_entries(
      id,period_start,period_end,entry_type,source_module,source_reference,amount,status,
      evidence_url,prepared_by,posted_by,posted_at,updated_at
    ) values ($1,current_date,current_date,'event_settlement','events','event-1',10,'posted',
      'evidence://event-1',$2,$3,now(),now())
  `, [id, ACTOR_ID, SECOND_ACTOR_ID]);

  await setAuthority({ live: "warehouse:manage_finance_close", uid: SECOND_ACTOR_ID });
  await assert.rejects(
    db.query("select core.manage_finance_close_entry($1::jsonb)", [JSON.stringify({ id, action: "reconcile" })]),
    /third Finance user/i,
  );

  await setAuthority({ live: "warehouse:manage_finance_close", uid: THIRD_ACTOR_ID });
  await db.query("select core.manage_finance_close_entry($1::jsonb)", [JSON.stringify({ id, action: "reconcile" })]);
  const row = await value(`select status,reconciled_by::text as reconciled_by,reconciled_at is not null as reconciled from core.finance_close_entries where id='${id}'`);
  assert.equal(row.reconciled_by, THIRD_ACTOR_ID);
  assert.equal(row.reconciled, true);
});

test("PO cancellation is versioned, idempotent, and returns dependency recovery", async () => {
  await exec(`
    insert into procurement.requests(id,status,submitted_at) values ('request-1','approved',now());
    insert into procurement.purchase_orders(id,request_id,status) values ('po-free','request-1','issued'),('po-blocked','request-1','issued');
    insert into procurement.receipts(id,purchase_order_id) values ('receipt-1','po-blocked');
  `);
  await setAuthority({ live: "procurement:cancel_purchase_order", uid: ACTOR_ID });
  const payload = { id: "po-free", reason: "Supplier scope withdrawn", expected_version: 1, idempotency_key: "cancel-po-free" };
  const first = await db.query("select procurement.cancel_purchase_order($1::jsonb) as result", [JSON.stringify(payload)]);
  const replay = await db.query("select procurement.cancel_purchase_order($1::jsonb) as result", [JSON.stringify(payload)]);
  assert.equal(first.rows[0].result.cancelled, true);
  assert.deepEqual(replay.rows[0].result, first.rows[0].result);

  const blocked = await db.query("select procurement.cancel_purchase_order($1::jsonb) as result", [JSON.stringify({
    id: "po-blocked", reason: "Supplier scope withdrawn", expected_version: 1, idempotency_key: "cancel-po-blocked",
  })]);
  assert.equal(blocked.rows[0].result.cancelled, false);
  assert.equal(blocked.rows[0].result.recovery_required, true);
  assert.equal(blocked.rows[0].result.blockers[0].type, "procurement_receipt");
});

test("nested v2025 submission validates, versions, and replays authoritatively", async () => {
  const company = Object.fromEntries([
    "tradeName","contactNumber","businessAddress","incorporationDate","incorporationPlace",
    "tin","email","website","principalName","principalEmail","principalContactNumber",
    "correspondenceName","correspondenceEmail","correspondenceContactNumber","productsOrServices",
  ].map((key) => [key, `${key}-value`]));
  company.businessType = "corporation";
  const declaration = {
    accepted: true, noLegalActions: true, disclosureDetails: "", verificationAuthorized: true,
    signerName: "Vendor Signer", signerTitle: "Director", signedAt: "2026-08-14T00:00:00Z",
  };
  const application = {
    policyVersion: "vendor-accreditation-v2025", entityType: "corporation", jurisdiction: "PH",
    company,
    manpower: { countAndExpertise: "10 staff", qualifications: "Qualified", completedProjects: "Three projects" },
    technologyServiceProvider: false, technologyQualifications: [], fieldDispositions: {}, declaration,
  };
  const signature = {
    method: "typed", dataUrl: "data:image/png;base64,AA==", signerName: "Vendor Signer",
    signedAt: "2026-08-14T00:00:00Z", userAgent: "PGlite",
  };
  await exec(`insert into legal.accreditation_cases(id,vendor_id,vendor_name,status) values ('case-submit','${VENDOR_ID}','Vendor','draft')`);
  await setAuthority({ live: "core:submit_accreditation", uid: ACTOR_ID });
  const payload = {
    case_id: "case-submit", application, declaration, signature,
    expected_version: 0, idempotency_key: "submit-case-1",
  };
  const first = await db.query("select legal.submit_vendor_application($1::jsonb) as result", [JSON.stringify(payload)]);
  const replay = await db.query("select legal.submit_vendor_application($1::jsonb) as result", [JSON.stringify(payload)]);
  assert.equal(first.rows[0].result.snapshot.version, 1);
  assert.equal(first.rows[0].result.case.status, "submitted");
  assert.equal(replay.rows[0].result.replayed, true);
});
