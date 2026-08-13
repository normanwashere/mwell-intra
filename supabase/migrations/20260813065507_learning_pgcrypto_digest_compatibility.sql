-- Preserve pinned learning-service bodies when pgcrypto is installed in the
-- Supabase-managed extensions schema instead of public.
create or replace function public.digest(data bytea, algorithm text)
returns bytea
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.digest(data, algorithm)
$$;

alter function public.digest(bytea, text) owner to postgres;
revoke all on function public.digest(bytea, text)
  from public, anon, authenticated, service_role;
