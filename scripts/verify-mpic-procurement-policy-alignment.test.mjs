import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { verifyMigrationText } from "./verify-mpic-procurement-policy-alignment.mjs";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql",
  ),
  "utf8",
);
const singlePoReceiptMigration = readFileSync(
  resolve("supabase/migrations/20260714175318_single_po_receipt_authority.sql"),
  "utf8",
);

const BACKFILL_MARKER = "-- Deterministic legacy backfill. Ambiguous values are explicitly marked and";
const RESTORE_MARKER = "-- Restore the effective public submission contract without editing historical";
const migrationBeforeBackfill = migration.slice(0, migration.indexOf(BACKFILL_MARKER));
const migrationBackfill = migration.slice(
  migration.indexOf(BACKFILL_MARKER),
  migration.indexOf(RESTORE_MARKER),
);
const CREATE_WRAPPER_MARKER = "alter function procurement.create_request(jsonb)\n  rename to create_request_pre_policy_route;";
const CREATE_WRAPPER_END_MARKER = "revoke all on function procurement.create_request_pre_policy_route(jsonb)";
const migrationCreateWrapper = migration.slice(
  migration.indexOf(CREATE_WRAPPER_MARKER),
  migration.indexOf(CREATE_WRAPPER_END_MARKER),
);
const TASK_6_MARKER = "-- Task 6: competitive sourcing is governed by the effective profile";
const TASK_10_MARKER = '-- Task 10 terminal controls. Legal/VMO owns vendor state; Procurement only';
const TASK_10_END_MARKER = '-- Task 10 terminal controls end.';
const TASK_10_FIX_TERMINAL_MARKER = '-- Task 10 fix round 1 terminal override. All later definitions are PO-only.';
const TASK_9_LAST_MARKER = '-- Task 9 terminal override: this location is after all lifecycle compatibility';
const PAYMENT_STALENESS_TRIGGER_MARKER = 'create or replace function private.invalidate_payment_readiness_for_acceptance_change()';
const PAYMENT_STALENESS_TRIGGER_END = 'from public,anon,authenticated;';
const LEGACY_CLEARANCE_BACKFILL_MARKER = '-- Preserve the former Legal authority deterministically before the stricter';
const LEGACY_CLEARANCE_BACKFILL_END = 'on conflict (legacy_disposition_id) do nothing;';
const migrationTask6 = migration.slice(
  migration.indexOf(TASK_6_MARKER),
  migration.indexOf(TASK_10_MARKER),
) + migration.slice(migration.indexOf(TASK_10_END_MARKER) + TASK_10_END_MARKER.length);
const migrationTask10 = migration.slice(
  migration.indexOf(TASK_10_MARKER),
  migration.indexOf(TASK_10_END_MARKER),
) + migration.slice(
  migration.indexOf(TASK_10_FIX_TERMINAL_MARKER),
  migration.indexOf(TASK_9_LAST_MARKER),
);
const migrationPaymentStalenessTrigger = singlePoReceiptMigration.slice(
  singlePoReceiptMigration.indexOf(PAYMENT_STALENESS_TRIGGER_MARKER),
  singlePoReceiptMigration.indexOf(PAYMENT_STALENESS_TRIGGER_END, singlePoReceiptMigration.indexOf(PAYMENT_STALENESS_TRIGGER_MARKER)) + PAYMENT_STALENESS_TRIGGER_END.length,
);
const migrationLegacyClearanceBackfill = migration.slice(
  migration.indexOf(LEGACY_CLEARANCE_BACKFILL_MARKER),
  migration.indexOf(LEGACY_CLEARANCE_BACKFILL_END, migration.indexOf(LEGACY_CLEARANCE_BACKFILL_MARKER)) + LEGACY_CLEARANCE_BACKFILL_END.length,
);
// PGlite 0.5 does not implement jsonb_object_length. The production migration
// retains PostgreSQL's native function; this equivalent fixture expression
// lets the public policy RPCs execute locally rather than reducing the test
// to source inspection.
const migrationBeforeBackfillForPglite = migrationBeforeBackfill.replace(
  "jsonb_object_length(p_profile.control_sources) <> 16",
  "(select count(*) from pg_catalog.jsonb_object_keys(p_profile.control_sources)) <> 16",
);

const actorId = "00000000-0000-0000-0000-000000000001";
const parentProfileId = "00000000-0000-0000-0000-000000000002";
const operatingProfileId = "00000000-0000-0000-0000-000000000003";
const checkerId = "00000000-0000-0000-0000-000000000004";
const unauthorizedActorId = "00000000-0000-0000-0000-000000000005";

