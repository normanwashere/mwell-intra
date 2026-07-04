-- Mwell Intra — core schema + identity (Step 1e)
--
-- Establishes the shared `core` schema (spec §3/§4) that every module reuses:
-- identity/profiles, RBAC, vendor master, documents, approvals, activity log and
-- notifications. This first migration creates the schema and the identity table
-- (`core.profiles`). It mirrors the warehouse conventions in docs/LLD.md §11:
-- dedicated schema (never `public`), snake_case columns, RLS enabled on every
-- table, and writes gated behind SECURITY DEFINER RPCs (added in later
-- migrations). Everything here is idempotent / forward-only (spec §6.8):
-- create-if-not-exists tables + guarded constraints, safe to re-run.
--
-- Migration order (spec §6.8: `core` migrates first):
--   1. 20260706090000_core_schema_identity   <- this file
--   2. 20260706090100_core_rbac
--   3. 20260706090200_core_vendors
--   4. 20260706090300_core_documents
--   5. 20260706090400_core_approvals
--   6. 20260706090500_core_activity_log
--   7. 20260706090600_core_notifications
--   8. 20260706090700_core_rls_policies
--   9. 20260706090800_core_rpcs
--  10. 20260706090900_core_expose_postgrest
--  11. 20260706091000_core_seed_rbac

create extension if not exists "pgcrypto";

-- Shared foundation schema. Domain schemas (warehouse/procurement/legal) live
-- alongside it and reference core IDs (spec §3).
create schema if not exists core;

-- ---------------------------------------------------------------------------
-- Identity: one row per internal employee OR external vendor contact (spec §4.1)
--   * id = auth.users.id (Supabase Auth is the identity provider, spec §5).
--   * kind='vendor' rows are the EXTERNAL tier — their RLS is scoped to their
--     own vendor_id only (spec §5, ADR-002 #3). vendor_id is wired to
--     core.vendors by a guarded FK in the vendors migration (created later).
-- ---------------------------------------------------------------------------
create table if not exists core.profiles (
  id          uuid primary key default gen_random_uuid(),  -- = auth.users.id
  email       text not null unique,
  full_name   text,
  title       text,
  kind        text not null default 'employee',            -- 'employee' | 'vendor'
  vendor_id   uuid,                                         -- set when kind='vendor'
  status      text not null default 'active',               -- 'active' | 'disabled'
  created_at  timestamptz not null default now()
);

create index if not exists profiles_kind_idx on core.profiles (kind);
create index if not exists profiles_vendor_idx on core.profiles (vendor_id);

-- Tie the profile to the verified auth user. Guarded so re-runs don't fail.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_auth_user_fk') then
    alter table core.profiles
      add constraint profiles_auth_user_fk foreign key (id)
      references auth.users(id) on delete cascade;
  end if;
end $$;

alter table core.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- Grants — the `core` schema is for authenticated internal + vendor sessions.
--   * anon gets NOTHING (login uses Supabase Auth; no anonymous core reads).
--   * authenticated gets SELECT only; INSERT/UPDATE/DELETE are revoked in the
--     RLS migration so every write goes through a capability-gated RPC (spec §6).
--   * service_role keeps full access for seeding / scheduled jobs / recovery.
-- ---------------------------------------------------------------------------
grant usage on schema core to authenticated, service_role;
grant select on core.profiles to authenticated;
grant all on core.profiles to service_role;
alter default privileges in schema core grant select on tables to authenticated;
alter default privileges in schema core grant all on tables to service_role;
