-- CI-only, empty legacy dependencies, not an application migration or baseline.
-- Source: read-only UAT catalog review, kkoitlvydytdhlpxhuah, 2026-11-05.
-- The historical July 8/22 grants assume this pre-repository helper exists.
-- Preserve its actual caller-bound query; never replace it with a role constant.
-- No profile data, policies, Learning objects or current capabilities are seeded.
create schema private;
create type public.app_role as enum (
  'guard', 'warehouse', 'packing', 'inventory', 'manager', 'finance', 'admin',
  'logistics-supervisor', 'warehouse-supervisor', 'operations-user',
  'operations-manager', 'finance-manager', 'bi-analyst', 'business-unit-manager',
  'marketing-manager', 'procurement-consultant', 'pricing-consultant'
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated, service_role;
create function private.current_app_role()
returns public.app_role language sql stable security definer set search_path = 'public'
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function private.current_app_role() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.current_app_role() to authenticated;