function sqlJson(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

async function createGovernedRouteFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema procurement;
    create schema legal;
    create schema private;
    create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select '${actorId}'::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_live_cap(text, text) returns boolean language sql stable as $$ select true $$;
    create function core.has_cap(text, text) returns boolean language sql stable as $$ select true $$;
    create function core.current_vendor_id() returns uuid language sql stable as $$ select null::uuid $$;
    create function extensions.digest(bytea, text) returns bytea language sql immutable as $$ select decode('00', 'hex') $$;
    create function private.policy_submit_procurement_request(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function procurement.insufficient_bid_exception(jsonb) returns jsonb language sql as $$ select null::jsonb $$;
    create table core.profiles (id uuid primary key, vendor_id uuid, full_name text, status text not null default 'active');
    create table core.vendors (id uuid primary key, legal_name text, accreditation_status text default 'approved', accreditation_expires_at timestamptz);
    create table legal.accreditation_cases (id text primary key, vendor_id uuid references core.vendors(id), jurisdiction text);
    create table legal.accreditation_dispositions (id uuid primary key default gen_random_uuid(), case_id text references legal.accreditation_cases(id), disposition text, reason text not null default 'fixture', conditions jsonb not null default '{}'::jsonb, follow_up_due_at timestamptz, decided_by uuid references core.profiles(id), decided_at timestamptz not null default statement_timestamp());
    create table procurement.requests (
      id uuid primary key,
      status text,
      estimated_amount numeric,
      requirement_kind text,
      solicitation_type text,
      procurement_mode text,
      governance_tier text,
      policy_profile_id uuid,
      route_reasons jsonb,
      sourcing_method text,
      sourcing_override boolean,
      category text,
      lines jsonb default '[]'::jsonb,
      compliance jsonb default '{}'::jsonb,
      attachments jsonb default '[]'::jsonb,
      department text,
      core_vendor_id uuid,
      vendor_name text,
      requester_id uuid,
      draft_payload jsonb,
      title text,
      cost_center text,
      updated_at timestamptz default now()
    );
    create table procurement.route_decisions (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null references procurement.requests(id),
      policy_version text not null,
      request_version integer not null default 1,
      method text not null,
      reasons text[] not null default '{}',
      risk_facts jsonb not null default '{}'::jsonb,
      status text not null default 'confirmed',
      confirmed_by uuid references core.profiles(id),
      confirmed_at timestamptz not null default now(),
      unique(request_id, request_version)
    );
    create table procurement.exception_packs (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null references procurement.requests(id),
      exception_type text not null,
      justification text not null default 'fixture justification value',
      evidence jsonb not null default '{}'::jsonb,
      price_reasonableness text,
      procurement_head_reviewed_by uuid references core.profiles(id),
      procurement_head_reviewed_at timestamptz,
      status text not null default 'draft'
    );
    create table procurement.purchase_orders (
      id text primary key,
      request_id uuid references procurement.requests(id),
      core_vendor_id uuid references core.vendors(id),
      po_number text,
      vendor_name text,
      status text not null default 'draft',
      total numeric not null default 0,
      lines jsonb not null default '[]'::jsonb,
      issued_at timestamptz,
      actor_id uuid references core.profiles(id),
      updated_at timestamptz not null default now()
    );
    create table procurement.purchase_order_lifecycle_state (purchase_order_id text primary key references procurement.purchase_orders(id), revision integer not null default 1, sent_at timestamptz, acknowledged_at timestamptz, acknowledgement_due_at timestamptz, acknowledgement_reference text, delivery_notice_at timestamptz, delivery_notice_reference text, quality_recovery_status text not null default 'none', closure_status text not null default 'open', closed_at timestamptz, closed_by uuid, closure_reason text, updated_at timestamptz default now());
    create table procurement.purchase_order_lifecycle_events (id uuid primary key default gen_random_uuid(), purchase_order_id text not null references procurement.purchase_orders(id), event_type text not null, expected_revision integer not null, resulting_revision integer not null, actor_id uuid not null references core.profiles(id), evidence_reference text, payload jsonb not null default '{}'::jsonb, recorded_at timestamptz default now());
    create table procurement.acceptance_packs (id uuid primary key default gen_random_uuid(), purchase_order_id text, status text, exceptions jsonb default '[]'::jsonb);
    create table procurement.payment_readiness_packs (id uuid primary key default gen_random_uuid(), purchase_order_id text, status text, invoice_amount numeric default 0, released_amount numeric default 0, accepted_amount numeric default 0, purchase_order_amount numeric default 0);
    create table procurement.payment_releases (id uuid primary key default gen_random_uuid(), payment_readiness_pack_id uuid, purchase_order_id text, amount numeric, payment_reference text unique, payment_method text, paid_at date, status text default 'posted');
    create table procurement.receipt_status_fixture (purchase_order_id text primary key, outstanding_quantity numeric default 0, rejected_or_quarantined_quantity numeric default 0);
    create view procurement.v_purchase_order_receipt_status as select * from procurement.receipt_status_fixture;
    create table procurement.sourcing_events (
      id uuid primary key default gen_random_uuid(),
      request_id uuid not null references procurement.requests(id),
      route_decision_id uuid not null references procurement.route_decisions(id),
      issued_at timestamptz,
      submission_deadline timestamptz,
      intended_responses integer,
      clarification_log jsonb not null default '[]'::jsonb,
      status text not null default 'draft',
      selected_vendor_id uuid references core.vendors(id),
      closure_note text,
      closed_at timestamptz,
      created_by uuid references core.profiles(id),
      created_at timestamptz not null default now()
    );
    create table procurement.sourcing_responses (
      id uuid primary key default gen_random_uuid(),
      sourcing_event_id uuid not null references procurement.sourcing_events(id),
      vendor_id uuid not null references core.vendors(id),
      invited_at timestamptz,
      received_at timestamptz,
      deadline_compliant boolean,
      proposal_storage_path text,
      commercial jsonb not null default '{}'::jsonb,
      technical jsonb not null default '{}'::jsonb,
      material_exceptions jsonb not null default '[]'::jsonb,
      unique(sourcing_event_id, vendor_id)
    );
    create table procurement.doa_matrices (
      id uuid primary key default gen_random_uuid(),
      version text not null,
      department text not null,
      status text not null default 'active',
      active boolean not null default true,
      effective_at timestamptz not null default now(),
      expires_at timestamptz
    );
    create table procurement.doa_assignments (
      id uuid primary key default gen_random_uuid(),
      matrix_id uuid not null references procurement.doa_matrices(id),
      department text not null,
      category text,
      min_amount numeric not null default 0,
      max_amount numeric,
      tier text not null,
      approver_user_id uuid not null references core.profiles(id),
      active boolean not null default true
    );
    create table core.policy_remediation_queue (
      id uuid primary key default gen_random_uuid(),
      module text not null,
      entity_type text not null,
      entity_id text not null,
      policy_version text not null,
      reason_code text not null,
      details jsonb not null default '{}'::jsonb,
      status text not null default 'open',
      unique(module, entity_type, entity_id, policy_version, reason_code)
    );
    -- This represents the already-applied request contract. The policy
    -- migration renames this public function, then layers classification and
    -- solicitation-brief validation around the same public boundary.
    create function procurement.create_request(payload jsonb)
    returns jsonb
    language plpgsql
    as $$
    declare v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
    begin
      if not core.has_cap('procurement', 'create_request') then
        raise exception 'Not authorized: procurement.create_request';
      end if;
      insert into procurement.requests(
        id, status, estimated_amount, sourcing_method, category, lines,
        compliance, requester_id, draft_payload
      ) values (
        v_id, 'draft', coalesce((payload->>'estimated_amount')::numeric, 0),
        coalesce(payload->>'sourcing_method', 'rfq'), coalesce(payload->>'category', 'goods'),
        coalesce(payload->'lines', '[]'::jsonb), coalesce(payload->'compliance', '{}'::jsonb),
        auth.uid(), null
      );
      return jsonb_build_object('id', v_id);
    end;
    $$;
    create function procurement.finalize_request_draft(payload jsonb)
    returns jsonb
    language plpgsql
    as $$
    declare v_id uuid := (payload->>'id')::uuid;
    begin
      if not core.has_cap('procurement', 'create_request') then
        raise exception 'Not authorized: procurement.finalize_request_draft';
      end if;
      perform 1 from procurement.requests
      where id = v_id and requester_id = auth.uid() and status = 'draft' and draft_payload is not null
      for update;
      if not found then raise exception 'Owned server draft not found'; end if;
      delete from procurement.requests where id = v_id and requester_id = auth.uid();
      return procurement.create_request(payload);
    end;
    $$;
    insert into core.profiles(id, status) values ('${actorId}', 'active');
  `);
  return db;
}

async function seedActivePolicyProfiles(db) {
  const controlSources = Object.fromEntries([
    "formalBidAmount", "inviteTargetMin", "inviteTargetMax", "sealedBidMinimumResponses",
    "bidWindowWorkingDays", "maxExtensionWorkingDays", "vendorAcknowledgementHours",
    "clarificationHours", "tabulationHours", "technicalEvaluationWorkingDays",
    "poAcknowledgementHours", "repeatOrderMaxAmount", "repeatOrderMaxAgeDays",
    "pettyCashMaxAmount", "poInvoiceThreshold", "vendorProbationMonths",
  ].map((key) => [key, "fixture control source"]));
  await db.exec(`
    insert into procurement.policy_profiles (
      id, code, version, name, relationship, source_profile_id, source_filename, source_organization,
      control_sources, formal_bid_amount, invite_target_min, invite_target_max, sealed_bid_minimum_responses,
      bid_window_working_days, max_extension_working_days, vendor_acknowledgement_hours,
      clarification_hours, tabulation_hours, technical_evaluation_working_days, po_acknowledgement_hours,
      repeat_order_max_amount, repeat_order_max_age_days, petty_cash_max_amount, po_invoice_threshold,
      vendor_probation_months, status, effective_from, document_hash, created_by, last_modified_by
    ) values
      ('${parentProfileId}', 'MPIC-FIXTURE', '2025.02', 'MPIC fixture', 'parent_source', null,
       'MPIC Procurement Policy February2025.docx', 'MPIC', ${sqlJson(controlSources)}, null,
       3, 4, 3, 7, 7, 24, 48, 48, 5, 48, 250000, 365, 2000, 50000, 6,
       'active', now() - interval '1 day', repeat('a', 32), '${actorId}', '${actorId}'),
      ('${operatingProfileId}', 'MWELL-FIXTURE', '2026.01', 'Mwell fixture', 'mwell_operating', '${parentProfileId}',
       'mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx', 'Mwell', ${sqlJson(controlSources)}, 1000000,
       3, 4, 3, 7, 7, 24, 48, 48, 5, 48, 250000, 365, 2000, 50000, 6,
       'active', now() - interval '1 day', repeat('b', 32), '${actorId}', '${actorId}');
  `);
}

async function setPolicyActor(db, actor, canManage, procurementCapabilities = [], vendorId = null, legalCapabilities = []) {
  const capabilityArray = procurementCapabilities.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${procurementCapabilities.map((capability) => `'${capability.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
  const legalCapabilityArray = legalCapabilities.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${legalCapabilities.map((capability) => `'${capability.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
  await db.exec(`
    create schema if not exists test;
    create table if not exists test.policy_actor_context (
      actor_id uuid not null,
      can_manage boolean not null,
      procurement_capabilities text[] not null default '{}',
      legal_capabilities text[] not null default '{}',
      vendor_id uuid
    );
    alter table test.policy_actor_context add column if not exists procurement_capabilities text[] not null default '{}';
    alter table test.policy_actor_context add column if not exists legal_capabilities text[] not null default '{}';
    truncate test.policy_actor_context;
    insert into test.policy_actor_context(actor_id, can_manage, procurement_capabilities, legal_capabilities, vendor_id)
    values ('${actor}', ${canManage ? 'true' : 'false'}, ${capabilityArray}, ${legalCapabilityArray}, ${vendorId ? `'${vendorId}'::uuid` : 'null'});
    create or replace function auth.uid() returns uuid language sql stable security definer as $$
      select actor_id from test.policy_actor_context limit 1
    $$;
    create or replace function core.has_live_cap(text, text) returns boolean language sql stable security definer as $$
      select can_manage
        or ($1 = 'procurement' and $2 = any(procurement_capabilities))
        or ($1 = 'legal' and $2 = any(legal_capabilities))
      from test.policy_actor_context
      limit 1
    $$;
    create or replace function core.current_vendor_id() returns uuid language sql stable security definer as $$
      select vendor_id from test.policy_actor_context limit 1
    $$;
  `);
}

function policyControlSources(relationship) {
  const mpic = "MPIC Procurement Policy February2025.docx (February 2025)";
  const mwell = "mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx (local operating policy)";
  return Object.fromEntries([
    "formalBidAmount", "inviteTargetMin", "inviteTargetMax", "sealedBidMinimumResponses",
    "bidWindowWorkingDays", "maxExtensionWorkingDays", "vendorAcknowledgementHours",
    "clarificationHours", "tabulationHours", "technicalEvaluationWorkingDays",
    "poAcknowledgementHours", "repeatOrderMaxAmount", "repeatOrderMaxAgeDays",
    "pettyCashMaxAmount", "poInvoiceThreshold", "vendorProbationMonths",
  ].map((key) => [key, relationship === "mwell_operating" && key === "formalBidAmount" ? mwell : mpic]));
}

function policyControls() {
  return {
    formalBidAmount: 1000000,
    inviteTargetMin: 3,
    inviteTargetMax: 4,
    sealedBidMinimumResponses: 3,
    bidWindowWorkingDays: 7,
    maxExtensionWorkingDays: 7,
    vendorAcknowledgementHours: 24,
    clarificationHours: 48,
    tabulationHours: 48,
    technicalEvaluationWorkingDays: 5,
    poAcknowledgementHours: 48,
    repeatOrderMaxAmount: 250000,
    repeatOrderMaxAgeDays: 365,
    pettyCashMaxAmount: 2000,
    poInvoiceThreshold: 50000,
    vendorProbationMonths: 6,
  };
}

function formatManilaDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function insertRequest(db, {
  id,
  sourcingMethod = "rfq",
  category = "goods",
  amount = 250000,
  requirementKind = null,
  solicitationRequirements = { acceptanceCriteria: "accept", deliveryTerms: "deliver", paymentTerms: "net 30", shippingTerms: "DAP", validityPeriod: "30 days", responseDeadline: "2026-10-01" },
  compliance = {},
  lines = [{ description: "fixture evidence" }],
}) {
  await db.exec(`
    insert into procurement.requests(
      id, status, estimated_amount, requirement_kind, sourcing_method, category, lines,
      compliance, solicitation_requirements, requester_id
    ) values (
      '${id}', 'draft', ${amount}, ${requirementKind ? `'${requirementKind}'` : "null"},
      '${sourcingMethod}', '${category}', ${sqlJson(lines)}, ${sqlJson(compliance)}, ${sqlJson(solicitationRequirements)}, '${actorId}'
    );
  `);
}

async function insertConfirmedDecision(db, requestId) {
  await db.exec(`
    insert into procurement.route_decisions(
      request_id, policy_version, request_version, method, reasons, risk_facts, status, confirmed_by
    ) values (
      '${requestId}', 'legacy:1', 1, 'rfq', array['legacy'], '{}'::jsonb, 'confirmed', '${actorId}'
    );
  `);
}

test("accepts the hardened MPIC procurement policy migration", () => {
  assert.deepEqual(verifyMigrationText(migration).failures, []);
});

test("rejects unsafe policy-governance migration variants", () => {
  const cases = [
    {
      name: "permissive governed RLS write policy",
      sql: migration.replace(
        "with check (private.policy_profile_can_manage());",
        "with check (true);",
      ),
      failure: "permissive governed write RLS policy",
    },
    {
      name: "broad service-role table mutation grant",
      sql: `${migration}\ngrant all on procurement.policy_profiles to service_role;`,
      failure: "broad service_role policy-table grant",
    },
    {
      name: "unsafe public policy RPC search path",
      sql: migration.replace(
        "create or replace function procurement.save_policy_profile(payload jsonb)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = ''",
        "create or replace function procurement.save_policy_profile(payload jsonb)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = procurement, public",
      ),
      failure: "unsafe policy RPC search_path",
    },
    {
      name: "two-actor draft-edit then self-activation bypass",
      sql: migration.replace(
        "if v_profile.last_modified_by is not distinct from v_actor then\n    raise exception 'A separate policy checker must activate the profile';",
        "if v_profile.created_by is not distinct from v_actor then\n    raise exception 'A separate policy checker must activate the profile';",
      ),
      failure: "missing latest-modifier maker-checker control",
    },
    {
      name: "missing operating-profile lineage validation",
      sql: migration.replaceAll(
        "private.policy_profile_validate_profile",
        "private.removed_policy_profile_validation",
      ),
      failure: "missing policy lineage and control-source validation",
    },
    {
      name: "missing sealed-bid invitation ceiling",
      sql: migration.replace(
        "and sealed_bid_minimum_responses <= invite_target_max",
        "",
      ),
      failure: "missing sealed-bid invitation ceiling",
    },
    {
      name: "missing positive formal-bid threshold for the operating profile",
      sql: migration.replace(
        "and formal_bid_amount is not null and formal_bid_amount > 0",
        "",
      ),
      failure: "missing relationship-aware operating-profile constraint",
    },
    {
      name: "incomplete control-source mapping can include unknown controls",
      sql: migration.replace(
        "jsonb_object_length(p_profile.control_sources) <> 16 or ",
        "",
      ),
      failure: "missing complete control_sources constraint",
    },
    {
      name: "placeholder governed RPC body",
      sql: migration.replace(
        "perform private.policy_profile_validate_profile(v_profile, false);",
        "return to_jsonb(v_profile);",
      ),
      failure: "placeholder save_policy_profile body",
    },
    {
      name: "route confirmation without an optimistic version guard",
      sql: migration.replace(
        "if v_expected_version is null or v_expected_version <> p_current_version then",
        "if false then",
      ),
      failure: "missing governed route version guard",
    },
    {
      name: "legacy ambiguity silently bypasses remediation",
      sql: migration.replaceAll("legacy_mapping_requires_review", "legacy_mapping_removed"),
      failure: "missing legacy route remediation marker",
    },
    {
      name: "private Task 8 binding helper is directly executable",
      sql: migration.replace(
        "revoke execute on function private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles) from public, anon, authenticated;",
        "-- private Task 8 binding helper revocation removed",
      ),
      failure: "missing private Task 8 execution revocation private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles)",
    },
    {
      name: "private Task 8 binding helper revocation appears before its final definition",
      sql: (() => {
        const bindingDefinition = "create or replace function private.policy_exception_pack_binding_blockers(";
        const bindingRevocation = "revoke execute on function private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles) from public, anon, authenticated;";
        return migration
          .replace(bindingRevocation, "")
          .replace(bindingDefinition, `${bindingRevocation}\n\n${bindingDefinition}`);
      })(),
      failure: "private binding helper revocation must immediately follow its final definition",
    },
  ];

  for (const { name, sql, failure } of cases) {
    assert.ok(
      verifyMigrationText(sql).failures.includes(failure),
      `${name} was accepted by the migration verifier`,
    );
  }
});

test("requires profile, route, RLS, and hardened RPC controls", () => {
  const result = verifyMigrationText("");

  assert.ok(result.failures.includes("missing procurement.policy_profiles"));
  assert.ok(result.failures.includes("missing solicitation_type"));
  assert.ok(result.failures.includes("missing empty search_path"));
  assert.ok(result.failures.includes("missing governed activation locking"));
  assert.ok(result.failures.includes("missing governed write RLS policy"));
});

test("rejects migration variants that weaken best-value or variance controls", () => {
  const cases = [
    {
      sql: migration.replaceAll("The recommendation author cannot approve their own variance", "Variance self approval allowed"),
      failure: "missing best-value governance control the recommendation author cannot approve their own variance",
    },
    {
      sql: migration.replaceAll("policy_evaluation_event", "removed_evaluation_event"),
      failure: "missing hardened best-value RPC procurement.save_commercial_tabulation",
    },
    {
      sql: migration.replaceAll("Finance approval must be independent from the Department Head decision", "dual stage approval allowed"),
      failure: "missing best-value governance control finance approval must be independent from the department head decision",
    },
    {
      sql: migration.replaceAll("A submitted technical evaluation is required for every usable response", "single evaluation accepted"),
      failure: "missing best-value governance control a submitted technical evaluation is required for every usable response",
    },
  ];
  for (const { sql, failure } of cases) {
    assert.ok(verifyMigrationText(sql).failures.includes(failure));
  }
});

test('requires Task 10 Legal/VMO authority, scope-bound clearance, custody, and server-derived payment controls', () => {
  const result = verifyMigrationText(migration);
  assert.deepEqual(
    result.failures.filter((failure) => failure.includes('Task 10')),
    [],
    'Task 10 controls must be present in the authoritative migration',
  );

  const weakened = migration.replaceAll(
    'private.policy_assert_request_vendor_eligible',
    'removed_vendor_eligibility_guard',
  );
  assert.ok(
    verifyMigrationText(weakened).failures.includes(
      'missing hardened Task 10 RPC procurement.invite_sourcing_vendors',
    ),
  );
});

test("requires explicit requirement classification before the create wrapper persists a request", () => {
  assert.match(migration, /alter function procurement\.create_request\(jsonb\)\s+rename to create_request_pre_policy_route/i);
  assert.match(migration, /v_requirement_kind not in \('materials', 'services'\)/);
  assert.match(migration, /An explicit requirement_kind of materials or services is required/);
  assert.match(migration, /set requirement_kind = v_requirement_kind/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('alter function procurement.create_request(jsonb)')),
    /set\s+solicitation_type\s*=/i,
  );
});

test("keeps every Task 8 private helper non-executable by application roles", async () => {
  const db = await createGovernedRouteFixture();
  const signature = "private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles)";
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    const privileges = await db.query(`
      select
        has_function_privilege('anon', '${signature}'::regprocedure, 'execute') as anon_execute,
        has_function_privilege('authenticated', '${signature}'::regprocedure, 'execute') as authenticated_execute,
        has_function_privilege('service_role', '${signature}'::regprocedure, 'execute') as service_role_execute
    `);
    assert.deepEqual(privileges.rows[0], {
      anon_execute: false,
      authenticated_execute: false,
      service_role_execute: false,
    });
  } finally {
    await db.close();
  }
});

test("executes public create and draft finalization with normalized RFQ and RFP briefs", async () => {
  const db = await createGovernedRouteFixture();
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationCreateWrapper);

    const rfqRequirements = {
      acceptanceCriteria: "Serialized devices match the approved specification",
      deliveryTerms: "Deliver to Pasig warehouse",
      paymentTerms: "Net 30 after accepted receipt",
      shippingTerms: "DAP Pasig",
      validityPeriod: "30 calendar days",
      responseDeadline: "2026-09-30",
      ignoredNull: null,
    };
    const rfqId = "31000000-0000-0000-0000-000000000001";
    const created = await db.query(`
      select procurement.create_request(${sqlJson({
        id: rfqId,
        requirement_kind: "materials",
        requested_mode: "competitive_bidding",
        estimated_amount: 250000,
        category: "goods",
        lines: [{ description: "Serialized device" }],
        solicitation_requirements: rfqRequirements,
      })}) as request
    `);
    assert.equal(created.rows[0].request.id, rfqId);
    const reloadedRfq = await db.query(`
      select requirement_kind, solicitation_requirements from procurement.requests where id = '${rfqId}'
    `);
    assert.equal(reloadedRfq.rows[0].requirement_kind, "materials");
    assert.deepEqual(reloadedRfq.rows[0].solicitation_requirements, {
      acceptanceCriteria: rfqRequirements.acceptanceCriteria,
      deliveryTerms: rfqRequirements.deliveryTerms,
      paymentTerms: rfqRequirements.paymentTerms,
      shippingTerms: rfqRequirements.shippingTerms,
      validityPeriod: rfqRequirements.validityPeriod,
      responseDeadline: rfqRequirements.responseDeadline,
    });
    assert.ok(!("ignoredNull" in reloadedRfq.rows[0].solicitation_requirements), "public create strips null brief fields before persistence");

    const rfpRequirements = {
      scopeOfWork: "Operate the managed fulfillment service",
      evaluationApproach: "Assess technical capability, delivery plan, and commercial value",
      responseDeadline: "2026-10-07",
    };
    const rfpDraftId = "31000000-0000-0000-0000-000000000002";
    await db.exec(`
      insert into procurement.requests(
        id, status, estimated_amount, sourcing_method, category, lines, compliance, requester_id, draft_payload
      ) values (
        '${rfpDraftId}', 'draft', 350000, 'rfp', 'services',
        ${sqlJson([{ description: "Managed service" }])}, '{}'::jsonb, '${actorId}',
        ${sqlJson({ id: rfpDraftId, requirement_kind: "services", solicitation_requirements: rfpRequirements })}
      )
    `);
    const finalized = await db.query(`
      select procurement.finalize_request_draft(${sqlJson({
        id: rfpDraftId,
        requirement_kind: "services",
        requested_mode: "competitive_bidding",
        estimated_amount: 350000,
        category: "services",
        lines: [{ description: "Managed service" }],
        solicitation_requirements: rfpRequirements,
      })}) as request
    `);
    assert.equal(finalized.rows[0].request.id, rfpDraftId);
    const reloadedRfp = await db.query(`
      select requirement_kind, solicitation_requirements, draft_payload from procurement.requests where id = '${rfpDraftId}'
    `);
    assert.equal(reloadedRfp.rows[0].requirement_kind, "services");
    assert.deepEqual(reloadedRfp.rows[0].solicitation_requirements, rfpRequirements);
    assert.equal(reloadedRfp.rows[0].draft_payload, null, "finalization replaces the server draft atomically");

    const requiredKeys = {
      rfq: ["acceptanceCriteria", "deliveryTerms", "paymentTerms", "shippingTerms", "validityPeriod", "responseDeadline"],
      rfp: ["scopeOfWork", "evaluationApproach", "responseDeadline"],
    };
    let invalidCase = 3;
    for (const [solicitation, keys] of Object.entries(requiredKeys)) {
      const complete = solicitation === "rfq" ? rfqRequirements : rfpRequirements;
      for (const key of keys) {
        const invalid = { ...complete };
        delete invalid[key];
        const invalidId = `31000000-0000-0000-0000-${String(invalidCase++).padStart(12, "0")}`;
        await assert.rejects(
          () => db.query(`select procurement.create_request(${sqlJson({
            id: invalidId,
            requirement_kind: solicitation === "rfq" ? "materials" : "services",
            requested_mode: "competitive_bidding",
            estimated_amount: 1,
            category: solicitation === "rfq" ? "goods" : "services",
            lines: [{ description: "Validation fixture" }],
            solicitation_requirements: invalid,
          })})`),
          new RegExp(`Missing required ${key} solicitation requirement`),
          `${solicitation.toUpperCase()} ${key} must be rejected at the public create boundary`,
        );
      }
    }

    const invalidFinalizations = [
      {
        name: "RFQ finalization missing delivery terms",
        id: "31000000-0000-0000-0000-000000000020",
        requirementKind: "materials",
        category: "goods",
        requirements: Object.fromEntries(
          Object.entries(rfqRequirements).filter(([key]) => key !== "deliveryTerms" && key !== "ignoredNull"),
        ),
        expected: /Missing required deliveryTerms solicitation requirement/,
      },
      {
        name: "RFP finalization missing scope of work",
        id: "31000000-0000-0000-0000-000000000021",
        requirementKind: "services",
        category: "services",
        requirements: Object.fromEntries(
          Object.entries(rfpRequirements).filter(([key]) => key !== "scopeOfWork"),
        ),
        expected: /Missing required scopeOfWork solicitation requirement/,
      },
    ];
    for (const scenario of invalidFinalizations) {
      const originalDraft = {
        id: scenario.id,
        marker: `${scenario.requirementKind}-owned-draft-must-survive`,
        solicitation_requirements: scenario.requirements,
      };
      await db.exec(`
        insert into procurement.requests(
          id, status, estimated_amount, sourcing_method, category, lines, compliance, requester_id, draft_payload
        ) values (
          '${scenario.id}', 'draft', 1, '${scenario.requirementKind === "materials" ? "rfq" : "rfp"}', '${scenario.category}',
          ${sqlJson([{ description: "Rollback fixture" }])}, '{}'::jsonb, '${actorId}', ${sqlJson(originalDraft)}
        )
      `);
      await assert.rejects(
        () => db.query(`select procurement.finalize_request_draft(${sqlJson({
          id: scenario.id,
          requirement_kind: scenario.requirementKind,
          requested_mode: "competitive_bidding",
          estimated_amount: 1,
          category: scenario.category,
          lines: [{ description: "Rollback fixture" }],
          solicitation_requirements: scenario.requirements,
        })})`),
        scenario.expected,
        scenario.name,
      );
      const retainedDraft = await db.query(`
        select id, status, requester_id, draft_payload
        from procurement.requests where id = '${scenario.id}'
      `);
      assert.equal(retainedDraft.rows.length, 1, `${scenario.name} must not consume the owned draft`);
      assert.deepEqual(
        retainedDraft.rows[0],
        { id: scenario.id, status: "draft", requester_id: actorId, draft_payload: originalDraft },
        `${scenario.name} must rollback the delete before the delegated public create fails`,
      );
    }
  } finally {
    await db.close();
  }
});

test("executes governed policy-profile hydration, conflict resolution, independent activation, and history", async () => {
  const db = await createGovernedRouteFixture();
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await db.exec(`
      insert into core.profiles(id, status) values
        ('${checkerId}', 'active'),
        ('${unauthorizedActorId}', 'active');
    `);
    await setPolicyActor(db, actorId, true);

    const parentControls = policyControls();
    parentControls.formalBidAmount = null;
    await db.exec(`
      insert into procurement.policy_profiles (
        id, code, version, name, relationship, source_profile_id, source_filename, source_organization,
        control_sources, formal_bid_amount, invite_target_min, invite_target_max, sealed_bid_minimum_responses,
        bid_window_working_days, max_extension_working_days, vendor_acknowledgement_hours,
        clarification_hours, tabulation_hours, technical_evaluation_working_days, po_acknowledgement_hours,
        repeat_order_max_amount, repeat_order_max_age_days, petty_cash_max_amount, po_invoice_threshold,
        vendor_probation_months, status, effective_from, document_hash, created_by, last_modified_by
      ) values (
        '${parentProfileId}', 'MPIC-PROCUREMENT-2025-02', '2025.02', 'MPIC parent source', 'parent_source', null,
        'MPIC Procurement Policy February2025.docx', 'MPIC', ${sqlJson(policyControlSources('parent_source'))}, null,
        3, 4, 3, 7, 7, 24, 48, 48, 5, 48, 250000, 365, 2000, 50000, 6,
        'active', now() - interval '1 day', repeat('c', 64), '${actorId}', '${actorId}'
      )
    `);

    const payload = {
      code: "MWELL-UAT-POLICY-REV",
      version: "2026.08.22",
      name: "Mwell operating policy revision",
      relationship: "mwell_operating",
      source_profile_id: parentProfileId,
      source_filename: "mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx",
      source_organization: "Mwell",
      control_sources: policyControlSources("mwell_operating"),
      controls: policyControls(),
      effective_from: "2026-08-01T00:00:00+08:00",
      document_hash: "d".repeat(64),
    };

    await setPolicyActor(db, unauthorizedActorId, false);
    await assert.rejects(
      () => db.query(`select procurement.save_policy_profile(${sqlJson(payload)})`),
      /Not authorized to manage procurement policy profiles/,
      "unauthorized users cannot create governed policy drafts",
    );

    await setPolicyActor(db, actorId, true);
    const saved = await db.query(`select procurement.save_policy_profile(${sqlJson(payload)}) as profile`);
    const draftId = saved.rows[0].profile.id;
    assert.ok(draftId, "save returns the persisted draft identity");
    const draftReload = await db.query(`
      select id, code, version, source_profile_id, status, created_by, last_modified_by
      from procurement.policy_profiles where id = '${draftId}'
    `);
    assert.deepEqual(draftReload.rows[0], {
      id: draftId,
      code: payload.code,
      version: payload.version,
      source_profile_id: parentProfileId,
      status: "draft",
      created_by: actorId,
      last_modified_by: actorId,
    });

    const conflictId = "32000000-0000-0000-0000-000000000001";
    await db.exec(`
      insert into procurement.policy_conflicts(
        id, policy_profile_id, parent_rule, local_rule, impact, created_by
      ) values (
        '${conflictId}', '${draftId}', 'parent invite target', 'local formal-bid procedure',
        'Requires recorded resolution before activation', '${actorId}'
      )
    `);
    await assert.rejects(
      () => db.query(`select procurement.activate_policy_profile(${sqlJson({ id: draftId })})`),
      /separate policy checker/,
      "a policy author cannot activate their own draft",
    );

    await setPolicyActor(db, checkerId, true);
    const resolved = await db.query(`select procurement.resolve_policy_conflict(${sqlJson({
      id: conflictId,
      selected_mapping: "retain_mwell_mapping",
      rationale: "The local operating threshold is separately controlled and attributable.",
    })}) as conflict`);
    assert.equal(resolved.rows[0].conflict.status, "resolved");
    const activated = await db.query(`select procurement.activate_policy_profile(${sqlJson({ id: draftId })}) as profile`);
    assert.equal(activated.rows[0].profile.status, "active");
    assert.equal(activated.rows[0].profile.activated_by, checkerId);

    const effective = await db.query(`select procurement.get_effective_policy_profile(null) as profile`);
    assert.deepEqual(
      [effective.rows[0].profile.id, effective.rows[0].profile.code, effective.rows[0].profile.version, effective.rows[0].profile.effective_from.slice(0, 10)],
      [draftId, payload.code, payload.version, "2026-08-01"],
      "a fresh effective-profile read returns the exact activated revision",
    );
    const requestId = "32000000-0000-0000-0000-000000000002";
    await insertRequest(db, {
      id: requestId,
      requirementKind: "materials",
      amount: 250000,
      solicitationRequirements: {
        acceptanceCriteria: "Match the approved serialized specification",
        deliveryTerms: "Deliver to Pasig warehouse",
        paymentTerms: "Net 30",
        shippingTerms: "DAP Pasig",
        validityPeriod: "30 days",
        responseDeadline: "2026-09-30",
      },
    });
    await db.query(`select procurement.confirm_route_decision(${sqlJson({
      request_id: requestId,
      expected_route_version: 0,
      requested_mode: "competitive_bidding",
    })})`);
    const refreshedRequest = await db.query(`
      select policy_profile_id, route_version, compliance from procurement.requests where id = '${requestId}'
    `);
    const refreshedProfile = await db.query(`
      select id, code, version, effective_from from procurement.policy_profiles
      where id = '${refreshedRequest.rows[0].policy_profile_id}'
    `);
    assert.deepEqual(
      [
        refreshedRequest.rows[0].policy_profile_id,
        refreshedRequest.rows[0].route_version,
        refreshedRequest.rows[0].compliance.routeConfirmed,
        refreshedProfile.rows[0].id,
        refreshedProfile.rows[0].code,
        refreshedProfile.rows[0].version,
        formatManilaDate(refreshedProfile.rows[0].effective_from),
      ],
      [draftId, 1, true, draftId, payload.code, payload.version, "2026-08-01"],
      "confirmed request refresh retains the exact non-default applied profile",
    );
    const history = await db.query(`
      select event_type, actor_id, profile_actor_id from procurement.policy_profile_events
      where policy_profile_id = '${draftId}' order by event_at, id
    `);
    assert.deepEqual(history.rows.map((event) => event.event_type), ["draft_saved", "conflict_resolved", "activated"]);
    assert.equal(history.rows.at(-1).actor_id, checkerId);
  } finally {
    await db.close();
  }
});

test("executes the migration backfill against persisted legacy procurement records", async () => {
  const db = await createGovernedRouteFixture();
  try {
    // The setup intentionally happens before the migration's backfill CTE runs.
    await db.exec(migrationBeforeBackfill);
    await seedActivePolicyProfiles(db);

    const riskVariants = [
      ["complex", "risk:complex", "complex"],
      ["technical", "risk:technical", "technical"],
      ["strategic", "risk:strategic", "strategic"],
      ["highRisk", "risk:high_risk", "highRisk"],
      ["high_risk", "risk:high_risk", "highRisk"],
      ["dataSensitive", "risk:data_sensitive", "dataSensitive"],
      ["data_sensitive", "risk:data_sensitive", "dataSensitive"],
      ["importation", "risk:importation", "importation"],
    ];

    for (const [index, [inputKey]] of riskVariants.entries()) {
      await insertRequest(db, {
        id: `10000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
        compliance: { riskFacts: { [inputKey]: true } },
      });
    }

    const knownLegacyMethods = [
      ["40000000-0000-0000-0000-000000000001", "rfq", "goods", "rfq", "competitive_bidding"],
      ["40000000-0000-0000-0000-000000000002", "rfp", "services", "rfp", "competitive_bidding"],
      ["40000000-0000-0000-0000-000000000003", "direct_award", "goods", "none", "sole_source"],
      ["40000000-0000-0000-0000-000000000004", "repeat_order", "goods", "none", "repeat_order"],
      ["40000000-0000-0000-0000-000000000005", "emergency", "services", "none", "emergency_purchase"],
      ["40000000-0000-0000-0000-000000000006", "petty_cash", "petty_cash", "none", "petty_cash"],
    ];
    for (const [id, sourcingMethod, category] of knownLegacyMethods) {
      await insertRequest(db, { id, sourcingMethod, category });
    }

    const reviewRequests = {
      small: "20000000-0000-0000-0000-000000000001",
      unknown: "20000000-0000-0000-0000-000000000002",
      ambiguous: "20000000-0000-0000-0000-000000000003",
    };
    await insertRequest(db, { id: reviewRequests.small, sourcingMethod: "small_purchase" });
    await insertRequest(db, { id: reviewRequests.unknown, sourcingMethod: "unrecognized_legacy_method" });
    await insertRequest(db, {
      id: reviewRequests.ambiguous,
      category: "medical",
      lines: [],
    });
    await insertConfirmedDecision(db, reviewRequests.small);
    await insertConfirmedDecision(db, reviewRequests.unknown);
    await insertConfirmedDecision(db, reviewRequests.ambiguous);

    await db.exec(migrationBackfill);

    for (const [index, [inputKey, expectedReason, canonicalKey]] of riskVariants.entries()) {
      const id = `10000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
      const result = await db.query(`
        select solicitation_type, procurement_mode, governance_tier, policy_profile_id,
          route_reasons, compliance
        from procurement.requests where id = '${id}'
      `);
      const request = result.rows[0];
      assert.equal(request.solicitation_type, "rfq", `${inputKey} must persist the derived solicitation`);
      assert.equal(request.procurement_mode, "competitive_bidding", `${inputKey} must persist the derived mode`);
      assert.equal(request.governance_tier, "high_risk", `${inputKey} must persist high-risk governance`);
      assert.equal(request.policy_profile_id, operatingProfileId);
      assert.ok(request.route_reasons.includes(expectedReason), `${inputKey} must retain its normalized reason`);
      assert.equal(request.compliance.riskFacts[canonicalKey], true, `${inputKey} must persist canonical risk facts`);
    }

    for (const [id, sourcingMethod, , solicitationType, procurementMode] of knownLegacyMethods) {
      const result = await db.query(`
        select solicitation_type, procurement_mode, governance_tier, route_reasons
        from procurement.requests where id = '${id}'
      `);
      const request = result.rows[0];
      assert.equal(request.solicitation_type, solicitationType, `${sourcingMethod} must persist its deterministic solicitation`);
      assert.equal(request.procurement_mode, procurementMode, `${sourcingMethod} must persist its deterministic mode`);
      assert.equal(request.governance_tier, "standard", `${sourcingMethod} must persist standard governance without a risk trigger`);
      assert.ok(request.route_reasons.includes("legacy_mapping_deterministic"));
    }

    for (const [kind, id] of Object.entries(reviewRequests)) {
      const requestResult = await db.query(`
        select solicitation_type, procurement_mode, governance_tier, route_reasons
        from procurement.requests where id = '${id}'
      `);
      const request = requestResult.rows[0];
      assert.equal(request.solicitation_type, null, `${kind} must not receive a solicitation route`);
      assert.equal(request.procurement_mode, null, `${kind} must not receive a procurement mode`);
      assert.equal(request.governance_tier, null, `${kind} must not receive a governance tier`);
      assert.ok(request.route_reasons.includes("legacy_mapping_requires_review"));

      const decisions = await db.query(`
        select status from procurement.route_decisions where request_id = '${id}'
      `);
      assert.deepEqual(decisions.rows.map((row) => row.status), ["policy_decision_required"]);

      const queue = await db.query(`
        select count(*)::integer as count from core.policy_remediation_queue
        where entity_id = '${id}' and reason_code = 'legacy_mapping_requires_review'
      `);
      assert.equal(queue.rows[0].count, 1, `${kind} must have exactly one remediation item`);
    }

    const initialQueueCount = await db.query(`select count(*)::integer as count from core.policy_remediation_queue`);
    await db.exec(migrationBackfill);
    const rerunQueueCount = await db.query(`select count(*)::integer as count from core.policy_remediation_queue`);
    assert.equal(rerunQueueCount.rows[0].count, initialQueueCount.rows[0].count, "backfill rerun must be queue-idempotent");

    // Missing controls is intentionally executed after the active profile is removed.
    await db.exec(`update procurement.policy_profiles set status = 'draft' where id = '${operatingProfileId}'`);
    const missingControlsId = "20000000-0000-0000-0000-000000000004";
    await insertRequest(db, { id: missingControlsId });
    await insertConfirmedDecision(db, missingControlsId);
    await db.exec(migrationBackfill);
    const missingControls = await db.query(`
      select solicitation_type, procurement_mode, governance_tier, policy_profile_id, route_reasons,
        route_version, route_confirmed_at, route_confirmed_by, compliance
      from procurement.requests where id = '${missingControlsId}'
    `);
    assert.deepEqual(
      [
        missingControls.rows[0].solicitation_type,
        missingControls.rows[0].procurement_mode,
        missingControls.rows[0].governance_tier,
        missingControls.rows[0].policy_profile_id,
      ],
      [null, null, null, null],
    );
    assert.ok(missingControls.rows[0].route_reasons.includes("legacy_mapping_requires_review"));
    const missingDecision = await db.query(`select status from procurement.route_decisions where request_id = '${missingControlsId}'`);
    assert.equal(missingDecision.rows[0].status, "policy_decision_required");
    const missingQueue = await db.query(`
      select count(*)::integer as count from core.policy_remediation_queue
      where entity_id = '${missingControlsId}' and reason_code = 'legacy_mapping_requires_review'
    `);
    assert.equal(missingQueue.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("executes public governed route confirmation with persisted authority and exception gates", async () => {
  const db = await createGovernedRouteFixture();
  try {
    await db.exec(migrationBeforeBackfill);
    await seedActivePolicyProfiles(db);

    const normalId = "30000000-0000-0000-0000-000000000001";
    await insertRequest(db, { id: normalId, requirementKind: "materials", amount: 5000 });
    const authorityInjection = {
      request_id: normalId,
      expected_route_version: 0,
      requested_mode: "competitive_bidding",
      method: "direct_award",
      solicitation_type: "none",
      procurement_mode: "sole_source",
      governance_tier: "high_risk",
      policy_profile_id: parentProfileId,
      reasons: ["client-controlled"],
    };
    const confirmed = await db.query(`select procurement.confirm_route_decision(${sqlJson(authorityInjection)}) as decision`);
    assert.equal(confirmed.rows[0].decision.status, "confirmed");
    const persisted = await db.query(`
      select solicitation_type, procurement_mode, governance_tier, policy_profile_id, reasons
      from procurement.route_decisions where request_id = '${normalId}'
    `);
    assert.deepEqual(
      [
        persisted.rows[0].solicitation_type,
        persisted.rows[0].procurement_mode,
        persisted.rows[0].governance_tier,
        persisted.rows[0].policy_profile_id,
      ],
      ["rfq", "competitive_bidding", "standard", operatingProfileId],
    );
    assert.ok(!persisted.rows[0].reasons.includes("client-controlled"));
    const request = await db.query(`
      select solicitation_type, procurement_mode, governance_tier, policy_profile_id, route_reasons,
        route_version, route_confirmed_at, route_confirmed_by, compliance
      from procurement.requests where id = '${normalId}'
    `);
    assert.deepEqual(
      [request.rows[0].solicitation_type, request.rows[0].procurement_mode, request.rows[0].governance_tier, request.rows[0].policy_profile_id],
      ["rfq", "competitive_bidding", "standard", operatingProfileId],
    );
    assert.ok(!request.rows[0].route_reasons.includes("client-controlled"));
    assert.equal(request.rows[0].route_version, 1, "request read model must expose the latest decision version after refresh");
    assert.ok(request.rows[0].route_confirmed_at, "request read model must expose confirmation time after refresh");
    assert.equal(request.rows[0].route_confirmed_by, actorId, "request read model must expose the confirming actor after refresh");
    assert.equal(request.rows[0].compliance.routeConfirmed, true, "refresh-shaped request mapping must unlock governed sourcing and submission readiness");

    await assert.rejects(
      () => db.query(`select procurement.confirm_route_decision(${sqlJson({ request_id: normalId, requested_mode: "competitive_bidding" })})`),
      /stale/,
      "missing expected_route_version must reject through the public RPC",
    );
    await assert.rejects(
      () => db.query(`select procurement.confirm_route_decision(${sqlJson({ request_id: normalId, expected_route_version: 0, requested_mode: "competitive_bidding" })})`),
      /stale/,
      "stale expected_route_version must reject through the public RPC",
    );

    // Exception mode coverage is deliberately exercised through the public
    // submit/review matrix below. A bare legacy row is no longer a valid
    // route gate because it has no immutable binding or independent history.
  } finally {
    await db.close();
  }
});

test("executes public parameterized exception review and active-DOA completion", async () => {
  const db = await createGovernedRouteFixture();
  const requestId = "71000000-0000-0000-0000-000000000001";
  const doaReviewerId = "71000000-0000-0000-0000-000000000002";
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    await db.exec(`insert into core.profiles(id, status) values ('${checkerId}', 'active'), ('${doaReviewerId}', 'active');`);
    await insertRequest(db, { id: requestId, requirementKind: "materials", amount: 120000 });
    await db.exec(`update procurement.requests set department = 'operations' where id = '${requestId}';`);
    await setPolicyActor(db, actorId, true);
    const submitted = await db.query(`select procurement.submit_policy_exception_pack(${sqlJson({
      request_id: requestId, mode: "sole_source", justification: "Only the compatible manufacturer can support this clinical integration.", price_reasonableness: "Prior PO and manufacturer list price are attached.", evidence: { soleSourceBasis: "compatibility", evidenceReferences: ["private/sole-source/compatibility.pdf"] },
      expected_route_version: 0,
    })}) as pack`);
    await assert.rejects(
      () => db.query(`select procurement.review_policy_exception_pack(${sqlJson({ id: submitted.rows[0].pack.id, stage: "procurement", decision: "approved", expected_revision: 1, note: "Self review is prohibited." })})`),
      /submitter cannot review/i,
    );
    await setPolicyActor(db, checkerId, true);
    const procurementReview = await db.query(`select procurement.review_policy_exception_pack(${sqlJson({ id: submitted.rows[0].pack.id, stage: "procurement", decision: "approved", expected_revision: 1, note: "Evidence and benchmark reviewed independently." })}) as pack`);
    await db.exec(`
      insert into procurement.doa_matrices(id, version, department, status, active) values ('71000000-0000-0000-0000-000000000003', 'FIXTURE-DOA', 'operations', 'active', true);
      insert into procurement.doa_assignments(id, matrix_id, department, min_amount, max_amount, tier, approver_user_id, active) values ('71000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000003', 'operations', 0, 250000, 'final_approver', '${doaReviewerId}', true);
    `);
    await setPolicyActor(db, doaReviewerId, true);
    const approved = await db.query(`select procurement.review_policy_exception_pack(${sqlJson({ id: submitted.rows[0].pack.id, stage: "doa", decision: "approved", expected_revision: procurementReview.rows[0].pack.revision, note: "Active DOA approval recorded." })}) as pack`);
    assert.equal(approved.rows[0].pack.status, "approved");
    await setPolicyActor(db, actorId, true);
    const route = await db.query(`select procurement.confirm_route_decision(${sqlJson({ request_id: requestId, expected_route_version: 0, requested_mode: "sole_source" })}) as route`);
    assert.equal(route.rows[0].route.route.procurement_mode, "sole_source");
  } finally {
    await db.close();
  }
});

test("executes the public exception lifecycle matrix without actor, evidence, or replay bypasses", async () => {
  const db = await createGovernedRouteFixture();
  const submitter = "73000000-0000-0000-0000-000000000001";
  const procurementReviewer = "73000000-0000-0000-0000-000000000002";
  const financeReviewer = "73000000-0000-0000-0000-000000000003";
  const doaReviewer = "73000000-0000-0000-0000-000000000004";
  const vendorId = "73000000-0000-0000-0000-000000000005";
  const requestId = "73000000-0000-0000-0000-000000000010";
  const pettyId = "73000000-0000-0000-0000-000000000011";
  const emergencyId = "73000000-0000-0000-0000-000000000012";
  const approvedId = "73000000-0000-0000-0000-000000000013";
  const priorId = "73000000-0000-0000-0000-000000000014";
  const repeatId = "73000000-0000-0000-0000-000000000015";
  const gateId = "73000000-0000-0000-0000-000000000016";
  const routeId = "73000000-0000-0000-0000-000000000020";
  const eventId = "73000000-0000-0000-0000-000000000021";
  const tabulationId = "73000000-0000-0000-0000-000000000022";
  const evaluationId = "73000000-0000-0000-0000-000000000023";
  const awardId = "73000000-0000-0000-0000-000000000024";
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    await db.exec(`
      insert into core.profiles(id, status) values ('${submitter}','active'),('${procurementReviewer}','active'),('${financeReviewer}','active'),('${doaReviewer}','active');
      insert into core.vendors(id, legal_name, accreditation_status) values ('${vendorId}','Governed vendor','approved');
      insert into procurement.doa_matrices(id,version,department,status,active) values ('73000000-0000-0000-0000-000000000030','EXC-DOA','operations','active',true);
      insert into procurement.doa_assignments(id,matrix_id,department,min_amount,max_amount,tier,approver_user_id,active) values ('73000000-0000-0000-0000-000000000031','73000000-0000-0000-0000-000000000030','operations',0,250000,'final_approver','${doaReviewer}',true);
    `);
    const addRequest = async (id, amount, lines = [{ description: "controlled tablet", quantity: 1, unitPrice: amount }]) => {
      await insertRequest(db, { id, requirementKind: "materials", amount, lines });
      await db.exec(`update procurement.requests set department='operations', core_vendor_id='${vendorId}' where id='${id}';`);
    };
    const submitPack = (id, mode, evidence, amount = 1000, expectedRouteVersion = 0) => db.query(`select procurement.submit_policy_exception_pack(${sqlJson({ request_id: id, mode, expected_route_version: expectedRouteVersion, justification: "Documented policy exception with complete business rationale.", price_reasonableness: "Independent benchmark and prior commercial evidence attached.", evidence })}) as pack`);
    const review = (id, stage, decision, revision, note = "Independent governed review is complete.") => db.query(`select procurement.review_policy_exception_pack(${sqlJson({ id, stage, decision, expected_revision: revision, note })}) as pack`);
    const confirm = (id, mode, expectedRouteVersion = 0) => db.query(`select procurement.confirm_route_decision(${sqlJson({ request_id: id, expected_route_version: expectedRouteVersion, requested_mode: mode })}) as route`);
    const issuePo = async (id, poId, amount) => {
      await db.exec(`insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,lines,actor_id) values ('${poId}','${id}','${vendorId}','draft',${amount},${sqlJson([{ description: 'controlled item', quantity: 1, unitPrice: amount }])},'${submitter}');`);
      await db.exec(`update procurement.purchase_orders set status='issued', issued_at='2026-08-22T00:00:00Z' where id='${poId}';`);
      const issued = await db.query(`select status from procurement.purchase_orders where id='${poId}'`);
      assert.equal(issued.rows[0].status, 'issued', `${poId} must issue after an approved, route-bound exception`);
    };
    const approve = async (packId, petty = false) => {
      await setPolicyActor(db, procurementReviewer, true, ["approve_award"]);
      let pack = (await review(packId, "procurement", "approved", 1)).rows[0].pack;
      if (petty) {
        await setPolicyActor(db, financeReviewer, false, ["view_finance"]);
        pack = (await review(packId, "finance", "approved", pack.revision)).rows[0].pack;
      }
      await setPolicyActor(db, doaReviewer, false);
      return (await review(packId, "doa", "approved", pack.revision)).rows[0].pack;
    };

    await addRequest(requestId, 120000);
    await setPolicyActor(db, submitter, true);
    await assert.rejects(
      () => submitPack(requestId, "sole_source", { soleSourceBasis: "compatibility", evidenceReferences: [] }),
      /evidence references/i,
      "sole source must require durable evidence",
    );
    const sole = (await submitPack(requestId, "sole_source", { soleSourceBasis: "compatibility", evidenceReferences: ["private/sole.pdf"], procurementReviewed: true, doaApproved: true })).rows[0].pack;
    await assert.rejects(() => review(sole.id, "procurement", "approved", 1), /submitter cannot review/i, "submitter cannot self-review");
    await setPolicyActor(db, procurementReviewer, true, ["approve_award"]);
    const soleProcurement = (await review(sole.id, "procurement", "approved", 1)).rows[0].pack;
    const idempotentReplay = await review(sole.id, "procurement", "approved", 1);
    assert.equal(idempotentReplay.rows[0].pack.revision, soleProcurement.revision, "identical replay is idempotent and creates no second decision");
    await assert.rejects(() => review(sole.id, "procurement", "approved", 1, "Forged replacement decision."), /changed|already recorded/i, "conflicting replay is rejected");
    await setPolicyActor(db, procurementReviewer, true, ["approve_award"]);
    await assert.rejects(() => review(sole.id, "doa", "approved", soleProcurement.revision), /independent/i, "Procurement reviewer cannot become DOA");
    await setPolicyActor(db, doaReviewer, false);
    const soleApproved = (await review(sole.id, "doa", "approved", soleProcurement.revision)).rows[0].pack;
    assert.equal(soleApproved.status, "approved");
    await setPolicyActor(db, submitter, true);
    const confirmed = await confirm(requestId, 'sole_source');
    assert.equal(confirmed.rows[0].route.route.procurement_mode, "sole_source", "approved bound sole-source pack permits route confirmation");
    const soleBinding = await db.query(`select route_decision_id, request_version from procurement.exception_packs where id='${sole.id}'`);
    assert.ok(soleBinding.rows[0].route_decision_id, 'confirmation atomically binds the approved sole-source pack to its route decision');
    assert.equal(soleBinding.rows[0].request_version, 1, 'confirmation rebinds the pack to the confirmed route version');
    await issuePo(requestId, 'sole-post-confirm-po', 120000);

    await addRequest(pettyId, 1000);
    await setPolicyActor(db, submitter, true);
    await assert.rejects(() => submitPack(pettyId, "petty_cash", { splitPurchase: true, recurring: false, receiptPresent: true, liquidationRecorded: true }), /split or recurring/i, "petty cash rejects split purchases");
    const petty = (await submitPack(pettyId, "petty_cash", { splitPurchase: false, recurring: false, receiptPresent: true, liquidationRecorded: true })).rows[0].pack;
    await setPolicyActor(db, procurementReviewer, true, ["approve_award"]);
    const pettyProcurement = (await review(petty.id, "procurement", "approved", 1)).rows[0].pack;
    await assert.rejects(() => review(petty.id, "finance", "approved", pettyProcurement.revision), /independent from submitter and Procurement reviewer/i, "Procurement and Finance must be different actors");
    await setPolicyActor(db, financeReviewer, false, ["view_finance"]);
    const pettyFinance = (await review(petty.id, "finance", "approved", pettyProcurement.revision)).rows[0].pack;
    await assert.rejects(() => review(petty.id, "doa", "approved", pettyFinance.revision), /independent/i, "Finance reviewer cannot become DOA");
    await setPolicyActor(db, doaReviewer, false);
    assert.equal((await review(petty.id, "doa", "approved", pettyFinance.revision)).rows[0].pack.status, "approved");
    await setPolicyActor(db, submitter, true);
    await confirm(pettyId, 'petty_cash');
    await issuePo(pettyId, 'petty-post-confirm-po', 1000);

    await addRequest(emergencyId, 10000);
    await setPolicyActor(db, submitter, true);
    await assert.rejects(() => submitPack(emergencyId, "emergency_purchase", { emergencyBasis: "life_safety", authorityReference: "OPS-EM-1", commitmentTimestamp: "invalid", minimizedVerbalCommitment: true, retrospectivePoDueAt: "2026-09-01T00:00:00Z" }), /commitment timestamp is invalid/i, "emergency timestamp must parse");
    await assert.rejects(() => submitPack(emergencyId, "emergency_purchase", { emergencyBasis: "life_safety", authorityReference: "OPS-EM-1", commitmentTimestamp: "2026-08-01T00:00:00Z", minimizedVerbalCommitment: true, retrospectivePoDueAt: "2026-09-02T00:00:00Z" }), /30-day policy window/i, "emergency retro PO must remain inside its policy window");
    const emergency = (await submitPack(emergencyId, "emergency_purchase", { emergencyBasis: "life_safety", authorityReference: "OPS-EM-1", commitmentTimestamp: "2026-08-01T00:00:00Z", minimizedVerbalCommitment: true, retrospectivePoDueAt: "2026-08-15T00:00:00Z" })).rows[0].pack;
    assert.equal((await approve(emergency.id)).status, "approved", "valid emergency completes independent review");
    await setPolicyActor(db, submitter, true);
    await confirm(emergencyId, 'emergency_purchase');
    await issuePo(emergencyId, 'emergency-post-confirm-po', 10000);

    await addRequest(approvedId, 120000);
    await setPolicyActor(db, submitter, true);
    await assert.rejects(() => submitPack(approvedId, "approved_exception", { approvedExceptionPackId: "73000000-0000-0000-0000-000000000099", evidenceReferences: ["private/source.pdf"] }), /immutable approved eligible pack/i, "forged approved-exception ID is rejected");
    const sourcePackId = sole.id;
    const approved = (await submitPack(approvedId, "approved_exception", { approvedExceptionPackId: sourcePackId, evidenceReferences: ["private/source.pdf"] })).rows[0].pack;
    assert.equal((await approve(approved.id)).status, "approved", "approved-exception source is a real immutable approved pack");
    await setPolicyActor(db, submitter, true);
    await confirm(approvedId, 'approved_exception');
    await issuePo(approvedId, 'approved-exception-post-confirm-po', 120000);

    const sameLines = [{ description: "controlled tablet", quantity: 1, unitPrice: 50000 }];
    await addRequest(priorId, 50000, sameLines);
    await db.exec(`
      insert into procurement.route_decisions(id,request_id,policy_version,request_version,method,reasons,risk_facts,status,confirmed_by,solicitation_type,procurement_mode,governance_tier,policy_profile_id)
      values ('${routeId}','${priorId}','FIXTURE:1',1,'rfq',array['fixture'],'{}','confirmed','${submitter}','rfq','competitive_bidding','standard','${operatingProfileId}');
      insert into procurement.sourcing_events(id,request_id,route_decision_id,status,selected_vendor_id,submission_deadline,original_submission_deadline,closed_at,created_by)
      values ('${eventId}','${priorId}','${routeId}','awarded','${vendorId}',statement_timestamp(),statement_timestamp(),statement_timestamp(),'${submitter}');
      insert into procurement.commercial_tabulations(id,sourcing_event_id,version,response_closed_at,due_at,submitted_by,entries,evidence_reference,status)
      values ('${tabulationId}','${eventId}',1,statement_timestamp(),statement_timestamp(),'${submitter}','[{"vendorId":"${vendorId}","quotedAmount":50000,"paymentTerms":"net 30"}]','private/tabulation.pdf','submitted');
      insert into procurement.technical_evaluations(id,sourcing_event_id,vendor_id,version,due_at,reviewer_id,criteria,total_score,evidence_reference,status)
      values ('${evaluationId}','${eventId}','${vendorId}',1,statement_timestamp(),'${procurementReviewer}','[{"criterion":"technicalCompliance","score":100,"evidenceReference":"e"},{"criterion":"quality","score":100,"evidenceReference":"e"},{"criterion":"leadTime","score":100,"evidenceReference":"e"},{"criterion":"totalLifecycleCost","score":100,"evidenceReference":"e"},{"criterion":"warranty","score":100,"evidenceReference":"e"},{"criterion":"support","score":100,"evidenceReference":"e"},{"criterion":"price","score":100,"evidenceReference":"e"},{"criterion":"paymentTerms","score":100,"evidenceReference":"e"},{"criterion":"training","score":100,"evidenceReference":"e"}]','100','private/evaluation.pdf','submitted');
      insert into procurement.award_recommendations(id,sourcing_event_id,evaluated_vendor_id,recommended_vendor_id,commercial_tabulation_id,technical_evaluation_id,rationale,status,created_by)
      values ('${awardId}','${eventId}','${vendorId}','${vendorId}','${tabulationId}','${evaluationId}','best value','approved','${submitter}');
      insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,lines,issued_at,actor_id) values ('prior-po','${priorId}','${vendorId}','issued',50000,${sqlJson(sameLines)},'2026-08-22T00:00:00Z','${submitter}');
      insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,lines) values
        ('prior-po-draft','${priorId}','${vendorId}','draft',50000,${sqlJson(sameLines)}),
        ('prior-po-pending','${priorId}','${vendorId}','pending_approval',50000,${sqlJson(sameLines)}),
        ('prior-po-approved','${priorId}','${vendorId}','approved',50000,${sqlJson(sameLines)}),
        ('prior-po-cancelled','${priorId}','${vendorId}','cancelled',50000,${sqlJson(sameLines)}),
        ('prior-po-closed','${priorId}','${vendorId}','closed',50000,${sqlJson(sameLines)});
    `);
    for (const [index, sourcePoId] of ['prior-po-draft','prior-po-pending','prior-po-approved','prior-po-cancelled'].entries()) {
      const invalidRepeatId = `73000000-0000-0000-0000-00000000004${index}`;
      await addRequest(invalidRepeatId, 50000, sameLines);
      await setPolicyActor(db, submitter, true);
      await assert.rejects(
        () => submitPack(invalidRepeatId, 'repeat_order', { priorRequestId: priorId, priorSourcingEventId: eventId, priorAwardId: awardId, priorPurchaseOrderId: sourcePoId }),
        /issued or closed/i,
        `${sourcePoId} cannot establish a repeat-order source`,
      );
    }
    await addRequest(repeatId, 50000, sameLines);
    await setPolicyActor(db, submitter, true);
    await assert.rejects(() => submitPack(repeatId, "repeat_order", { priorRequestId: priorId, priorSourcingEventId: eventId, priorAwardId: awardId, priorPurchaseOrderId: "forged-po", samePrice: true, sameTerms: true, sameVendor: true }), /prior PO/i, "forged repeat PO link is rejected");
    const repeat = (await submitPack(repeatId, "repeat_order", { priorRequestId: priorId, priorSourcingEventId: eventId, priorAwardId: awardId, priorPurchaseOrderId: "prior-po", samePrice: true, sameTerms: true, sameVendor: true, sameConsiderations: true, priorCompetitiveAward: true })).rows[0].pack;
    assert.equal((await approve(repeat.id)).status, "approved", "repeat order derives and locks cross-linked competitive facts");
    await setPolicyActor(db, submitter, true);
    await confirm(repeatId, 'repeat_order');
    await issuePo(repeatId, 'repeat-post-confirm-po', 50000);
    const closedRepeatId = "73000000-0000-0000-0000-000000000050";
    await addRequest(closedRepeatId, 50000, sameLines);
    const closedRepeat = (await submitPack(closedRepeatId, 'repeat_order', { priorRequestId: priorId, priorSourcingEventId: eventId, priorAwardId: awardId, priorPurchaseOrderId: 'prior-po-closed' })).rows[0].pack;
    assert.equal((await approve(closedRepeat.id)).status, 'approved', 'a closed policy-valid prior PO remains an allowed repeat source');
    await setPolicyActor(db, submitter, true);
    await confirm(closedRepeatId, 'repeat_order');
    await issuePo(closedRepeatId, 'repeat-closed-post-confirm-po', 50000);

    await db.exec(`update procurement.requests set lines='[{"description":"changed scope","quantity":1,"unitPrice":50000}]'::jsonb where id='${repeatId}';`);
    await assert.rejects(
      () => db.exec(`update procurement.purchase_orders set status='closed' where id='repeat-post-confirm-po'; update procurement.purchase_orders set status='issued' where id='repeat-post-confirm-po';`),
      /restart_exception|source changed|approved_exception_pack_required/i,
      'post-confirmation scope changes invalidate a previously route-bound exception',
    );

    const nextProfileId = '73000000-0000-0000-0000-000000000060';
    await db.exec(`
      update procurement.policy_profiles set status='superseded' where id='${operatingProfileId}';
      insert into procurement.policy_profiles(
        id,code,version,name,relationship,source_profile_id,source_filename,source_organization,control_sources,
        formal_bid_amount,invite_target_min,invite_target_max,sealed_bid_minimum_responses,bid_window_working_days,
        max_extension_working_days,vendor_acknowledgement_hours,clarification_hours,tabulation_hours,
        technical_evaluation_working_days,po_acknowledgement_hours,repeat_order_max_amount,repeat_order_max_age_days,
        petty_cash_max_amount,po_invoice_threshold,vendor_probation_months,status,effective_from,document_hash,created_by,last_modified_by
      ) select
        '${nextProfileId}',code,'2026.02',name,relationship,source_profile_id,source_filename,source_organization,control_sources,
        formal_bid_amount,invite_target_min,invite_target_max,sealed_bid_minimum_responses,bid_window_working_days,
        max_extension_working_days,vendor_acknowledgement_hours,clarification_hours,tabulation_hours,
        technical_evaluation_working_days,po_acknowledgement_hours,repeat_order_max_amount,repeat_order_max_age_days,
        petty_cash_max_amount,po_invoice_threshold,vendor_probation_months,'active',statement_timestamp(),repeat('c',32),'${submitter}','${submitter}'
      from procurement.policy_profiles where id='${operatingProfileId}';
    `);
    await setPolicyActor(db, submitter, true);
    const staleWorkspace = await db.query(`select procurement.exception_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.ok(staleWorkspace.rows[0].workspace.blockers.includes('policy_profile_changed_restart_exception'), 'a newly effective profile invalidates the old bound pack');
    assert.equal(staleWorkspace.rows[0].workspace.actions.canSubmit, true, 'the authoritative workspace permits recovery when a replacement is possible');
    assert.match(staleWorkspace.rows[0].workspace.recovery, /submit a new pack/i, 'the workspace returns server recovery guidance for a stale profile');
    const replacement = (await submitPack(requestId, 'sole_source', { soleSourceBasis: 'compatibility', evidenceReferences: ['private/sole-replacement.pdf'] }, 120000, 1)).rows[0].pack;
    assert.equal((await approve(replacement.id)).status, 'approved', 'replacement evidence can complete the independent lifecycle under the new profile');
    await setPolicyActor(db, submitter, true);
    await confirm(requestId, 'sole_source', 1);
    await issuePo(requestId, 'sole-profile-recovery-po', 120000);

    await addRequest(gateId, 50000);
    await db.exec(`
      update procurement.requests set procurement_mode='sole_source', policy_profile_id='${operatingProfileId}' where id='${gateId}';
      insert into procurement.route_decisions(id,request_id,policy_version,request_version,method,reasons,risk_facts,status,confirmed_by,solicitation_type,procurement_mode,governance_tier,policy_profile_id)
      values ('73000000-0000-0000-0000-000000000032','${gateId}','FIXTURE:1',1,'direct_award',array['fixture'],'{}','confirmed','${submitter}','none','sole_source','standard','${operatingProfileId}');
      insert into procurement.sourcing_events(id,request_id,route_decision_id,status,submission_deadline,original_submission_deadline,created_by)
      values ('73000000-0000-0000-0000-000000000033','${gateId}','73000000-0000-0000-0000-000000000032','draft',statement_timestamp(),statement_timestamp(),'${submitter}');
      insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,lines)
      values ('gate-po','${gateId}','${vendorId}','draft',50000,${sqlJson(sameLines)});
    `);
    await assert.rejects(() => db.exec(`update procurement.sourcing_events set status='awarded' where id='73000000-0000-0000-0000-000000000033';`), /approved best-value recommendation|approved_exception_pack_required/i, "award is blocked before an ungoverned exception route can award");
    await assert.rejects(() => db.exec(`update procurement.purchase_orders set status='issued' where id='gate-po';`), /approved_exception_pack_required/i, "PO issue is blocked without a current approved exception pack");
  } finally {
    await db.close();
  }
});

