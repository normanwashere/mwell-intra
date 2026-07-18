-- Trusted service-role readbacks need to traverse capability-filtered views.
create or replace function core.has_cap(p_module text, p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false) or exists (
    select 1
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    join core.role_capabilities rc
      on rc.module = ur.module
     and rc.role = ur.role
    where ur.user_id = auth.uid()
      and ur.module = p_module
      and rc.cap = p_cap
  );
$$;

-- These hardened functions run with an empty search path. Qualify pgcrypto and
-- pg_catalog calls so document hashing remains available in every environment.
do $$
declare
  target regprocedure;
  definition text;
  qualified_definition text;
begin
  foreach target in array array[
    'private.policy_record_acceptance_pack(jsonb)'::regprocedure,
    'private.policy_sign_instrument_compat(jsonb)'::regprocedure,
    'private.policy_submit_vendor_application(jsonb)'::regprocedure
  ] loop
    definition := pg_get_functiondef(target);
    if position('extensions.digest' in definition) > 0 then
      continue;
    end if;
    qualified_definition := replace(
      definition,
      'encode(digest(convert_to(',
      'pg_catalog.encode(extensions.digest(pg_catalog.convert_to('
    );
    if qualified_definition = definition then
      raise exception 'Unable to qualify digest in %', target;
    end if;
    execute qualified_definition;
  end loop;
end;
$$;
