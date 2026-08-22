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