test("executes public governed sourcing controls and independent failed-bid recovery", async () => {
  const db = await createGovernedRouteFixture();
  let stage = "fixture";
  const requestId = "72000000-0000-0000-0000-000000000001";
  const vendorIds = [
    "72000000-0000-0000-0000-000000000011",
    "72000000-0000-0000-0000-000000000012",
    "72000000-0000-0000-0000-000000000013",
  ];
  const additionalVendorId = "72000000-0000-0000-0000-000000000014";
  const overflowVendorId = "72000000-0000-0000-0000-000000000015";
  const vendorActorId = "72000000-0000-0000-0000-000000000016";
  const additionalVendorActorId = "72000000-0000-0000-0000-000000000017";
  try {
    stage = "base migration";
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(`insert into core.profiles(id, status) values ('${checkerId}', 'active');`);
    await db.exec(`
      grant usage on schema procurement to service_role;
      grant all on procurement.sourcing_events, procurement.sourcing_responses,
        procurement.solicitation_communications, procurement.policy_sla_events,
        procurement.policy_profile_events, procurement.policy_conflicts to service_role;
    `);
    stage = "Task 6 migration";
    await db.exec(migrationTask6);
    stage = "service role write denial";
    await db.exec('set role service_role');
    await assert.rejects(
      () => db.query(`insert into procurement.sourcing_events(request_id, route_decision_id, submission_deadline, original_submission_deadline) values ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), statement_timestamp(), statement_timestamp())`),
      /permission denied/i,
      'service_role must not forge governed sourcing events by direct table write',
    );
    await assert.rejects(
      () => db.query(`insert into procurement.solicitation_communications(request_id, communication_type, content_hash) values ('00000000-0000-0000-0000-000000000001', 'invitation', 'forged')`),
      /permission denied/i,
      'service_role must not forge invitation or acknowledgement evidence by direct table write',
    );
    await db.exec('reset role');
    stage = "request and vendors";
    await insertRequest(db, { id: requestId, requirementKind: "materials" });
    await db.exec(`
      update procurement.requests set policy_profile_id = '${operatingProfileId}' where id = '${requestId}';
      insert into procurement.route_decisions(
        request_id, policy_version, request_version, method, reasons, risk_facts, status, confirmed_by,
        solicitation_type, procurement_mode, governance_tier, policy_profile_id
      ) values (
        '${requestId}', 'MWELL-FIXTURE:2026.01', 1, 'rfq', array['fixture'], '{}'::jsonb, 'confirmed', '${actorId}',
        'rfq', 'competitive_bidding', 'standard', '${operatingProfileId}'
      );
      insert into core.vendors(id, legal_name, accreditation_status) values
        ('${vendorIds[0]}', 'Accredited one', 'approved'),
        ('${vendorIds[1]}', 'Accredited two', 'approved'),
        ('${vendorIds[2]}', 'Accredited three', 'approved'),
        ('${additionalVendorId}', 'Accredited four', 'approved'),
        ('${overflowVendorId}', 'Accredited five', 'approved');
      insert into core.profiles(id, vendor_id, status) values
        ('${vendorActorId}', '${vendorIds[0]}', 'active'),
        ('${additionalVendorActorId}', '${additionalVendorId}', 'active');
    `);

    await setPolicyActor(db, unauthorizedActorId, false);
    await assert.rejects(
      () => db.query(`select procurement.save_sourcing_event(${sqlJson({ request_id: requestId, submission_deadline: "2030-01-15T00:00:00.000Z", intended_responses: 3, package_version: "DENIED", package_hash: "a".repeat(64) })})`),
      /Not authorized to manage sourcing/i,
      'Operations-style actor must not create or alter governed sourcing',
    );
    await setPolicyActor(db, actorId, true);

    stage = "source profile";
    await db.query(`select private.policy_sourcing_profile('${requestId}')`);
    stage = "source capability";
    await db.query(`select private.policy_sourcing_can_manage()`);
    stage = "save sourcing event";
    const saved = await db.query(`select procurement.save_sourcing_event(${sqlJson({
      request_id: requestId,
      submission_deadline: "2030-01-15T00:00:00.000Z",
      intended_responses: 3,
      package_version: "RFQ-2030-v1",
      package_hash: "f".repeat(64),
    })}) as event`);
    const eventId = saved.rows[0].event.id;
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "issue" })})`),
      /3 accredited invitees/i,
    );
    await db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: eventId, vendor_ids: vendorIds })})`);
    const invitationEvidence = await db.query(`
      select count(*)::integer as recipients, count(distinct detail->>'notificationGroupId')::integer as groups,
        bool_and(detail ? 'packageVersion' and detail ? 'packageHash' and detail ? 'sentAt' and detail ? 'deliveredAt') as complete
      from procurement.solicitation_communications where request_id = '${requestId}' and communication_type = 'invitation'
    `);
    assert.deepEqual(invitationEvidence.rows[0], { recipients: 3, groups: 1, complete: true }, 'invitation evidence must be immutable, per-recipient, and grouped');
    const acknowledgementPayload = async (sourcingEventId, vendorId) => {
      const current = await db.query(`
        select current_invitation_communication_id, current_invitation_group_id,
          current_invitation_package_version, current_invitation_package_hash
        from procurement.sourcing_responses
        where sourcing_event_id = '${sourcingEventId}' and vendor_id = '${vendorId}'
      `);
      const row = current.rows[0];
      return {
        sourcing_event_id: sourcingEventId,
        vendor_id: vendorId,
        communication_id: row.current_invitation_communication_id,
        notification_group_id: row.current_invitation_group_id,
        package_version: row.current_invitation_package_version,
        package_hash: row.current_invitation_package_hash,
      };
    };
    const normalAcknowledgement = await db.query(`select procurement.sourcing_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.ok(normalAcknowledgement.rows[0].workspace.event.communications.some((item) => item.communicationType === 'invitation' && item.acknowledgementState === 'pending'));
    await db.exec(`
      update procurement.solicitation_communications set sent_at = statement_timestamp() - interval '25 hours'
      where request_id = '${requestId}' and communication_type = 'invitation' and detail->>'recipientVendorId' = '${vendorIds[1]}';
      create or replace function auth.uid() returns uuid language sql stable as $$ select '${vendorActorId}'::uuid $$;
      create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select '${vendorIds[0]}'::uuid $$;
    `);
    const unauthorizedVendorAcknowledgement = await acknowledgementPayload(eventId, vendorIds[1]);
    await assert.rejects(
      () => db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(unauthorizedVendorAcknowledgement)})`),
      /Only the invited vendor/i,
    );
    const firstAcknowledgement = await acknowledgementPayload(eventId, vendorIds[0]);
    await assert.rejects(
      () => db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson({ ...firstAcknowledgement, notification_group_id: vendorIds[1] })})`),
      /must match the vendor current controlled invitation package/i,
      'a vendor cannot acknowledge an arbitrary notification group',
    );
    const acknowledgement = await db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(firstAcknowledgement)}) as result`);
    assert.equal(acknowledgement.rows[0].result.replayed, false);
    const replay = await db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(firstAcknowledgement)}) as result`);
    assert.equal(replay.rows[0].result.replayed, true, 'acknowledgement replay must be idempotent');
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select '${actorId}'::uuid $$;
      create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    const overdueAcknowledgement = await db.query(`select procurement.sourcing_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.ok(overdueAcknowledgement.rows[0].workspace.event.communications.some((item) => item.communicationType === 'invitation' && item.acknowledgementState === 'overdue'));
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "issue" })})`);
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "award", selected_vendor_id: vendorIds[0], closure_note: "Cannot award before controlled evaluation." })})`),
      /Controlled evaluation is required/i,
      'award must be denied before controlled evaluation',
    );
    await db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: eventId, communication_type: "extension", extension_working_days: 7 })})`);
    await assert.rejects(
      () => db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: eventId, communication_type: "extension", extension_working_days: 8 })})`),
      /between 1 and 7 working days/i,
    );
    await db.query(`select procurement.record_solicitation_communication(${sqlJson({
      sourcing_event_id: eventId, communication_type: "clarification", question: "Confirm warranty coverage.", answer: "Warranty must be 12 months.",
    })})`);
    const communication = await db.query(`
      select count(*)::integer as recipients, count(distinct detail->>'notificationGroupId')::integer as groups
      from procurement.solicitation_communications
      where request_id = '${requestId}' and communication_type = 'clarification'
    `);
    assert.deepEqual(communication.rows[0], { recipients: 3, groups: 1 }, "clarification must be identical and visible to every invitee");

    await db.exec(`update procurement.sourcing_events set submission_deadline = statement_timestamp() - interval '1 minute' where id = '${eventId}'`);
    const formallyClosedFailedBid = await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "response_closed" })}) as event`);
    assert.equal(formallyClosedFailedBid.rows[0].event.status, 'failed_bid');
    const closureEvidence = await db.query(`select response_closed_at from procurement.sourcing_events where id = '${eventId}'`);
    assert.ok(closureEvidence.rows[0].response_closed_at, 'an insufficient-response formal close must retain closure evidence for the approved exception route');
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "evaluation" })})`),
      /approved evaluation exception/i,
    );
    const exception = await db.query(`select procurement.submit_insufficient_bid_exception(${sqlJson({
      sourcing_event_id: eventId,
      phase: "evaluation",
      justification: "The verified market search produced fewer than three usable responses despite documented outreach.",
      price_reasonableness: "Prior price history and an independent market check support the available offer.",
    })}) as pack`);
    await assert.rejects(
      () => db.query(`select procurement.review_insufficient_bid_exception(${sqlJson({ id: exception.rows[0].pack.id, decision: "approved", note: "Independent review complete." })})`),
      /cannot approve their own/i,
    );
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${checkerId}'::uuid $$;`);
    await db.query(`select procurement.review_insufficient_bid_exception(${sqlJson({ id: exception.rows[0].pack.id, decision: "approved", note: "Independent review confirms the exception evidence." })})`);
    const evaluation = await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "evaluation" })}) as event`);
    assert.equal(evaluation.rows[0].event.status, "evaluation");

    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${actorId}'::uuid $$;`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "cancel", closure_note: "Fixture closes first sourcing run" })})`);
    const requote = await db.query(`select procurement.save_sourcing_event(${sqlJson({
      request_id: requestId, submission_deadline: "2030-01-15T00:00:00.000Z", intended_responses: 3,
      package_version: "RFQ-2030-v2", package_hash: "e".repeat(64),
    })}) as event`);
    const requoteEventId = requote.rows[0].event.id;
    await db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: requoteEventId, vendor_ids: vendorIds })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: requoteEventId, action: "issue" })})`);
    await db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: requoteEventId, communication_type: "extension", extension_working_days: 4 })})`);
    await assert.rejects(
      () => db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: requoteEventId, communication_type: "extension", extension_working_days: 4 })})`),
      /Cumulative extension/i,
      'repeated 4 + 4 working-day extensions must not exceed the profile cap',
    );
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: requoteEventId, action: "failed_bid", failed_bid_reason: "insufficient_responses" })})`);
    const requoteSuccess = await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: requoteEventId, action: "source_additional_and_requote", vendor_id: additionalVendorId, submission_deadline: "2030-01-22T00:00:00.000Z", package_version: "RFQ-2030-v3", package_hash: "d".repeat(64) })}) as event`);
    assert.equal(requoteSuccess.rows[0].event.status, 'issued');
    const requoteEvidence = await db.query(`select count(*)::integer as recipients, count(distinct detail->>'notificationGroupId')::integer as groups from procurement.solicitation_communications where request_id = '${requestId}' and communication_type = 'requote'`);
    assert.deepEqual(requoteEvidence.rows[0], { recipients: 4, groups: 1 }, 'requote must notify every existing and additional invitee equally');
    const existingRequoteAcknowledgement = await acknowledgementPayload(requoteEventId, vendorIds[0]);
    const additionalRequoteAcknowledgement = await acknowledgementPayload(requoteEventId, additionalVendorId);
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select '${vendorActorId}'::uuid $$;
      create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select '${vendorIds[0]}'::uuid $$;
    `);
    await assert.rejects(
      () => db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson({ ...firstAcknowledgement, sourcing_event_id: requoteEventId })})`),
      /must match the vendor current controlled invitation package/i,
      'an acknowledgement for a superseded package must not satisfy the requote',
    );
    const existingRequoteAck = await db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(existingRequoteAcknowledgement)}) as result`);
    assert.equal(existingRequoteAck.rows[0].result.replayed, false);
    const existingRequoteReplay = await db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(existingRequoteAcknowledgement)}) as result`);
    assert.equal(existingRequoteReplay.rows[0].result.replayed, true, 'requote acknowledgement replay must be idempotent');
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select '${additionalVendorActorId}'::uuid $$;
      create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select '${additionalVendorId}'::uuid $$;
    `);
    await assert.rejects(
      () => db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson({ ...existingRequoteAcknowledgement, vendor_id: additionalVendorId })})`),
      /must match the vendor current controlled invitation package/i,
      'a new vendor cannot reuse another recipient acknowledgement evidence',
    );
    const additionalRequoteAck = await db.query(`select procurement.acknowledge_sourcing_invitation(${sqlJson(additionalRequoteAcknowledgement)}) as result`);
    assert.equal(additionalRequoteAck.rows[0].result.replayed, false, 'the additional vendor must acknowledge the current requote package');
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$ select '${actorId}'::uuid $$;
      create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select null::uuid $$;
      update procurement.solicitation_communications set sent_at = statement_timestamp() - interval '25 hours'
      where id = '${additionalRequoteAcknowledgement.communication_id}';
    `);
    const requoteWorkspace = await db.query(`select procurement.sourcing_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.ok(requoteWorkspace.rows[0].workspace.event.communications.some((item) => item.id === existingRequoteAcknowledgement.communication_id && item.acknowledgementState === 'acknowledged'));
    assert.ok(requoteWorkspace.rows[0].workspace.event.communications.some((item) => item.id === additionalRequoteAcknowledgement.communication_id && item.acknowledgementState === 'acknowledged'));
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: requoteEventId, action: "failed_bid", failed_bid_reason: "insufficient_responses" })})`);
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: requoteEventId, action: "source_additional_and_requote", vendor_id: overflowVendorId, submission_deadline: "2030-01-25T00:00:00.000Z", package_version: "RFQ-2030-v4", package_hash: "c".repeat(64) })})`),
      /Requote deadline cannot exceed/i,
    );
  } catch (cause) {
    throw new Error(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await db.close();
  }
});

