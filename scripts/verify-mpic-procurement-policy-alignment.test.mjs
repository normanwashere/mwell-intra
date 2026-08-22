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

test("requires profile, route, RLS, and hardened RPC controls", () => {
  const result = verifyMigrationText("");

  assert.ok(result.failures.includes("missing procurement.policy_profiles"));
  assert.ok(result.failures.includes("missing solicitation_type"));
  assert.ok(result.failures.includes("missing empty search_path"));
  assert.ok(result.failures.includes("missing governed activation locking"));
  assert.ok(result.failures.includes("missing governed write RLS policy"));
});

test("requires every governed policy RPC to carry the hardened function contract", () => {
  const result = verifyMigrationText(`
    create function procurement.save_policy_profile(payload jsonb) returns jsonb language plpgsql as $$ begin return payload; end $$;
    create function procurement.activate_policy_profile(payload jsonb) returns jsonb language plpgsql as $$ begin return payload; end $$;
    create function procurement.resolve_policy_conflict(payload jsonb) returns jsonb language plpgsql as $$ begin return payload; end $$;
    create function procurement.get_effective_policy_profile(as_of timestamptz) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end $$;
  `);

  assert.ok(result.failures.includes("missing hardened policy RPC"));
});

test("accepts a migration with the mandatory policy governance controls", () => {
  const result = verifyMigrationText(`
    create table if not exists procurement.policy_profiles (
      id uuid primary key,
      formal_bid_amount numeric,
      control_sources jsonb,
      source_filename text,
      source_organization text,
      effective_from timestamptz,
      effective_to timestamptz,
      document_hash text,
      exclude using gist (tstzrange(effective_from, effective_to, '[)') with &&)
    );
    create table if not exists procurement.policy_profile_events (id uuid primary key);
    create table if not exists procurement.policy_conflicts (id uuid primary key);
    create table if not exists procurement.solicitation_communications (id uuid primary key);
    create table if not exists procurement.policy_sla_events (id uuid primary key);
    create table if not exists legal.vendor_probation_reviews (id uuid primary key);
    alter table procurement.policy_profiles enable row level security;
    alter table procurement.policy_profiles force row level security;
    alter table procurement.policy_profile_events enable row level security;
    alter table procurement.policy_profile_events force row level security;
    alter table procurement.policy_conflicts enable row level security;
    alter table procurement.policy_conflicts force row level security;
    alter table procurement.solicitation_communications enable row level security;
    alter table procurement.solicitation_communications force row level security;
    alter table procurement.policy_sla_events enable row level security;
    alter table procurement.policy_sla_events force row level security;
    alter table legal.vendor_probation_reviews enable row level security;
    alter table legal.vendor_probation_reviews force row level security;
    create policy policy_profiles_governed_insert on procurement.policy_profiles for insert to authenticated with check (true);
    create policy policy_profiles_governed_update on procurement.policy_profiles for update to authenticated using (true) with check (true);
    create policy policy_profile_events_governed_insert on procurement.policy_profile_events for insert to authenticated with check (true);
    create policy policy_conflicts_governed_update on procurement.policy_conflicts for update to authenticated using (true) with check (true);
    alter table procurement.requests add column requirement_kind text;
    alter table procurement.requests add column solicitation_type text;
    alter table procurement.requests add column procurement_mode text;
    alter table procurement.requests add column governance_tier text;
    alter table procurement.requests add column policy_profile_id uuid references procurement.policy_profiles(id);
    alter table procurement.requests add column route_reasons jsonb;
    create function procurement.save_policy_profile(payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if core.has_live_cap('core', 'manage_rbac') or core.has_live_cap('legal', 'manage_doa') then return payload; end if; end $$;
    create function procurement.activate_policy_profile(payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin -- unresolved conflicts block activation
      perform 1 from procurement.policy_profiles for update; return payload; end $$;
    create function procurement.resolve_policy_conflict(payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin if created_by is not distinct from v_actor then return payload; end if; return payload; end $$;
    create function procurement.get_effective_policy_profile(as_of timestamptz) returns jsonb language sql security definer set search_path = '' as $$ select '{}'::jsonb $$;
    -- policy profile events are immutable
    revoke all on function procurement.save_policy_profile(jsonb) from public, anon, authenticated;
    revoke all on function procurement.activate_policy_profile(jsonb) from public, anon, authenticated;
    revoke all on function procurement.resolve_policy_conflict(jsonb) from public, anon, authenticated;
    revoke all on function procurement.get_effective_policy_profile(timestamptz) from public, anon, authenticated;
    grant execute on function procurement.save_policy_profile(jsonb), procurement.activate_policy_profile(jsonb), procurement.resolve_policy_conflict(jsonb), procurement.get_effective_policy_profile(timestamptz) to authenticated, service_role;
  `);

  assert.deepEqual(result.failures, []);
});

test("loads against the governed procurement schema without a live database", async () => {
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
