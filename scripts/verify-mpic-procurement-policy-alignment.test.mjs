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

const BACKFILL_MARKER = "-- Deterministic legacy backfill. Ambiguous values are explicitly marked and";
const RESTORE_MARKER = "-- Restore the effective public submission contract without editing historical";
const migrationBeforeBackfill = migration.slice(0, migration.indexOf(BACKFILL_MARKER));
const migrationBackfill = migration.slice(
  migration.indexOf(BACKFILL_MARKER),
  migration.indexOf(RESTORE_MARKER),
);

const actorId = "00000000-0000-0000-0000-000000000001";
const parentProfileId = "00000000-0000-0000-0000-000000000002";
const operatingProfileId = "00000000-0000-0000-0000-000000000003";

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
    create function auth.uid() returns uuid language sql stable as $$ select '${actorId}'::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_live_cap(text, text) returns boolean language sql stable as $$ select true $$;
    create function private.policy_submit_procurement_request(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create table core.profiles (id uuid primary key, status text not null default 'active');
    create table core.vendors (id uuid primary key);
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
      requester_id uuid,
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
      status text not null default 'draft'
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

async function insertRequest(db, {
  id,
  sourcingMethod = "rfq",
  category = "goods",
  amount = 250000,
  requirementKind = null,
  compliance = {},
  lines = [{ description: "fixture evidence" }],
}) {
  await db.exec(`
    insert into procurement.requests(
      id, status, estimated_amount, requirement_kind, sourcing_method, category, lines,
      compliance, requester_id
    ) values (
      '${id}', 'draft', ${amount}, ${requirementKind ? `'${requirementKind}'` : "null"},
      '${sourcingMethod}', '${category}', ${sqlJson(lines)}, ${sqlJson(compliance)}, '${actorId}'
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

    const exceptions = [
      {
        id: "30000000-0000-0000-0000-000000000002",
        mode: "sole_source",
        amount: 5000,
        expected: /approved_exception_evidence/,
      },
      {
        id: "30000000-0000-0000-0000-000000000003",
        mode: "sole_source",
        amount: 5000,
        exceptionType: "sole_supplier",
        expected: "confirmed",
      },
      {
        id: "30000000-0000-0000-0000-000000000004",
        mode: "repeat_order",
        amount: 250001,
        exceptionType: "repeat_continuity",
        expected: /repeat_order_amount_exceeds_policy/,
      },
      {
        id: "30000000-0000-0000-0000-000000000007",
        mode: "repeat_order",
        amount: 250000,
        exceptionType: "repeat_continuity",
        expected: "confirmed",
      },
      {
        id: "30000000-0000-0000-0000-000000000005",
        mode: "petty_cash",
        amount: 2001,
        exceptionType: "petty_cash_non_accredited",
        expected: /petty_cash_amount_exceeds_policy/,
      },
      {
        id: "30000000-0000-0000-0000-000000000008",
        mode: "petty_cash",
        amount: 2000,
        exceptionType: "petty_cash_non_accredited",
        expected: "confirmed",
      },
      {
        id: "30000000-0000-0000-0000-000000000006",
        mode: "emergency_purchase",
        amount: 5000,
        exceptionType: "emergency",
        expected: "confirmed",
      },
    ];
    for (const scenario of exceptions) {
      await insertRequest(db, {
        id: scenario.id,
        requirementKind: "materials",
        amount: scenario.amount,
      });
      if (scenario.exceptionType) {
        await db.exec(`
          insert into procurement.exception_packs(request_id, exception_type, status)
          values ('${scenario.id}', '${scenario.exceptionType}', 'approved')
        `);
      }
      const confirmation = sqlJson({
        request_id: scenario.id,
        expected_route_version: 0,
        requested_mode: scenario.mode,
      });
      if (scenario.expected instanceof RegExp) {
        await assert.rejects(
          () => db.query(`select procurement.confirm_route_decision(${confirmation})`),
          scenario.expected,
          `${scenario.mode} must enforce its public evidence or amount gate`,
        );
      } else {
        const result = await db.query(`select procurement.confirm_route_decision(${confirmation}) as decision`);
        assert.equal(result.rows[0].decision.status, scenario.expected);
      }
    }
  } finally {
    await db.close();
  }
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
      create function private.policy_submit_procurement_request(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function procurement.create_request(jsonb) returns jsonb language sql as $$ select $1 $$;
      create table core.profiles (id uuid primary key, status text not null default 'active');
      create table core.vendors (id uuid primary key);
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
        requester_id uuid,
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
        status text not null default 'draft'
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