test("executes the disposable public Task 9 RPC and RLS matrix", async () => {
  const db = await createGovernedRouteFixture();
  const maker = "74000000-0000-0000-0000-000000000001";
  const checker = "74000000-0000-0000-0000-000000000002";
  const vendorActor = "74000000-0000-0000-0000-000000000003";
  const vendorId = "74000000-0000-0000-0000-000000000004";
  const poId = "task-9-public-po";
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await db.exec(migrationTask6);
    await db.exec(`insert into core.profiles(id,status) values ('${maker}','active'),('${checker}','active'),('${vendorActor}','active'); insert into core.vendors(id,legal_name,accreditation_status) values ('${vendorId}','Task 9 vendor','approved');`);
    await setPolicyActor(db, maker, false, ['author_po']);
    await db.exec(`insert into procurement.purchase_orders(id,core_vendor_id,status,total,lines,actor_id) values ('${poId}','${vendorId}','draft',100,'[]'::jsonb,'${maker}'); update procurement.purchase_orders set status='issued',issued_at=statement_timestamp()-interval '47 hours' where id='${poId}';`);

    const issued = await db.query(`select procurement.purchase_order_lifecycle(${sqlJson({ purchase_order_id: poId })}) as lifecycle`);
    assert.equal(issued.rows[0].lifecycle.revision, 2);
    assert.ok(issued.rows[0].lifecycle.sentAt, 'issued_at is projected as authoritative sent_at');
    const monitoring = await db.query(`select procurement.review_open_purchase_orders('{}'::jsonb) as items`);
    assert.equal(monitoring.rows[0].items[0].purchaseOrderId, poId);
    assert.equal(monitoring.rows[0].items[0].kind, 'vendor_acknowledgement_due_soon');
    await db.exec(`update procurement.purchase_order_lifecycle_state set sent_at=statement_timestamp()-interval '48 hours',acknowledgement_due_at=statement_timestamp() where purchase_order_id='${poId}';`);
    const overdue = await db.query(`select procurement.review_open_purchase_orders('{}'::jsonb) as items`);
    assert.equal(overdue.rows[0].items[0].kind, 'vendor_acknowledgement_overdue');

    await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ACK-1' })})`), /awarded vendor/i);
    await setPolicyActor(db, vendorActor, false, [], vendorId);
    const acknowledged = await db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ACK-1' })}) as lifecycle`);
    assert.equal(acknowledged.rows[0].lifecycle.revision, 3);
    const acknowledgementReplay = await db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ACK-1' })}) as lifecycle`);
    assert.equal(acknowledgementReplay.rows[0].lifecycle.replayed, true);
    await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ACK-CHANGED' })})`), /changed/i);

    await setPolicyActor(db, maker, false, ['author_po']);
    await db.exec(`create or replace function core.current_vendor_id() returns uuid language sql stable as $$ select null::uuid $$;`);
    const delivery = await db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 3, delivery_notice_reference: 'DELIVERY-1' })}) as lifecycle`);
    assert.equal(delivery.rows[0].lifecycle.revision, 4);
    const requested = await db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'All contractual obligations have completed.' })}) as request`);
    assert.equal(requested.rows[0].request.replayed, false);
    const requestReplay = await db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'All contractual obligations have completed.' })}) as request`);
    assert.equal(requestReplay.rows[0].request.replayed, true);
    await assert.rejects(() => db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'Changed close reason.' })})`), /reason changed/i);

    await setPolicyActor(db, checker, false, ['final_approve_po']);
    await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: requested.rows[0].request.id })})`), /Closure is blocked/i);
    await db.exec(`insert into procurement.acceptance_packs(purchase_order_id,status,exceptions) values ('${poId}','accepted','[]'::jsonb);`);
    const closed = await db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: requested.rows[0].request.id })}) as closure`);
    assert.equal(closed.rows[0].closure.approved, true);
    assert.equal(closed.rows[0].closure.closureStatus, 'closed');
    const closureReplay = await db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: requested.rows[0].request.id })}) as closure`);
    assert.equal(closureReplay.rows[0].closure.replayed, true);

    const grants = await db.query(`select pg_catalog.has_function_privilege('authenticated','procurement.close_purchase_order(jsonb)','EXECUTE') as direct_close, pg_catalog.has_function_privilege('authenticated','private.policy_po_lifecycle_transition(text,integer,text,text,jsonb)','EXECUTE') as helper, pg_catalog.has_table_privilege('authenticated','procurement.purchase_order_lifecycle_state','UPDATE') as direct_state_write`);
    assert.deepEqual(grants.rows[0], { direct_close: false, helper: false, direct_state_write: false });
  } finally {
    await db.close();
  }
});

test("executes Task 9 public contracts under disposable database roles", async () => {
  const db = await createGovernedRouteFixture();
  const procurementActor = "75000000-0000-0000-0000-000000000001";
  const vendorActor = "75000000-0000-0000-0000-000000000002";
  const unrelatedActor = "75000000-0000-0000-0000-000000000003";
  const dashboardActor = "75000000-0000-0000-0000-000000000005";
  const approverActor = "75000000-0000-0000-0000-000000000006";
  const financeActor = "75000000-0000-0000-0000-000000000007";
  const vendorId = "75000000-0000-0000-0000-000000000004";
  const poId = "task-9-role-po";
  const lifecycle = (payload) => db.query(`select procurement.purchase_order_lifecycle(${sqlJson(payload)}) as result`);
  const monitoring = () => db.query(`select procurement.review_open_purchase_orders('{}'::jsonb) as result`);
  const vendorAcknowledgements = () => db.query(`select procurement.vendor_purchase_order_acknowledgements('{}'::jsonb) as result`);
  const withRole = async (role, actor, capabilities, vendor, action) => {
    await db.exec('reset role');
    await setPolicyActor(db, actor, false, capabilities, vendor);
    await db.exec(`set role ${role}`);
    try {
      return await action();
    } finally {
      await db.exec('reset role');
    }
  };
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await db.exec(migrationTask6);
    await db.exec(`
      grant usage on schema procurement, core, auth, private to anon, authenticated, service_role;
      insert into core.profiles(id,status) values
        ('${procurementActor}','active'),('${vendorActor}','active'),('${unrelatedActor}','active'),
        ('${dashboardActor}','active'),('${approverActor}','active'),('${financeActor}','active');
      insert into core.vendors(id,legal_name,accreditation_status) values ('${vendorId}','Role matrix vendor','approved');
      insert into procurement.purchase_orders(id,core_vendor_id,status,total,lines,actor_id) values ('${poId}','${vendorId}','draft',100,'[]'::jsonb,'${procurementActor}');
      update procurement.purchase_orders set status='issued',issued_at=statement_timestamp()-interval '48 hours' where id='${poId}';
    `);

    await withRole('anon', unrelatedActor, [], null, async () => {
      await assert.rejects(() => lifecycle({ purchase_order_id: poId }), /permission denied/i, 'anon cannot execute lifecycle read');
      await assert.rejects(monitoring, /permission denied/i, 'anon cannot execute monitoring');
      await assert.rejects(vendorAcknowledgements, /permission denied/i, 'anon cannot list vendor POs');
      await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'FORGED' })})`), /permission denied/i, 'anon cannot acknowledge');
      await assert.rejects(() => db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 2, delivery_notice_reference: 'FORGED' })})`), /permission denied/i, 'anon cannot record delivery');
      await assert.rejects(() => db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 2, closure_reason: 'FORGED' })})`), /permission denied/i, 'anon cannot request closure');
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: '00000000-0000-0000-0000-000000000001' })})`), /permission denied/i, 'anon cannot approve closure');
      await assert.rejects(() => db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: '00000000-0000-0000-0000-000000000001', amount: 1, payment_reference: 'FORGED', paid_at: '2026-08-22' })})`), /permission denied/i, 'anon cannot release payment');
    });

    await withRole('authenticated', unrelatedActor, [], null, async () => {
      await assert.rejects(() => lifecycle({ purchase_order_id: poId }), /Not authorized/i, 'unrelated authenticated actor cannot read PO lifecycle');
      await assert.rejects(monitoring, /monitoring authority/i, 'unrelated actor cannot monitor open POs');
      await assert.rejects(vendorAcknowledgements, /Vendor session/i, 'unrelated actor cannot list vendor POs');
      await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'FORGED' })})`), /awarded vendor/i, 'unrelated actor cannot acknowledge');
      await assert.rejects(() => db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 2, delivery_notice_reference: 'FORGED' })})`), /Procurement authority/i, 'unrelated actor cannot record delivery');
      await assert.rejects(() => db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 2, closure_reason: 'FORGED' })})`), /closure authority/i, 'unrelated actor cannot request closure');
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: '00000000-0000-0000-0000-000000000001' })})`), /approver authority/i, 'unrelated actor cannot approve closure');
      await assert.rejects(() => db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: '00000000-0000-0000-0000-000000000001', amount: 1, payment_reference: 'FORGED', paid_at: '2026-08-22' })})`), /Not authorized/i, 'unrelated actor cannot release payment');
      await assert.rejects(() => db.query(`select * from procurement.purchase_order_lifecycle_state`), /permission denied|row-level security/i, 'authenticated cannot directly read lifecycle state');
      await assert.rejects(() => db.query(`update procurement.purchase_order_lifecycle_state set revision=999 where purchase_order_id='${poId}'`), /permission denied|row-level security/i, 'authenticated cannot write lifecycle state');
      await assert.rejects(() => db.query(`insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference) values('${poId}','vendor_acknowledged',2,3,'${unrelatedActor}','FORGED')`), /permission denied|row-level security/i, 'authenticated cannot forge lifecycle events');
      await assert.rejects(() => db.query(`select * from procurement.purchase_order_closure_requests`), /permission denied|row-level security/i, 'authenticated cannot directly read closure requests');
      await assert.rejects(() => db.query(`select private.policy_po_lifecycle_transition('${poId}',2,'vendor_acknowledged','forged','{}'::jsonb)`), /permission denied/i, 'authenticated cannot call private lifecycle helper');
      await assert.rejects(() => db.query(`select private.policy_po_lifecycle_projection('${poId}')`), /permission denied/i, 'authenticated cannot call private lifecycle projection');
      await assert.rejects(() => db.query(`select procurement.close_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, closure_reason: 'FORGED' })})`), /permission denied/i, 'direct close stays revoked');
    });

    await withRole('authenticated', vendorActor, [], vendorId, async () => {
      const vendorRead = await lifecycle({ purchase_order_id: poId });
      assert.equal(vendorRead.rows[0].result.revision, 2, 'issued-at backfill supplies the same revision expected by the sent event');
      const awarded = await vendorAcknowledgements();
      assert.equal(awarded.rows[0].result.length, 1, 'awarded vendor sees only its issued PO');
      await assert.rejects(monitoring, /monitoring authority/i, 'vendor cannot read procurement monitoring');
      await assert.rejects(() => db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 2, delivery_notice_reference: 'VENDOR-FORGED' })})`), /Procurement authority/i, 'vendor cannot record delivery');
      await assert.rejects(() => db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 2, closure_reason: 'VENDOR-FORGED' })})`), /closure authority/i, 'vendor cannot request closure');
      const acknowledged = await db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ROLE-ACK' })}) as result`);
      assert.equal(acknowledged.rows[0].result.replayed, false);
      const replay = await db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ROLE-ACK' })}) as result`);
      assert.equal(replay.rows[0].result.replayed, true, 'vendor acknowledgement retry is exact and idempotent');
      await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 2, acknowledgement_reference: 'ROLE-ACK-CHANGED' })})`), /changed|lifecycle changed/i, 'changed vendor acknowledgement is rejected');
    });

    await withRole('authenticated', dashboardActor, ['view_dashboard'], null, async () => {
      assert.equal((await lifecycle({ purchase_order_id: poId })).rows[0].result.revision, 3, 'dashboard reader can consume the governed lifecycle projection');
      assert.equal((await monitoring()).rows[0].result[0].kind, 'open_po', 'dashboard reader receives the post-acknowledgement governed monitoring projection');
      await assert.rejects(() => db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 3, delivery_notice_reference: 'DASHBOARD-FORGED' })})`), /Procurement authority/i, 'dashboard reader cannot mutate lifecycle');
    });

    await withRole('authenticated', procurementActor, ['author_po'], null, async () => {
      await assert.rejects(() => db.query(`select procurement.acknowledge_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 3, acknowledgement_reference: 'PROCUREMENT-FORGED' })})`), /awarded vendor/i, 'procurement cannot acknowledge for a vendor');
      const delivery = await db.query(`select procurement.record_vendor_delivery_notice(${sqlJson({ purchase_order_id: poId, expected_revision: 3, delivery_notice_reference: 'ROLE-DELIVERY' })}) as result`);
      assert.equal(delivery.rows[0].result.replayed, false, 'procurement records delivery through the public command');
      const requested = await db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'All controlled handoffs are complete.' })}) as result`);
      assert.equal(requested.rows[0].result.replayed, false);
      const requestReplay = await db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'All controlled handoffs are complete.' })}) as result`);
      assert.equal(requestReplay.rows[0].result.replayed, true, 'closure request retry is exact and idempotent');
      await assert.rejects(() => db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'Changed reason.' })})`), /reason changed/i, 'changed closure reason is rejected');
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: requested.rows[0].result.id })})`), /approver authority|maker and checker/i, 'maker cannot self-approve closure');
    });

    let closureRequestId;
    await withRole('authenticated', procurementActor, ['author_po'], null, async () => {
      const request = await db.query(`select procurement.request_purchase_order_closure(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'All controlled handoffs are complete.' })}) as result`);
      closureRequestId = request.rows[0].result.id;
    });
    await withRole('authenticated', approverActor, ['final_approve_po'], null, async () => {
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: closureRequestId })})`), /Closure is blocked/i, 'missing service/goods acceptance blocks closure');
    });
    await db.exec(`
      insert into procurement.acceptance_packs(purchase_order_id,status,exceptions) values ('${poId}','accepted','[]'::jsonb);
      insert into procurement.receipt_status_fixture(purchase_order_id,outstanding_quantity,rejected_or_quarantined_quantity) values ('${poId}',1,0);
    `);
    await withRole('authenticated', approverActor, ['final_approve_po'], null, async () => {
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: closureRequestId })})`), /Closure is blocked/i, 'unreceived goods block closure');
    });
    await db.exec(`update procurement.receipt_status_fixture set outstanding_quantity=0,rejected_or_quarantined_quantity=1 where purchase_order_id='${poId}'; update procurement.purchase_order_lifecycle_state set quality_recovery_status='payment_hold' where purchase_order_id='${poId}';`);
    await withRole('authenticated', approverActor, ['final_approve_po'], null, async () => {
      await assert.rejects(() => db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: closureRequestId })})`), /Closure is blocked/i, 'quarantine, RMA, credit, and payment-hold recovery block closure');
    });
    await db.exec(`update procurement.receipt_status_fixture set rejected_or_quarantined_quantity=0 where purchase_order_id='${poId}'; update procurement.purchase_order_lifecycle_state set quality_recovery_status='resolved' where purchase_order_id='${poId}'; insert into procurement.payment_readiness_packs(purchase_order_id,status,invoice_amount,released_amount,accepted_amount,purchase_order_amount) values ('${poId}','accepted',100,0,100,100);`);
    const paymentPack = await db.query(`select id from procurement.payment_readiness_packs where purchase_order_id='${poId}'`);
    await withRole('authenticated', financeActor, ['view_finance'], null, async () => {
      const released = await db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: paymentPack.rows[0].id, amount: 100, payment_reference: 'ROLE-PAYMENT-1', payment_method: 'bank_transfer', paid_at: '2026-08-23' })}) as result`);
      assert.equal(released.rows[0].result.closureRequired, true, 'fully paid PO remains issued pending independent closure');
    });
    const paidButOpen = await db.query(`select status from procurement.purchase_orders where id='${poId}'`);
    assert.equal(paidButOpen.rows[0].status, 'issued', 'payment release cannot bypass the closure terminal path');
    await withRole('authenticated', approverActor, ['final_approve_po'], null, async () => {
      const approved = await db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: closureRequestId })}) as result`);
      assert.equal(approved.rows[0].result.replayed, false);
      const replay = await db.query(`select procurement.approve_purchase_order_closure(${sqlJson({ closure_request_id: closureRequestId })}) as result`);
      assert.equal(replay.rows[0].result.replayed, true, 'the governed terminal replay is exact and idempotent');
    });
    const terminal = await db.query(`select status from procurement.purchase_orders where id='${poId}'`);
    const closedEvent = await db.query(`select event_type,expected_revision,resulting_revision from procurement.purchase_order_lifecycle_events where purchase_order_id='${poId}' and event_type='closed'`);
    assert.equal(terminal.rows[0].status, 'closed');
    assert.deepEqual(closedEvent.rows[0], { event_type: 'closed', expected_revision: 4, resulting_revision: 5 }, 'only the private terminal helper creates the immutable closure event');
    await withRole('service_role', approverActor, ['admin'], null, async () => {
      await assert.rejects(() => db.query(`select procurement.close_purchase_order(${sqlJson({ purchase_order_id: poId, expected_revision: 4, closure_reason: 'FORGED' })})`), /permission denied/i, 'service role cannot execute retired direct close');
      await assert.rejects(() => db.query(`select private.policy_po_lifecycle_transition('${poId}',4,'closed','FORGED','{}'::jsonb)`), /permission denied/i, 'service role cannot execute the private terminal helper');
    });
  } finally { await db.close(); }
});

test("backfills legacy sourcing deadlines before enforcing cumulative extension and requote caps", async () => {
  const db = await createGovernedRouteFixture();
  const requestId = "73000000-0000-0000-0000-000000000001";
  const routeId = "73000000-0000-0000-0000-000000000002";
  const issuedSevenId = "73000000-0000-0000-0000-000000000003";
  const issuedEightId = "73000000-0000-0000-0000-000000000004";
  const issuedFourId = "73000000-0000-0000-0000-000000000005";
  const failedBidId = "73000000-0000-0000-0000-000000000006";
  const invitedVendorId = "73000000-0000-0000-0000-000000000011";
  const additionalVendorId = "73000000-0000-0000-0000-000000000012";
  const baseline = "2030-01-15T00:00:00.000Z";
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(`
      insert into procurement.requests(
        id, status, estimated_amount, requirement_kind, solicitation_type, procurement_mode,
        governance_tier, policy_profile_id, requester_id
      ) values (
        '${requestId}', 'draft', 500000, 'materials', 'rfq', 'competitive_bidding',
        'standard', '${operatingProfileId}', '${actorId}'
      );
      insert into procurement.route_decisions(
        id, request_id, policy_version, request_version, method, reasons, risk_facts, status,
        confirmed_by, solicitation_type, procurement_mode, governance_tier, policy_profile_id
      ) values (
        '${routeId}', '${requestId}', 'MWELL-FIXTURE:2026.01', 1, 'rfq', array['legacy'], '{}'::jsonb,
        'confirmed', '${actorId}', 'rfq', 'competitive_bidding', 'standard', '${operatingProfileId}'
      );
      insert into core.vendors(id, legal_name, accreditation_status) values
        ('${invitedVendorId}', 'Legacy invited vendor', 'approved'),
        ('${additionalVendorId}', 'Legacy additional vendor', 'approved');
      insert into procurement.sourcing_events(
        id, request_id, route_decision_id, issued_at, submission_deadline, intended_responses,
        status, clarification_log
      ) values
        ('${issuedSevenId}', '${requestId}', '${routeId}', statement_timestamp(), '${baseline}', 3, 'issued', '[]'::jsonb),
        ('${issuedEightId}', '${requestId}', '${routeId}', statement_timestamp(), '${baseline}', 3, 'issued', '[]'::jsonb),
        ('${issuedFourId}', '${requestId}', '${routeId}', statement_timestamp(), '${baseline}', 3, 'issued', '[]'::jsonb),
        ('${failedBidId}', '${requestId}', '${routeId}', statement_timestamp(), '${baseline}', 3, 'failed_bid', '[]'::jsonb);
      insert into procurement.sourcing_responses(sourcing_event_id, vendor_id, invited_at)
      values
        ('${issuedSevenId}', '${invitedVendorId}', statement_timestamp()),
        ('${issuedEightId}', '${invitedVendorId}', statement_timestamp()),
        ('${issuedFourId}', '${invitedVendorId}', statement_timestamp()),
        ('${failedBidId}', '${invitedVendorId}', statement_timestamp());
    `);
    await db.exec(migrationTask6);
    const backfilled = await db.query(`
      select id, submission_deadline, original_submission_deadline
      from procurement.sourcing_events
      where id in ('${issuedSevenId}', '${issuedEightId}', '${issuedFourId}', '${failedBidId}')
      order by id
    `);
    assert.equal(backfilled.rows.length, 4);
    for (const event of backfilled.rows) {
      assert.equal(new Date(event.original_submission_deadline).toISOString(), new Date(baseline).toISOString(), 'legacy baseline must be backfilled before public RPC exposure');
    }
    await setPolicyActor(db, actorId, true);
    await db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: issuedSevenId, communication_type: "extension", extension_working_days: 7 })})`);
    await assert.rejects(
      () => db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: issuedEightId, communication_type: "extension", extension_working_days: 8 })})`),
      /between 1 and 7 working days/i,
      'an eight-working-day legacy extension must be denied',
    );
    await db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: issuedFourId, communication_type: "extension", extension_working_days: 4 })})`);
    await assert.rejects(
      () => db.query(`select procurement.record_solicitation_communication(${sqlJson({ sourcing_event_id: issuedFourId, communication_type: "extension", extension_working_days: 4 })})`),
      /Cumulative extension/i,
      'legacy 4 + 4 must be capped from the original deadline rather than the latest deadline',
    );
    const requoteOverflow = await db.query(`select private.policy_add_working_days('${baseline}'::timestamptz, 8) as deadline`);
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({
        id: failedBidId,
        action: "source_additional_and_requote",
        vendor_id: additionalVendorId,
        submission_deadline: requoteOverflow.rows[0].deadline,
        package_version: "LEGACY-RFQ-v2",
        package_hash: "d".repeat(64),
      })})`),
      /Requote deadline cannot exceed/i,
      'legacy failed-bid recovery must retain the original deadline cap',
    );
  } finally {
    await db.close();
  }
});

test("executes versioned tabulation, technical best-value evidence, and independent variance approval", async () => {
  const db = await createGovernedRouteFixture();
  const requestId = "74000000-0000-0000-0000-000000000001";
  const vendorIds = [
    "74000000-0000-0000-0000-000000000011",
    "74000000-0000-0000-0000-000000000012",
    "74000000-0000-0000-0000-000000000013",
  ];
  const financeActorId = "74000000-0000-0000-0000-000000000014";
  const matrixId = "74000000-0000-0000-0000-000000000015";
  const nonCurrentDepartmentHeadId = "74000000-0000-0000-0000-000000000016";
  const financeWithoutCapabilityId = "74000000-0000-0000-0000-000000000017";
  const recommendationAuthorId = "74000000-0000-0000-0000-000000000018";
  const criteria = (score) => [
    "technicalCompliance", "quality", "leadTime", "totalLifecycleCost", "warranty",
    "support", "price", "paymentTerms", "training",
  ].map((criterion) => ({ criterion, score, evidence_reference: `private/evidence/${criterion}.pdf`, comments: "Reviewed against the controlled proposal." }));
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    await db.exec(`
      insert into core.profiles(id, status) values
        ('${checkerId}', 'active'),
        ('${financeActorId}', 'active'),
        ('${nonCurrentDepartmentHeadId}', 'active'),
        ('${financeWithoutCapabilityId}', 'active'),
        ('${recommendationAuthorId}', 'active');
      insert into procurement.doa_matrices(id, version, department, status, active, effective_at)
      values ('${matrixId}', 'OPS-TEST-1', 'Operations', 'active', true, statement_timestamp() - interval '1 day');
      insert into procurement.doa_assignments(matrix_id, department, min_amount, max_amount, tier, approver_user_id, active) values
        ('${matrixId}', 'Operations', 0, null, 'dept_head', '${actorId}', true),
        ('${matrixId}', 'Operations', 0, null, 'dept_head', '${checkerId}', true),
        ('${matrixId}', 'Operations', 0, null, 'dept_head', '${nonCurrentDepartmentHeadId}', true),
        ('${matrixId}', 'Operations', 0, null, 'dept_head', '${recommendationAuthorId}', true),
        ('${matrixId}', 'Operations', 0, null, 'finance', '${checkerId}', true),
        ('${matrixId}', 'Operations', 0, null, 'finance', '${financeActorId}', true),
        ('${matrixId}', 'Operations', 0, null, 'finance', '${financeWithoutCapabilityId}', true);
      insert into core.vendors(id, legal_name, accreditation_status) values
        ('${vendorIds[0]}', 'Best technical vendor', 'approved'),
        ('${vendorIds[1]}', 'Best value variance vendor', 'approved'),
        ('${vendorIds[2]}', 'Third compliant vendor', 'approved');
    `);
    await insertRequest(db, {
      id: requestId,
      requirementKind: "materials",
      compliance: { riskFacts: { highRisk: true } },
    });
    await db.exec(`
      update procurement.requests set policy_profile_id = '${operatingProfileId}', department = 'Operations' where id = '${requestId}';
      insert into procurement.route_decisions(
        request_id, policy_version, request_version, method, reasons, risk_facts, status, confirmed_by,
        solicitation_type, procurement_mode, governance_tier, policy_profile_id
      ) values ('${requestId}', 'MWELL-FIXTURE:2026.01', 1, 'rfq', array['fixture'], '{"highRisk":true}'::jsonb, 'confirmed', '${actorId}', 'rfq', 'competitive_bidding', 'high_risk', '${operatingProfileId}');
    `);
    await setPolicyActor(db, actorId, true);
    const event = await db.query(`select procurement.save_sourcing_event(${sqlJson({
      request_id: requestId,
      submission_deadline: "2030-01-15T00:00:00.000Z",
      intended_responses: 3,
      package_version: "RFQ-BV-v1",
      package_hash: "a".repeat(64),
    })}) as event`);
    const eventId = event.rows[0].event.id;
    await db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: eventId, vendor_ids: vendorIds })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "issue" })})`);
    for (const [index, vendorId] of vendorIds.entries()) {
      await db.query(`select procurement.record_sourcing_response(${sqlJson({
        sourcing_event_id: eventId,
        vendor_id: vendorId,
        received_at: "2029-12-30T00:00:00.000Z",
        proposal_storage_path: `private/proposals/${index + 1}.pdf`,
        commercial: { amount: 100000 + index * 10000 },
      })})`);
    }
    await db.exec(`update procurement.sourcing_events set submission_deadline = statement_timestamp() - interval '1 minute' where id = '${eventId}'`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "response_closed" })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "evaluation" })})`);

    await assert.rejects(
      () => db.query(`select procurement.save_commercial_tabulation(${sqlJson({ sourcing_event_id: eventId, entries: [] })})`),
      /Commercial tabulation entries are required/i,
    );
    const tabulation = await db.query(`select procurement.save_commercial_tabulation(${sqlJson({
      sourcing_event_id: eventId,
      evidence_reference: "private/tabulations/RFQ-BV-v1.xlsx",
      comments: "Comparable quotes normalized to lifecycle cost.",
      entries: vendorIds.map((vendorId, index) => ({ vendor_id: vendorId, quoted_amount: 100000 + index * 10000, evidence_reference: `private/proposals/${index + 1}.pdf` })),
    })}) as tabulation`);
    assert.equal(tabulation.rows[0].tabulation.version, 1);
    assert.ok(tabulation.rows[0].tabulation.due_at, '48-hour commercial tabulation SLA must be persisted');

    const evaluations = [];
    for (const [index, vendorId] of vendorIds.entries()) {
      const evaluation = await db.query(`select procurement.submit_technical_evaluation(${sqlJson({
        sourcing_event_id: eventId,
        vendor_id: vendorId,
        evidence_reference: `private/technical/${index + 1}.pdf`,
        comments: "Technical reviewer completed the criterion matrix.",
        criteria: criteria(index === 0 ? 92 : index === 1 ? 84 : 72),
      })}) as evaluation`);
      evaluations.push(evaluation.rows[0].evaluation);
      if (index === 0) {
        await assert.rejects(
          () => db.query(`select procurement.submit_award_recommendation(${sqlJson({
            sourcing_event_id: eventId,
            evaluated_vendor_id: vendorIds[0],
            recommended_vendor_id: vendorIds[0],
            commercial_tabulation_id: tabulation.rows[0].tabulation.id,
            technical_evaluation_id: evaluation.rows[0].evaluation.id,
            rationale: 'Incomplete comparison must not recommend a vendor.',
            risk_evidence_reference: 'private/risk/high-risk.pdf',
          })})`),
          /every usable response/i,
          'a public recommendation RPC must reject incomplete technical coverage',
        );
      }
    }
    assert.equal(evaluations[0].total_score, 92, 'the complete criterion average must be stored');
    await assert.rejects(
      () => db.query(`select procurement.submit_award_recommendation(${sqlJson({
        sourcing_event_id: eventId,
        evaluated_vendor_id: vendorIds[0],
        recommended_vendor_id: vendorIds[1],
        commercial_tabulation_id: tabulation.rows[0].tabulation.id,
        technical_evaluation_id: evaluations[1].id,
        rationale: "Best value differs from the technical reference.",
        risk_evidence_reference: "private/risk/high-risk.pdf",
      })})`),
      /Written variance justification is required/i,
    );
    const recommendation = await db.query(`select procurement.submit_award_recommendation(${sqlJson({
      sourcing_event_id: eventId,
      evaluated_vendor_id: vendorIds[0],
      recommended_vendor_id: vendorIds[1],
      commercial_tabulation_id: tabulation.rows[0].tabulation.id,
      technical_evaluation_id: evaluations[1].id,
      rationale: "The second vendor offers the approved lifecycle value with evidence.",
      risk_evidence_reference: "private/risk/high-risk.pdf",
      variance_justification: "Lifecycle cost, lead time, and support evidence outweigh the technical score difference.",
    })}) as recommendation`);
    assert.equal(recommendation.rows[0].recommendation.status, 'pending_variance');
    await db.exec(`
      update procurement.award_recommendations
      set created_by = '${recommendationAuthorId}'
      where id = '${recommendation.rows[0].recommendation.id}'
    `);
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "award", selected_vendor_id: vendorIds[1], closure_note: "Score must not award by itself." })})`),
      /approved best-value recommendation/i,
    );
    const deniedWorkspace = (actor, capabilities = []) => setPolicyActor(db, actor, false, capabilities)
      .then(() => assert.rejects(
        () => db.query(`select procurement.evaluation_workspace(${sqlJson({ request_id: requestId })}) as workspace`),
        /No governed variance decision is assigned to this account for this request/i,
        'a denied workspace call must return no request, vendor, evidence, or decision payload',
      ));
    const deniedSourcingWorkspace = (actor, capabilities = []) => setPolicyActor(db, actor, false, capabilities)
      .then(() => assert.rejects(
        () => db.query(`select procurement.sourcing_workspace(${sqlJson({ request_id: requestId })}) as workspace`),
        /No procurement sourcing access is assigned to this account/i,
        'a DOA-only or unrelated caller must receive no sourcing workspace payload',
      ));
    await deniedSourcingWorkspace(financeActorId, ['view_finance']);
    await deniedSourcingWorkspace(checkerId);
    await deniedSourcingWorkspace(recommendationAuthorId);
    await deniedSourcingWorkspace(unauthorizedActorId);
    await setPolicyActor(db, actorId, true);
    const sourcingWorkspace = await db.query(`select procurement.sourcing_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.equal(sourcingWorkspace.rows[0].workspace.event.id, eventId, 'a Procurement sourcing manager retains governed sourcing access');
    await deniedWorkspace(financeActorId, ['view_finance']);
    await deniedWorkspace(recommendationAuthorId);
    await setPolicyActor(db, checkerId, true);
    const departmentWorkspace = await db.query(`select procurement.evaluation_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.equal(departmentWorkspace.rows[0].workspace.varianceEligibility.canReview, true);
    assert.equal(departmentWorkspace.rows[0].workspace.varianceEligibility.nextStage, 'department_head');
    await setPolicyActor(db, recommendationAuthorId, false);
    await assert.rejects(
      () => db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 1, decision: "approved", note: "Self approval attempt." })})`),
      /cannot approve their own/i,
    );
    await setPolicyActor(db, checkerId, true);
    const departmentDecision = await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 1, decision: "approved", note: "Department Head confirms the documented variance rationale." })}) as recommendation`);
    assert.equal(departmentDecision.rows[0].recommendation.status, 'pending_variance');
    await assert.rejects(
      () => db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 2, decision: "approved", note: "Dual-assignment actor attempts Finance approval." })})`),
      /independent from the Department Head/i,
      'a dual-assignment actor cannot complete both variance stages',
    );
    await deniedWorkspace(nonCurrentDepartmentHeadId);
    await deniedWorkspace(financeWithoutCapabilityId);
    await setPolicyActor(db, financeActorId, false, ['view_finance']);
    const financeWorkspace = await db.query(`select procurement.evaluation_workspace(${sqlJson({ request_id: requestId })}) as workspace`);
    assert.equal(financeWorkspace.rows[0].workspace.varianceEligibility.canReview, true);
    assert.equal(financeWorkspace.rows[0].workspace.varianceEligibility.nextStage, 'finance');
    const financeDecision = await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 2, decision: "approved", note: "Finance confirms the value and active delegated authority." })}) as recommendation`);
    assert.equal(financeDecision.rows[0].recommendation.status, 'approved');
    await setPolicyActor(db, actorId, true);
    const sourcingManagerCapability = await db.query(`select core.has_live_cap('procurement', 'manage_rfp') as allowed`);
    assert.equal(sourcingManagerCapability.rows[0].allowed, true, 'fixture must restore procurement sourcing authority before revising evidence');
    await db.query(`select procurement.submit_technical_evaluation(${sqlJson({
      sourcing_event_id: eventId,
      vendor_id: vendorIds[0],
      evidence_reference: 'private/technical/1-revised.pdf',
      comments: 'A corrected technical record supersedes the recommendation evidence.',
      criteria: criteria(91),
    })})`);
    await assert.rejects(
      () => db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "award", selected_vendor_id: vendorIds[1], closure_note: "Stale recommendation must not award." })})`),
      /current approved best-value recommendation/i,
      'a superseding technical evaluation must invalidate the earlier recommendation',
    );
    const refreshedRecommendation = await db.query(`select procurement.submit_award_recommendation(${sqlJson({
      sourcing_event_id: eventId,
      evaluated_vendor_id: vendorIds[0],
      recommended_vendor_id: vendorIds[1],
      commercial_tabulation_id: tabulation.rows[0].tabulation.id,
      technical_evaluation_id: evaluations[1].id,
      rationale: 'A refreshed evidence pack supports the variance recommendation.',
      risk_evidence_reference: 'private/risk/high-risk.pdf',
      variance_justification: 'Lifecycle cost, lead time, and support evidence outweigh the technical score difference.',
    })}) as recommendation`);
    await setPolicyActor(db, checkerId, true);
    await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: refreshedRecommendation.rows[0].recommendation.id, expected_version: 1, decision: "approved", note: "Department Head approves the refreshed evidence." })})`);
    await setPolicyActor(db, financeActorId, false, ['view_finance']);
    await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: refreshedRecommendation.rows[0].recommendation.id, expected_version: 2, decision: "approved", note: "Finance approves the refreshed evidence." })})`);
    await setPolicyActor(db, actorId, true);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "award", selected_vendor_id: vendorIds[1], closure_note: "Final award follows approved best-value recommendation." })}) as event`);
    await deniedWorkspace(financeActorId, ['view_finance']);
  } finally {
    await db.close();
  }
});

