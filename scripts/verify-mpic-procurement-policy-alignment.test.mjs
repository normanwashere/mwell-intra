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
      create table core.profiles (id uuid primary key, status text not null default 'active');
      create table core.vendors (id uuid primary key);
      create table procurement.requests (id uuid primary key, status text);
    `);

    await db.exec(migration);
  } finally {
    await db.close();
  }
});
