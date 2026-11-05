-- Capability lookup + JWT helpers backing the role-aware RLS policies.
-- Mirrors src/auth/roles.ts ROLES exactly. Re-runnable: the seed is rebuilt.

create table if not exists warehouse.role_capabilities (
  role text not null,
  capability text not null,
  primary key (role, capability)
);

-- This table is internal to the policy layer. Lock it down: RLS on, no policies,
-- and no API-role grants. The security-definer helpers below read it instead.
alter table warehouse.role_capabilities enable row level security;
revoke all on warehouse.role_capabilities from anon, authenticated;

-- Rebuild the seed so it always matches roles.ts.
delete from warehouse.role_capabilities;
insert into warehouse.role_capabilities (role, capability) values
  ('logistics_supervisor','view_dashboard'),
  ('logistics_supervisor','manage_inventory'),
  ('logistics_supervisor','receive_stock'),
  ('logistics_supervisor','manage_products'),
  ('logistics_supervisor','cycle_count'),
  ('logistics_supervisor','manage_returns'),
  ('logistics_supervisor','issue_items'),
  ('logistics_supervisor','transfer_stock'),
  ('operations','view_dashboard'),
  ('operations','manage_inventory'),
  ('operations','reserve_allocate'),
  ('operations','issue_items'),
  ('operations','manage_returns'),
  ('operations','transfer_stock'),
  ('finance','view_dashboard'),
  ('finance','manage_inventory'),
  ('finance','view_finance'),
  ('finance','cycle_count'),
  ('bi_analyst','view_dashboard'),
  ('bi_analyst','manage_inventory'),
  ('bi_analyst','view_analytics'),
  ('business_unit','view_dashboard'),
  ('business_unit','manage_inventory'),
  ('business_unit','reserve_allocate'),
  ('marketing','view_dashboard'),
  ('marketing','manage_inventory'),
  ('marketing','reserve_allocate'),
  ('marketing','manage_returns'),
  ('procurement','view_dashboard'),
  ('procurement','manage_inventory'),
  ('procurement','view_procurement'),
  ('procurement','manage_products'),
  ('pricing','view_dashboard'),
  ('pricing','manage_inventory'),
  ('pricing','view_pricing'),
  ('pricing','set_pricing'),
  ('pricing','view_finance');

-- Role carried by the authenticated user, read ONLY from the trusted
-- app_metadata claim of the verified JWT.
create or replace function warehouse.jwt_role()
returns text
language sql
stable
security definer
set search_path = warehouse, public
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role',
    ''
  );
$$;

-- True when the JWT role holds the given capability. Security definer so it can
-- read the locked-down lookup table without exposing it to API roles.
create or replace function warehouse.has_cap(cap text)
returns boolean
language sql
stable
security definer
set search_path = warehouse, public
as $$
  select exists (
    select 1 from warehouse.role_capabilities rc
    where rc.role = warehouse.jwt_role() and rc.capability = cap
  );
$$;

-- Helpers are needed inside policies evaluated as `authenticated`; expose execute
-- only to authenticated (never anon/public).
revoke all on function warehouse.jwt_role() from public, anon;
revoke all on function warehouse.has_cap(text) from public, anon;
grant execute on function warehouse.jwt_role() to authenticated;
grant execute on function warehouse.has_cap(text) to authenticated;