test("executes an approved insufficient-bids exception through best-value variance and final award", async () => {
  const db = await createGovernedRouteFixture();
  const requestId = "75000000-0000-0000-0000-000000000001";
  const vendorIds = ["75000000-0000-0000-0000-000000000011", "75000000-0000-0000-0000-000000000012", "75000000-0000-0000-0000-000000000015"];
  const financeActorId = "75000000-0000-0000-0000-000000000013";
  const matrixId = "75000000-0000-0000-0000-000000000014";
  const criteria = (score) => ["technicalCompliance", "quality", "leadTime", "totalLifecycleCost", "warranty", "support", "price", "paymentTerms", "training"].map((criterion) => ({ criterion, score, evidence_reference: `private/exception/${criterion}.pdf` }));
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    await db.exec(`
      insert into core.profiles(id, status) values ('${checkerId}', 'active'), ('${financeActorId}', 'active');
      insert into procurement.doa_matrices(id, version, department, status, active, effective_at) values ('${matrixId}', 'OPS-EXCEPTION-1', 'Operations', 'active', true, statement_timestamp() - interval '1 day');
      insert into procurement.doa_assignments(matrix_id, department, min_amount, max_amount, tier, approver_user_id, active) values
        ('${matrixId}', 'Operations', 0, null, 'dept_head', '${checkerId}', true),
        ('${matrixId}', 'Operations', 0, null, 'finance', '${financeActorId}', true);
      insert into core.vendors(id, legal_name, accreditation_status) values ('${vendorIds[0]}', 'Exception technical vendor', 'approved'), ('${vendorIds[1]}', 'Exception value vendor', 'approved'), ('${vendorIds[2]}', 'Exception non-response vendor', 'approved');
    `);
    await insertRequest(db, { id: requestId, requirementKind: "materials", compliance: { riskFacts: { highRisk: true } } });
    await db.exec(`update procurement.requests set policy_profile_id = '${operatingProfileId}', department = 'Operations' where id = '${requestId}'; insert into procurement.route_decisions(request_id, policy_version, request_version, method, reasons, risk_facts, status, confirmed_by, solicitation_type, procurement_mode, governance_tier, policy_profile_id) values ('${requestId}', 'MWELL-FIXTURE:2026.01', 1, 'rfq', array['fixture'], '{}'::jsonb, 'confirmed', '${actorId}', 'rfq', 'competitive_bidding', 'standard', '${operatingProfileId}');`);
    await setPolicyActor(db, actorId, true);
    const event = await db.query(`select procurement.save_sourcing_event(${sqlJson({ request_id: requestId, submission_deadline: "2030-01-15T00:00:00.000Z", intended_responses: 3, package_version: "RFQ-EXCEPTION-v1", package_hash: "e".repeat(64) })}) as event`);
    const eventId = event.rows[0].event.id;
    await db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: eventId, vendor_ids: vendorIds })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "issue" })})`);
    for (const [index, vendorId] of vendorIds.slice(0, 2).entries()) await db.query(`select procurement.record_sourcing_response(${sqlJson({ sourcing_event_id: eventId, vendor_id: vendorId, received_at: "2029-12-30T00:00:00.000Z", proposal_storage_path: `private/exception/${index}.pdf`, commercial: { amount: 100000 + index * 10000 } })})`);
    await db.exec(`update procurement.sourcing_events set submission_deadline = statement_timestamp() - interval '1 minute' where id = '${eventId}'`);
    const close = await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "response_closed" })}) as event`);
    assert.equal(close.rows[0].event.status, 'failed_bid');
    assert.ok(close.rows[0].event.response_closed_at, 'failed-bid formal closure must retain the timestamp used by Task 7 SLAs');
    const exception = await db.query(`select procurement.submit_insufficient_bid_exception(${sqlJson({ sourcing_event_id: eventId, phase: "evaluation", justification: "The documented market search established only two compliant offers after exhaustive accredited outreach.", price_reasonableness: "Independent comparison and prior purchasing records support both commercial offers." })}) as pack`);
    await setPolicyActor(db, checkerId, true);
    await db.query(`select procurement.review_insufficient_bid_exception(${sqlJson({ id: exception.rows[0].pack.id, decision: "approved", note: "Independent reviewer approves the exception." })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "evaluation" })})`);
    await setPolicyActor(db, actorId, true);
    const tabulation = await db.query(`select procurement.save_commercial_tabulation(${sqlJson({ sourcing_event_id: eventId, evidence_reference: "private/exception/tabulation.xlsx", entries: vendorIds.slice(0, 2).map((vendor_id, index) => ({ vendor_id, quoted_amount: 100000 + index * 10000, evidence_reference: `private/exception/${index}.pdf` })) })}) as tabulation`);
    const evaluations = [];
    for (const [index, vendorId] of vendorIds.slice(0, 2).entries()) {
      const evaluation = await db.query(`select procurement.submit_technical_evaluation(${sqlJson({ sourcing_event_id: eventId, vendor_id: vendorId, evidence_reference: `private/exception/technical-${index}.pdf`, criteria: criteria(index === 0 ? 90 : 80) })}) as evaluation`);
      evaluations.push(evaluation.rows[0].evaluation);
    }
    const recommendation = await db.query(`select procurement.submit_award_recommendation(${sqlJson({ sourcing_event_id: eventId, evaluated_vendor_id: vendorIds[0], recommended_vendor_id: vendorIds[1], commercial_tabulation_id: tabulation.rows[0].tabulation.id, technical_evaluation_id: evaluations[1].id, rationale: "The documented best-value comparison supports the second offer.", risk_evidence_reference: "private/exception/risk.pdf", variance_justification: "Commercial value and support evidence justify the variance." })}) as recommendation`);
    await setPolicyActor(db, checkerId, true);
    await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 1, decision: "approved", note: "Department Head approves the exception route variance." })})`);
    await setPolicyActor(db, financeActorId, true);
    await db.query(`select procurement.review_recommendation_variance(${sqlJson({ award_recommendation_id: recommendation.rows[0].recommendation.id, expected_version: 2, decision: "approved", note: "Finance independently approves the exception route variance." })})`);
    await db.query(`select procurement.transition_sourcing_event(${sqlJson({ id: eventId, action: "award", selected_vendor_id: vendorIds[1], closure_note: "Approved exception route final award." })})`);
  } finally {
    await db.close();
  }
});

test('executes the disposable public Task 10 vendor and payment authority matrix', async () => {
  const db = await createGovernedRouteFixture();
  const maker = '76000000-0000-0000-0000-000000000001';
  const legalDecider = '76000000-0000-0000-0000-000000000002';
  const unrelated = '76000000-0000-0000-0000-000000000003';
  const vendorId = '76000000-0000-0000-0000-000000000004';
  const reviewId = '76000000-0000-0000-0000-000000000005';
  const pendingReviewId = '76000000-0000-0000-0000-000000000007';
  const procurement = '76000000-0000-0000-0000-000000000008';
  const finance = '76000000-0000-0000-0000-000000000009';
  const vendorActor = '76000000-0000-0000-0000-000000000010';
  const legacyVendorId = '76000000-0000-0000-0000-000000000013';
  const legacyDispositionId = '76000000-0000-0000-0000-000000000014';
  const withRole = async (role, actor, procurementCapabilities, legalCapabilities, action, actorVendorId = null) => {
    await db.exec('reset role');
    await setPolicyActor(db, actor, false, procurementCapabilities, actorVendorId, legalCapabilities);
    await db.exec(`set role ${role}`);
    try { return await action(); } finally { await db.exec('reset role'); }
  };
  try {
    await db.exec(migrationBeforeBackfillForPglite);
    await seedActivePolicyProfiles(db);
    await db.exec(migrationTask6);
    await db.exec(`
      insert into core.profiles(id,status) values ('${maker}','active');
      insert into core.vendors(id,legal_name,accreditation_status) values ('${legacyVendorId}','Legacy clearance vendor','approved');
      insert into legal.accreditation_cases(id,vendor_id,jurisdiction) values ('legacy-clearance-case','${legacyVendorId}','PH');
      insert into legal.accreditation_dispositions(id,case_id,disposition,conditions,follow_up_due_at,decided_by)
      values ('${legacyDispositionId}','legacy-clearance-case','temporary_clearance',jsonb_build_object('approved',true,'category','goods','max_amount',25000,'valid_from','2025-01-01T00:00:00.000Z','valid_until','2027-01-01T00:00:00.000Z'), '2027-01-01T00:00:00.000Z','${maker}');
    `);
    await db.exec(migrationTask10);
    await db.exec(migrationLegacyClearanceBackfill);
    await db.exec(`
      create or replace function procurement.issue_purchase_order_pre_task_10(payload jsonb)
      returns jsonb language plpgsql security definer set search_path = '' as $$
      declare issued procurement.purchase_orders;
      begin
        update procurement.purchase_orders set status='issued', issued_at=statement_timestamp(), actor_id=auth.uid() where id=payload->>'id' and status='approved' returning * into issued;
        if not found then raise exception 'Only approved POs may be issued'; end if;
        return to_jsonb(issued);
      end;
      $$;
      grant usage on schema legal, procurement, core, auth, private to anon, authenticated, service_role;
      grant select on core.vendors, procurement.requests, procurement.purchase_orders, procurement.acceptance_packs, procurement.payment_readiness_packs, legal.accreditation_cases to authenticated;
      create policy task10_fixture_vendor_read on core.vendors for select to authenticated using (true);
      alter table procurement.purchase_orders add column acceptance_evidence_version integer not null default 1;
      alter table procurement.acceptance_packs add column accepted_amount numeric, add column accepted_at timestamptz default statement_timestamp(), add column accepted_scope jsonb default '{}'::jsonb;
      alter table procurement.payment_readiness_packs add column acceptance_pack_id uuid, add column acceptance_pack_ids uuid[], add column accepted_quantity numeric default 0, add column acceptance_evidence_version integer, add column policy_version text, add column po_match boolean, add column invoice_or_si_storage_path text, add column milestone_support_storage_path text, add column tax_withholding_support_storage_path text, add column invoice_number text, add column invoice_date date, add column due_date date, add column tax_amount numeric default 0, add column withholding_amount numeric default 0, add column variance_amount numeric default 0, add column corrected_from uuid, add column evidence_stale boolean not null default false, add column evidence_stale_at timestamptz, add column finance_reviewed_by uuid, add column finance_reviewed_at timestamptz, add column finance_note text;
      create table procurement.payment_readiness_staleness_events(id uuid primary key default gen_random_uuid(),payment_readiness_pack_id uuid not null,purchase_order_id text not null,prior_status text not null,prior_acceptance_evidence_version bigint not null,acceptance_evidence_version bigint not null,reason text not null,recorded_at timestamptz not null default now(),unique(payment_readiness_pack_id,acceptance_evidence_version));
      insert into core.profiles(id,status) values ('${maker}','active'),('${legalDecider}','active'),('${unrelated}','active'),('${procurement}','active'),('${finance}','active'),('${vendorActor}','active') on conflict (id) do nothing;
      insert into core.vendors(id,legal_name,accreditation_status) values ('${vendorId}','Task 10 vendor','approved');
      insert into legal.vendor_probation_reviews(
        id,vendor_id,policy_profile_id,due_at,status,opened_by,po_win_rate,delivery_commitment_rate,
        return_or_rejection_count,document_timeliness_rate,evidence_reference,notice_reference
      ) values ('${reviewId}','${vendorId}','${operatingProfileId}',statement_timestamp(),'completed','${maker}',.2,1,0,1,'private/review.pdf','private/notice.pdf');
      insert into legal.vendor_probation_reviews(id,vendor_id,policy_profile_id,due_at,status,opened_by)
      values ('${pendingReviewId}','${vendorId}','${operatingProfileId}',statement_timestamp(),'open','${maker}');
      insert into procurement.requests(id,status,estimated_amount,category,policy_profile_id,updated_at) values ('76000000-0000-0000-0000-000000000006','approved',50000,'goods','${operatingProfileId}',statement_timestamp());
      insert into procurement.route_decisions(id,request_id,status,request_version,policy_profile_id,policy_version,method,reasons,confirmed_by) values ('76000000-0000-0000-0000-000000000011','76000000-0000-0000-0000-000000000006','confirmed',1,'${operatingProfileId}','MWELL-OPS-1','rfq',ARRAY['controlled fixture'],'${procurement}');
      insert into procurement.sourcing_events(id,request_id,route_decision_id,status,intended_responses,submission_deadline,original_submission_deadline,package_version,package_hash,created_by) values ('76000000-0000-0000-0000-000000000012','76000000-0000-0000-0000-000000000006','76000000-0000-0000-0000-000000000011','draft',3,statement_timestamp()+interval '7 days',statement_timestamp()+interval '7 days','controlled-v1',repeat('a',32),'${procurement}');
      insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,acceptance_evidence_version) values ('PO-TASK10','76000000-0000-0000-0000-000000000006','${vendorId}','issued',50000,1);
      insert into procurement.purchase_orders(id,request_id,core_vendor_id,status,total,acceptance_evidence_version) values ('PO-TASK10-ISSUE','76000000-0000-0000-0000-000000000006','${vendorId}','approved',50000,1);
      insert into procurement.acceptance_packs(purchase_order_id,status,exceptions,accepted_amount) values ('PO-TASK10','accepted','[]'::jsonb,50000);
    `);
    await db.exec(migrationPaymentStalenessTrigger);

    await withRole('anon', unrelated, [], [], async () => {
      await assert.rejects(
        () => db.query(`select legal.record_vendor_eligibility_decision(${sqlJson({ probation_review_id: reviewId, expected_revision: 0, decision: 'pass', evidence_reference: 'private/review.pdf', notice_reference: 'private/pass.pdf' })})`),
        /permission denied/i,
        'anon cannot decide vendor eligibility',
      );
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10' })})`),
        /permission denied/i,
        'anon cannot invoke the live invoice preparation endpoint',
      );
      await assert.rejects(
        () => db.query(`select procurement.review_payment_readiness(${sqlJson({ id: '00000000-0000-0000-0000-000000000001', status: 'accepted' })})`),
        /permission denied/i,
        'anon cannot invoke the Finance acceptance endpoint',
      );
      await assert.rejects(
        () => db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: '00000000-0000-0000-0000-000000000001', amount: 1, payment_reference: 'FORGED', paid_at: '2030-01-03' })})`),
        /permission denied/i,
        'anon cannot invoke the Finance release endpoint',
      );
    });
    await withRole('authenticated', unrelated, [], [], async () => {
      await assert.rejects(
        () => db.query(`select legal.record_vendor_eligibility_decision(${sqlJson({ probation_review_id: reviewId, expected_revision: 0, decision: 'pass', evidence_reference: 'private/review.pdf', notice_reference: 'private/pass.pdf' })})`),
        /authority/i,
        'unrelated authenticated actor cannot decide vendor eligibility',
      );
      await assert.rejects(
        () => db.query(`select private.policy_vendor_eligibility_projection('${vendorId}'::uuid, 'goods', statement_timestamp())`),
        /permission denied/i,
        'application roles cannot execute the private eligibility projection',
      );
      await assert.rejects(
        () => db.query(`insert into procurement.payment_readiness_packs(purchase_order_id,status,invoice_amount) values ('PO-TASK10','accepted',1)`),
        /permission denied|row-level security/i,
        'unrelated authenticated actor cannot write a Finance pack directly',
      );
    });
    await withRole('authenticated', maker, [], ['review_accreditation'], async () => {
      await assert.rejects(
        () => db.query(`select legal.record_vendor_probation_review(${sqlJson({ probation_review_id: pendingReviewId, expected_revision: 1, po_win_rate: .2 })})`),
        /Evidence and issued notice|metrics are required/i,
        'Legal cannot complete a six-month review without all required metrics and evidence',
      );
      const completed = await db.query(`select legal.record_vendor_probation_review(${sqlJson({ probation_review_id: pendingReviewId, expected_revision: 1, po_win_rate: .2, delivery_commitment_rate: 1, return_or_rejection_count: 0, document_timeliness_rate: 1, evidence_reference: 'private/pending-review.pdf', notice_reference: 'private/pending-notice.pdf' })}) as result`);
      assert.equal(completed.rows[0].result.replayed, false);
      const replay = await db.query(`select legal.record_vendor_probation_review(${sqlJson({ probation_review_id: pendingReviewId, expected_revision: 1, po_win_rate: .2, delivery_commitment_rate: 1, return_or_rejection_count: 0, document_timeliness_rate: 1, evidence_reference: 'private/pending-review.pdf', notice_reference: 'private/pending-notice.pdf' })}) as result`);
      assert.equal(replay.rows[0].result.replayed, true, 'identical probation-review retry is replayed');
      await assert.rejects(
        () => db.query(`select legal.record_vendor_probation_review(${sqlJson({ probation_review_id: pendingReviewId, expected_revision: 1, po_win_rate: .3, delivery_commitment_rate: 1, return_or_rejection_count: 0, document_timeliness_rate: 1, evidence_reference: 'private/pending-review.pdf', notice_reference: 'private/pending-notice.pdf' })})`),
        /refresh before retrying/i,
        'non-identical probation-review retry is rejected as stale',
      );
      await assert.rejects(
        () => db.query(`select legal.record_vendor_eligibility_decision(${sqlJson({ probation_review_id: reviewId, expected_revision: 0, decision: 'pass', evidence_reference: 'private/review.pdf', notice_reference: 'private/pass.pdf' })})`),
        /decision authority|maker and decision actor/i,
        'Legal maker cannot self-decide vendor eligibility',
      );
    });
    await withRole('authenticated', legalDecider, [], ['review_accreditation', 'approve_accreditation'], async () => {
      const decided = await db.query(`select legal.record_vendor_eligibility_decision(${sqlJson({ probation_review_id: reviewId, expected_revision: 0, decision: 'pass', evidence_reference: 'private/review.pdf', notice_reference: 'private/pass.pdf' })}) as result`);
      assert.equal(decided.rows[0].result.replayed, false);
      const replay = await db.query(`select legal.record_vendor_eligibility_decision(${sqlJson({ probation_review_id: reviewId, expected_revision: 0, decision: 'pass', evidence_reference: 'private/review.pdf', notice_reference: 'private/pass.pdf' })}) as result`);
      assert.equal(replay.rows[0].result.replayed, true, 'identical Legal decision retry is replayed');
      await assert.rejects(
        () => db.query(`insert into legal.vendor_eligibility_decisions(vendor_id,status,evidence_reference,notice_reference,opened_by,decided_by) values ('${vendorId}','approved','forged','forged','${maker}','${legalDecider}')`),
        /permission denied|row-level security/i,
        'Legal must use the governed decision RPC rather than direct writes',
      );
      const sample = await db.query(`select legal.record_vendor_sample_custody(${sqlJson({ vendor_id: vendorId, expected_revision: 0, purpose: 'Clinical evaluation', custodian_id: maker, evaluation_reference: 'private/evaluation.pdf', disposition: 'returned', evidence_reference: 'private/custody.pdf', mwell_requested: false })}) as result`);
      assert.equal(sample.rows[0].result.replayed, false);
    });
    await withRole('authenticated', procurement, ['author_po'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10', invoice_number: 'INV-TASK10-1', invoice_date: '2030-01-01', invoice_amount: 50000, invoice_or_si_storage_path: 'private/invoice.pdf', milestone_support_storage_path: 'private/acceptance.pdf' })})`),
        /tax and withholding/i,
        'the live invoice-preparation endpoint rejects incomplete Finance evidence',
      );
      await db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10', invoice_number: 'INV-TASK10-1', invoice_date: '2030-01-01', invoice_amount: 50000, tax_amount: 6000, withholding_amount: 500, invoice_or_si_storage_path: 'private/invoice.pdf', milestone_support_storage_path: 'private/acceptance.pdf', tax_withholding_support_storage_path: 'private/tax.pdf' })}) as pack`);
      await assert.rejects(
        () => db.query(`select procurement.review_payment_readiness(${sqlJson({ id: '00000000-0000-0000-0000-000000000001', status: 'accepted' })})`),
        /Not authorized/i,
        'Procurement cannot accept payment readiness for Finance',
      );
    });
    await withRole('authenticated', vendorActor, [], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10' })})`),
        /Not authorized/i,
        'vendor cannot prepare payment readiness',
      );
      await assert.rejects(
        () => db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: '00000000-0000-0000-0000-000000000001', amount: 1, payment_reference: 'FORGED', paid_at: '2030-01-03' })})`),
        /Not authorized/i,
        'vendor cannot release payments',
      );
    }, vendorId);
    await withRole('service_role', procurement, ['admin'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10' })})`),
        /permission denied/i,
        'service role cannot invoke the retired-or-bypassed live preparation path',
      );
      await assert.rejects(
        () => db.query(`select private.policy_prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10' })})`),
        /permission denied/i,
        'service role cannot invoke the private readiness implementation',
      );
      await assert.rejects(
        () => db.query(`insert into procurement.payment_readiness_packs(purchase_order_id,status,invoice_amount) values ('PO-TASK10','accepted',1)`),
        /permission denied|row-level security/i,
        'service role cannot forge Finance readiness directly',
      );
    });
    await db.exec(`update core.vendors set accreditation_expires_at = current_date - 1 where id='${vendorId}'`);
    await withRole('authenticated', procurement, ['author_po'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson({ purchase_order_id: 'PO-TASK10', invoice_number: 'INV-TASK10-2', invoice_date: '2030-01-02', invoice_amount: 1, tax_amount: 1, withholding_amount: 0, invoice_or_si_storage_path: 'private/invoice-2.pdf', milestone_support_storage_path: 'private/acceptance.pdf', tax_withholding_support_storage_path: 'private/tax.pdf' })})`),
        /eligibility/i,
        'core accreditation expiry blocks the actual invoice-preparation endpoint',
      );
    });
    await withRole('authenticated', procurement, ['author_po', 'manage_rfp'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: '76000000-0000-0000-0000-000000000012', vendor_ids: [vendorId] })})`),
        /eligibility/i,
        'core accreditation expiry blocks the live invitation endpoint before an invitation can issue',
      );
      await assert.rejects(
        () => db.query(`select procurement.issue_purchase_order(${sqlJson({ id: 'PO-TASK10' })})`),
        /eligibility/i,
        'core accreditation expiry blocks the live PO issue endpoint before issue processing',
      );
    });
    const openClearance = async (scope, effectiveAt, expiresAt) => withRole('authenticated', maker, [], ['review_accreditation'], async () => {
      const opened = await db.query(`select legal.open_vendor_temporary_clearance(${sqlJson({ vendor_id: vendorId, expected_revision: 0, scope, amount_limit: 50000, effective_at: effectiveAt, expires_at: expiresAt, evidence_reference: `private/${scope}-clearance.pdf`, notice_reference: `private/${scope}-notice.pdf` })}) as result`);
      return opened.rows[0].result.id;
    });
    const approveClearance = async (clearanceId) => withRole('authenticated', legalDecider, [], ['review_accreditation', 'approve_accreditation'], async () => {
      const decided = await db.query(`select legal.decide_vendor_temporary_clearance(${sqlJson({ clearance_id: clearanceId, expected_revision: 1, decision: 'approve' })}) as result`);
      assert.equal(decided.rows[0].result.replayed, false);
      const replay = await db.query(`select legal.decide_vendor_temporary_clearance(${sqlJson({ clearance_id: clearanceId, expected_revision: 1, decision: 'approve' })}) as result`);
      assert.equal(replay.rows[0].result.replayed, true, 'identical clearance decision retry is replayed');
    });
    const paymentPayload = (invoiceNumber, foreignEvidence) => sqlJson({ purchase_order_id: 'PO-TASK10', invoice_number: invoiceNumber, invoice_date: '2030-01-03', invoice_amount: 1, tax_amount: 0, withholding_amount: 0, invoice_or_si_storage_path: 'private/invoice-clearance.pdf', milestone_support_storage_path: 'private/acceptance.pdf', tax_withholding_support_storage_path: 'private/tax.pdf', foreign_vendor_evidence_storage_path: foreignEvidence });
    for (const [scope, effectiveAt, expiresAt, name] of [
      ['services', '2025-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 'wrong scope'],
      ['goods', '2031-01-01T00:00:00.000Z', '2032-01-01T00:00:00.000Z', 'future'],
      ['goods', '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 'expired'],
    ]) {
      const clearanceId = await openClearance(scope, effectiveAt, expiresAt);
      await approveClearance(clearanceId);
      await withRole('authenticated', procurement, ['author_po'], [], async () => {
        await assert.rejects(
          () => db.query(`select procurement.prepare_invoice_payment_readiness(${paymentPayload(`INV-${name}`)})`),
          /eligibility/i,
          `${name} temporary clearance cannot authorize payment`,
        );
      });
    }
    await db.exec(`update core.vendors set accreditation_expires_at = current_date + 30 where id='${vendorId}'`);
    const clearanceId = await openClearance('goods', '2025-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    await approveClearance(clearanceId);
    await withRole('authenticated', procurement, ['author_po'], [], async () => {
      const clearance = await db.query(`select legal.vendor_eligibility_projection(${sqlJson({ vendor_id: vendorId, scope: 'goods' })}) as projection`);
      assert.equal(clearance.rows[0].projection.status, 'temporary_clearance');
      assert.equal(clearance.rows[0].projection.eligible, true);
      const prepared = await db.query(`select procurement.prepare_invoice_payment_readiness(${paymentPayload('INV-CLEARANCE-ACTIVE')}) as result`);
      assert.equal(prepared.rows[0].result.status, 'ready_for_finance');
    });
    let invitationResult;
    let issueResult;
    await withRole('authenticated', procurement, ['author_po', 'manage_rfp'], [], async () => {
      const invitation = await db.query(`select procurement.invite_sourcing_vendors(${sqlJson({ sourcing_event_id: '76000000-0000-0000-0000-000000000012', vendor_ids: [vendorId] })}) as result`);
      assert.equal(invitation.rows[0].result.recipient_count, 1, 'active exact clearance permits a controlled Procurement invitation');
      invitationResult = invitation.rows[0].result;

      const issued = await db.query(`select procurement.issue_purchase_order(${sqlJson({ id: 'PO-TASK10-ISSUE' })}) as result`);
      assert.equal(issued.rows[0].result.status, 'issued', 'active exact clearance permits issue of an independently approved PO');
      issueResult = issued.rows[0].result;
    });
    assert.equal(invitationResult.recipient_count, 1, 'the Procurement RPC returns its exact invitation recipient count');
    assert.equal(issueResult.status, 'issued', 'the Procurement RPC returns its exact issued PO state');
    const persistedInvitation = await db.query(`select vendor_id, invited_at is not null as invited from procurement.sourcing_responses where sourcing_event_id='76000000-0000-0000-0000-000000000012' and vendor_id='${vendorId}'`);
    assert.deepEqual(persistedInvitation.rows[0], { vendor_id: vendorId, invited: true }, 'the successful invitation persists its governed recipient evidence');
    const persistedIssue = await db.query(`select status from procurement.purchase_orders where id='PO-TASK10-ISSUE'`);
    assert.equal(persistedIssue.rows[0].status, 'issued', 'the independently issued PO persists its governed issued state');
    const acceptedPack = await db.query(`select id from procurement.payment_readiness_packs where purchase_order_id='PO-TASK10' and invoice_number='INV-CLEARANCE-ACTIVE'`);
    await withRole('authenticated', finance, ['view_finance'], [], async () => {
      const accepted = await db.query(`select procurement.review_payment_readiness(${sqlJson({ id: acceptedPack.rows[0].id, status: 'accepted', note: 'Finance accepted the complete governed pack.' })}) as result`);
      assert.equal(accepted.rows[0].result.status, 'accepted', 'real Finance actor accepts the governed evidence');
    });
    await db.exec(`insert into procurement.acceptance_packs(purchase_order_id,status,exceptions,accepted_amount) values ('PO-TASK10','accepted','[]'::jsonb,1)`);
    await withRole('authenticated', finance, ['view_finance'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.review_payment_readiness(${sqlJson({ id: acceptedPack.rows[0].id, status: 'accepted', note: 'Forged stale reacceptance.' })})`),
        /stale/i,
        'Finance cannot accept evidence after the authoritative acceptance version changes',
      );
      await assert.rejects(
        () => db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: acceptedPack.rows[0].id, amount: 1, payment_reference: 'STALE-RELEASE', paid_at: '2030-01-03' })})`),
        /stale/i,
        'Finance cannot release an accepted pack after the authoritative acceptance set changes',
      );
    });
    const stale = await db.query(`select evidence_stale,status from procurement.payment_readiness_packs where id='${acceptedPack.rows[0].id}'`);
    assert.deepEqual(stale.rows[0], { evidence_stale: true, status: 'accepted' }, 'stale finalized evidence remains auditable and cannot become payable');
    await db.exec(`insert into legal.accreditation_cases(id,vendor_id,jurisdiction) values ('foreign-case','${vendorId}','US')`);
    let correctedPackId;
    await withRole('authenticated', procurement, ['author_po'], [], async () => {
      await assert.rejects(
        () => db.query(`select procurement.prepare_invoice_payment_readiness(${paymentPayload('INV-FOREIGN-MISSING')})`),
        /Foreign-vendor/i,
        'foreign vendors require their own tax and payment-control evidence',
      );
      const correctedPayload = { purchase_order_id: 'PO-TASK10', invoice_number: 'INV-FOREIGN-SUPPORTED', invoice_date: '2030-01-03', invoice_amount: 1, tax_amount: 0, withholding_amount: 0, invoice_or_si_storage_path: 'private/invoice-clearance.pdf', milestone_support_storage_path: 'private/acceptance.pdf', tax_withholding_support_storage_path: 'private/tax.pdf', foreign_vendor_evidence_storage_path: 'private/foreign-tax.pdf', corrected_from: acceptedPack.rows[0].id };
      const corrected = await db.query(`select procurement.prepare_invoice_payment_readiness(${sqlJson(correctedPayload)}) as result`);
      correctedPackId = corrected.rows[0].result.id;
      assert.equal(corrected.rows[0].result.corrected_from, acceptedPack.rows[0].id, 'governed correction links its stale finalized evidence');
    });
    await withRole('authenticated', finance, ['view_finance'], [], async () => {
      const accepted = await db.query(`select procurement.review_payment_readiness(${sqlJson({ id: correctedPackId, status: 'accepted', note: 'Corrected evidence accepted.' })}) as result`);
      assert.equal(accepted.rows[0].result.status, 'accepted');
      const released = await db.query(`select procurement.release_payment(${sqlJson({ payment_readiness_pack_id: correctedPackId, amount: 1, payment_reference: 'CORRECTED-RELEASE', paid_at: '2030-01-03' })}) as result`);
      assert.equal(released.rows[0].result.pack.status, 'released', 'corrected current evidence can be accepted and released by Finance');
    });
    const grants = await db.query(`select
      has_function_privilege('authenticated','legal.record_vendor_eligibility_decision(jsonb)','EXECUTE') as legal_rpc,
      has_function_privilege('authenticated','private.policy_assert_request_vendor_eligible(uuid,text,text)','EXECUTE') as private_guard,
      has_table_privilege('authenticated','legal.vendor_sample_custody_events','INSERT') as direct_sample_write`);
    assert.deepEqual(grants.rows[0], { legal_rpc: true, private_guard: false, direct_sample_write: false });
    const legacyClearance = await db.query(`select vendor_id,scope,amount_limit,status,legacy_disposition_id from legal.vendor_temporary_clearances where legacy_disposition_id='${legacyDispositionId}'`);
    assert.deepEqual(legacyClearance.rows[0], { vendor_id: legacyVendorId, scope: 'goods', amount_limit: '25000', status: 'approved', legacy_disposition_id: legacyDispositionId }, 'approved legacy Legal temporary clearance is deterministically backfilled once');
  } finally { await db.close(); }
});

