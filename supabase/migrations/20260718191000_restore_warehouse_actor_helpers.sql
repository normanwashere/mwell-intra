-- Forward convergence for environments that were versioned before Warehouse
-- actor stamping helpers were installed.
create or replace function warehouse.authoritative_actor()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif((select profile.email from core.profiles profile where profile.id=auth.uid()),''),
    auth.uid()::text
  );
$$;
revoke all on function warehouse.authoritative_actor() from public,anon,authenticated;

create or replace function warehouse.force_actor_on_array(p_arr jsonb,p_actor text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_arr)='array' then coalesce(
      (
        select jsonb_agg(element||jsonb_build_object('actor',p_actor))
        from jsonb_array_elements(p_arr) element
      ),
      '[]'::jsonb
    )
    else p_arr
  end;
$$;
revoke all on function warehouse.force_actor_on_array(jsonb,text) from public,anon,authenticated;

create or replace function warehouse.force_actor_on_object(p_obj jsonb,p_actor text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_obj)='object'
      then p_obj||jsonb_build_object('actor',p_actor)
    else p_obj
  end;
$$;
revoke all on function warehouse.force_actor_on_object(jsonb,text) from public,anon,authenticated;
