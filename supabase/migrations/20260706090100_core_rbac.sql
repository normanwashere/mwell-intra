-- Mwell Intra — core RBAC (scoped, multi-role) + security-definer helpers
--
-- Implements the scoped RBAC model from spec §4.2: capabilities are per module,
-- roles are per module, and a user can hold DIFFERENT roles per module
-- (core.user_roles). This generalizes the warehouse single-role `has_cap` in
-- docs/LLD.md §9/§11.2 into a (module, cap) check.
--
-- The catalogue tables (capabilities/roles/role_capabilities) are internal to
-- the policy layer: RLS on, NO API grants — only the SECURITY DEFINER helpers
-- below read them (exactly the warehouse role_capabilities lockdown pattern).
--
-- IMPORTANT (spec §6.6): the RBAC matrix is DEFINED ONCE in the `@intra/rbac`
-- package (Step 1b) and MIRRORED here in core.role_capabilities. The seed lives
-- in 20260706091000_core_seed_rbac.sql — keep the two in sync.
--
-- Re-runnable: create table if not exists + create-or-replace functions.

-- ---------------------------------------------------------------------------
-- Catalogue: capabilities + roles are per module (spec §4.2)
-- ---------------------------------------------------------------------------
create table if not exists core.capabilities (
  module text not null,          -- 'core' | 'warehouse' | 'procurement' | 'legal'
  cap    text not null,          -- e.g. 'receive_stock', 'approve_award', 'review_accreditation'
  primary key (module, cap)
);

create table if not exists core.roles (
  module text not null,
  role   text not null,          -- e.g. 'logistics_supervisor', 'approver', 'legal_reviewer'
  label  text not null,
  primary key (module, role)
);

-- Mirrors @intra/rbac ROLES matrices; locked down (no API grants).
create table if not exists core.role_capabilities (
  module text not null,
  role   text not null,
  cap    text not null,
  primary key (module, role, cap)
);

-- A user can hold different roles per module (spec §4.2/§5).
create table if not exists core.user_roles (
  user_id uuid not null,
  module  text not null,
  role    text not null,
  primary key (user_id, module, role)
);

create index if not exists user_roles_user_idx on core.user_roles (user_id);
create index if not exists role_capabilities_cap_idx on core.role_capabilities (cap);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_roles_profile_fk') then
    alter table core.user_roles
      add constraint user_roles_profile_fk foreign key (user_id)
      references core.profiles(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lockdown of the catalogue tables: RLS on, no policies, no API-role grants.
-- The security-definer helpers below are the ONLY readers (warehouse pattern).
-- ---------------------------------------------------------------------------
alter table core.capabilities enable row level security;
alter table core.roles enable row level security;
alter table core.role_capabilities enable row level security;
alter table core.user_roles enable row level security;

revoke all on core.capabilities from anon, authenticated;
revoke all on core.roles from anon, authenticated;
revoke all on core.role_capabilities from anon, authenticated;

-- user_roles is readable (self) by the client for fast UX gating; writes are
-- revoked in the RLS migration (assignment happens via RPC). The SELECT policy
-- is created in 20260706090700_core_rls_policies.sql.
grant select on core.user_roles to authenticated;
grant all on core.user_roles to service_role;

-- ---------------------------------------------------------------------------
-- JWT helpers — the JWT carries a fast snapshot of the user's scoped roles for
-- client gating (spec §5). These read the *unverified-in-SQL* GUC populated
-- from the verified JWT; the AUTHORITATIVE check is always core.has_cap()
-- reading core.user_roles server-side (spec §5).
-- ---------------------------------------------------------------------------

-- Returns app_metadata.roles, e.g. {"warehouse":["logistics_supervisor"], ...}
create or replace function core.jwt_role_claims()
returns jsonb
language sql
stable
set search_path = core, public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' -> 'roles',
    '{}'::jsonb
  );
$$;

-- Returns app_metadata.kind ('employee' | 'vendor') from the verified JWT.
create or replace function core.jwt_kind()
returns text
language sql
stable
set search_path = core, public
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'kind',
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- Authoritative capability check (spec §4.2) — reads core.user_roles +
-- core.role_capabilities for auth.uid(). SECURITY DEFINER so it can read the
-- locked-down catalogue without exposing it to API roles.
-- ---------------------------------------------------------------------------
create or replace function core.has_cap(p_module text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.role_capabilities rc
      on rc.module = ur.module and rc.role = ur.role
    where ur.user_id = auth.uid()
      and ur.module = p_module
      and rc.cap = p_cap
  );
$$;

-- Cross-module form: true when the user holds `p_cap` in ANY module. Used to
-- gate the CROSS-CUTTING `core` resources (vendor master, documents, approvals,
-- audit) that several modules legitimately consume — a procurement approver and
-- a legal reviewer both need to read the vendor master, so the gate can't be
-- pinned to a single module. Module-specific gates use core.has_cap(module,cap).
create or replace function core.has_any_cap(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select exists (
    select 1
    from core.user_roles ur
    join core.role_capabilities rc
      on rc.module = ur.module and rc.role = ur.role
    where ur.user_id = auth.uid()
      and rc.cap = p_cap
  );
$$;

-- Identity helpers for vendor-tier RLS (spec §5). SECURITY DEFINER so RLS
-- policies can consult core.profiles without recursing through its own policy.
create or replace function core.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = core, public
as $$
  select vendor_id from core.profiles where id = auth.uid();
$$;

create or replace function core.is_vendor()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce((select kind = 'vendor' from core.profiles where id = auth.uid()), false);
$$;

-- Helper grants: never anon; authenticated + service_role may execute.
do $$
declare fn text;
begin
  foreach fn in array array[
    'jwt_role_claims()', 'jwt_kind()', 'has_cap(text, text)', 'has_any_cap(text)',
    'current_vendor_id()', 'is_vendor()'
  ]
  loop
    execute format('revoke all on function core.%s from public, anon;', fn);
    execute format('grant execute on function core.%s to authenticated, service_role;', fn);
  end loop;
end $$;