test("PGlite parse smoke loads the migration without a live database", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema core;
      create schema procurement;
      create schema legal;
      create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
      create function core.has_live_cap(text, text) returns boolean language sql stable as $$ select true $$;
      create function core.current_vendor_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function private.policy_submit_procurement_request(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function procurement.create_request(jsonb) returns jsonb language sql as $$ select $1 $$;
      create function procurement.insufficient_bid_exception(jsonb) returns jsonb language sql as $$ select null::jsonb $$;
      create table core.profiles (id uuid primary key, vendor_id uuid, full_name text, status text not null default 'active');
      create table core.vendors (id uuid primary key, legal_name text, accreditation_status text default 'approved', accreditation_expires_at timestamptz);
      create table legal.accreditation_cases (id text primary key, vendor_id uuid references core.vendors(id), jurisdiction text);
      create table legal.accreditation_dispositions (id uuid primary key default gen_random_uuid(), case_id text references legal.accreditation_cases(id), disposition text, reason text not null default 'fixture', conditions jsonb not null default '{}'::jsonb, follow_up_due_at timestamptz, decided_by uuid references core.profiles(id), decided_at timestamptz not null default statement_timestamp());
      create table procurement.requests (
        id uuid primary key,
        status text,
        estimated_amount numeric,
        requirement_kind text,
        solicitation_type text,
        procurement_mode text,
        governance_tier text,
        policy_profile_id uuid,
        route_reasons jsonb,
        sourcing_method text,
        sourcing_override boolean,
        category text,
        lines jsonb default '[]'::jsonb,
        compliance jsonb default '{}'::jsonb,
        attachments jsonb default '[]'::jsonb,
        department text,
        core_vendor_id uuid,
        vendor_name text,
        requester_id uuid,
        updated_at timestamptz default now()
      );
      create table procurement.purchase_orders (
        id text primary key,
        request_id uuid references procurement.requests(id),
        core_vendor_id uuid references core.vendors(id),
        status text not null default 'draft',
        issued_at timestamptz,
        actor_id uuid references core.profiles(id),
        updated_at timestamptz default now()
      );
      create table procurement.acceptance_packs (
        id uuid primary key default gen_random_uuid(),
        purchase_order_id text references procurement.purchase_orders(id),
        status text not null default 'draft',
        exceptions jsonb not null default '[]'::jsonb
      );
      create table procurement.payment_readiness_packs (
        id uuid primary key default gen_random_uuid(),
        purchase_order_id text references procurement.purchase_orders(id),
        status text not null default 'draft',
        invoice_amount numeric not null default 0,
        released_amount numeric not null default 0,
        accepted_amount numeric not null default 0,
        purchase_order_amount numeric not null default 0
      );
      create table procurement.payment_releases (
        id uuid primary key default gen_random_uuid(),
        payment_readiness_pack_id uuid references procurement.payment_readiness_packs(id),
        purchase_order_id text references procurement.purchase_orders(id),
        amount numeric not null,
        payment_reference text unique,
        payment_method text,
        paid_at date,
        status text not null default 'posted'
      );
      create table procurement.v_purchase_order_receipt_status_fixture (
        purchase_order_id text primary key,
        rejected_or_quarantined_quantity numeric default 0,
        outstanding_quantity numeric default 0
      );
      create view procurement.v_purchase_order_receipt_status as
        select purchase_order_id, rejected_or_quarantined_quantity, outstanding_quantity
        from procurement.v_purchase_order_receipt_status_fixture;
      create table procurement.route_decisions (
        id uuid primary key default gen_random_uuid(),
        request_id uuid not null references procurement.requests(id),
        policy_version text not null,
        request_version integer not null default 1,
        method text not null,
        reasons text[] not null default '{}',
        risk_facts jsonb not null default '{}'::jsonb,
        status text not null default 'confirmed',
        confirmed_by uuid references core.profiles(id),
        confirmed_at timestamptz not null default now(),
        unique(request_id, request_version)
      );
      create table procurement.exception_packs (
        id uuid primary key default gen_random_uuid(),
        request_id uuid not null references procurement.requests(id),
        exception_type text not null,
        justification text not null default 'fixture justification value',
        evidence jsonb not null default '{}'::jsonb,
        price_reasonableness text,
        procurement_head_reviewed_by uuid references core.profiles(id),
        procurement_head_reviewed_at timestamptz,
        status text not null default 'draft'
      );
      create table procurement.sourcing_events (
        id uuid primary key default gen_random_uuid(),
        request_id uuid not null references procurement.requests(id),
        route_decision_id uuid not null references procurement.route_decisions(id),
        issued_at timestamptz,
        submission_deadline timestamptz,
        intended_responses integer,
        clarification_log jsonb not null default '[]'::jsonb,
        status text not null default 'draft',
        selected_vendor_id uuid references core.vendors(id),
        closure_note text,
        closed_at timestamptz,
        created_by uuid references core.profiles(id),
        created_at timestamptz not null default now()
      );
      create table procurement.sourcing_responses (
        id uuid primary key default gen_random_uuid(),
        sourcing_event_id uuid not null references procurement.sourcing_events(id),
        vendor_id uuid not null references core.vendors(id),
        invited_at timestamptz,
        received_at timestamptz,
        deadline_compliant boolean,
        proposal_storage_path text,
        commercial jsonb not null default '{}'::jsonb,
        technical jsonb not null default '{}'::jsonb,
        material_exceptions jsonb not null default '[]'::jsonb,
        unique(sourcing_event_id, vendor_id)
      );
      create table procurement.doa_matrices (
        id uuid primary key default gen_random_uuid(),
        version text not null,
        department text not null,
        status text not null default 'active',
        active boolean not null default true,
        effective_at timestamptz not null default now(),
        expires_at timestamptz
      );
      create table procurement.doa_assignments (
        id uuid primary key default gen_random_uuid(),
        matrix_id uuid not null references procurement.doa_matrices(id),
        department text not null,
        category text,
        min_amount numeric not null default 0,
        max_amount numeric,
        tier text not null,
        approver_user_id uuid not null references core.profiles(id),
        active boolean not null default true
      );
      create table core.policy_remediation_queue (
        id uuid primary key default gen_random_uuid(),
        module text not null,
        entity_type text not null,
        entity_id text not null,
        policy_version text not null,
        reason_code text not null,
        details jsonb not null default '{}'::jsonb,
        status text not null default 'open',
        unique(module, entity_type, entity_id, policy_version, reason_code)
      );
    `);

    await db.exec(migration);

    const mapLegacyRoute = async (method, category, compliance = {}) => {
      const result = await db.query(`
        select private.policy_legacy_route_mapping(
          '${method}', '${category}', '[{"description":"evidence"}]'::jsonb,
          '${JSON.stringify(compliance)}'::jsonb, 250000::numeric, 1000000::numeric
        ) as route
      `);
      return result.rows[0].route;
    };

    for (const [riskKey, reason] of [
      ['complex', 'risk:complex'],
      ['technical', 'risk:technical'],
      ['strategic', 'risk:strategic'],
      ['highRisk', 'risk:high_risk'],
      ['high_risk', 'risk:high_risk'],
      ['dataSensitive', 'risk:data_sensitive'],
      ['data_sensitive', 'risk:data_sensitive'],
      ['importation', 'risk:importation'],
    ]) {
      const route = await mapLegacyRoute('rfq', 'goods', { riskFacts: { [riskKey]: true } });
      assert.equal(route.governance_tier, 'high_risk', `${riskKey} must preserve high-risk governance`);
      assert.ok(route.reasons.includes(reason), `${riskKey} must retain its normalized reason`);
      assert.equal(route.compliance.riskFacts[reason.split(':')[1] === 'high_risk' ? 'highRisk' : reason.split(':')[1] === 'data_sensitive' ? 'dataSensitive' : riskKey], true);
    }

    for (const [method, category, expected] of [
      ['rfq', 'goods', { solicitation_type: 'rfq', procurement_mode: 'competitive_bidding' }],
      ['rfp', 'services', { solicitation_type: 'rfp', procurement_mode: 'competitive_bidding' }],
      ['direct_award', 'goods', { solicitation_type: 'none', procurement_mode: 'sole_source' }],
      ['repeat_order', 'goods', { solicitation_type: 'none', procurement_mode: 'repeat_order' }],
      ['emergency', 'services', { solicitation_type: 'none', procurement_mode: 'emergency_purchase' }],
      ['petty_cash', 'petty_cash', { solicitation_type: 'none', procurement_mode: 'petty_cash' }],
    ]) {
      const route = await mapLegacyRoute(method, category);
      assert.equal(route.requires_review, false, `${method} must remain deterministic`);
      assert.equal(route.solicitation_type, expected.solicitation_type);
      assert.equal(route.procurement_mode, expected.procurement_mode);
    }
    for (const method of ['small_purchase', 'unsupported_legacy_method']) {
      const first = await mapLegacyRoute(method, 'goods');
      const second = await mapLegacyRoute(method, 'goods');
      assert.deepEqual(second, first, `${method} mapping must be idempotent`);
      assert.equal(first.requires_review, true);
      assert.equal(first.solicitation_type, null);
      assert.equal(first.procurement_mode, null);
      assert.equal(first.governance_tier, null);
      assert.ok(first.reasons.includes('legacy_mapping_requires_review'));
    }

    const confirmationPayload = JSON.stringify({
      request_id: 'req-contract-001',
      expected_route_version: 0,
      requested_mode: 'competitive_bidding',
      method: 'rfp',
      solicitation_type: 'rfp',
      governance_tier: 'high_risk',
      policy_profile_id: 'client-controlled',
      reasons: ['client-controlled'],
    });
    const confirmation = await db.query(`
      select private.policy_route_confirmation_input('${confirmationPayload}'::jsonb, 0) as contract
    `);
    assert.deepEqual(confirmation.rows[0].contract, {
      request_id: 'req-contract-001',
      expected_route_version: 0,
      requested_mode: 'competitive_bidding',
    });
    const minimalConfirmation = await db.query(`
      select private.policy_route_confirmation_input(
        '{"request_id":"req-contract-001","expected_route_version":0,"requested_mode":"sole_source"}'::jsonb,
        0
      ) as contract
    `);
    assert.deepEqual(minimalConfirmation.rows[0].contract, {
      request_id: 'req-contract-001',
      expected_route_version: 0,
      requested_mode: 'sole_source',
    });
    await assert.rejects(
      () => db.query("select private.policy_route_confirmation_input('{\"request_id\":\"req-contract-001\"}'::jsonb, 0)"),
      /stale/,
    );
    await assert.rejects(
      () => db.query("select private.policy_route_confirmation_input('{\"request_id\":\"req-contract-001\",\"expected_route_version\":0}'::jsonb, 1)"),
      /stale/,
    );

    const approvedException = await db.query(`
      select private.policy_route_exception_contract('sole_source', 100, 2000, 250000, 'sole_supplier') as blockers
    `);
    assert.deepEqual(approvedException.rows[0].blockers, []);
    const missingException = await db.query(`
      select private.policy_route_exception_contract('petty_cash', 2500, 2000, 250000, null) as blockers
    `);
    assert.deepEqual(missingException.rows[0].blockers, [
      'approved_exception_evidence',
      'petty_cash_amount_exceeds_policy',
    ]);
  } finally {
    await db.close();
  }
});
