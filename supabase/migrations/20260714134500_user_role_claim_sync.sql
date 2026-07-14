-- Keep authoritative role grants and the JWT app_metadata snapshot in sync.

create or replace function core.sync_user_role_claims(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = core, auth, public
as $$
declare v_roles jsonb;
begin
  select coalesce(jsonb_object_agg(module, roles order by module), '{}'::jsonb)
  into v_roles
  from (
    select module, jsonb_agg(role order by role) as roles
    from core.user_roles
    where user_id = target_user_id
    group by module
  ) grouped;

  update auth.users
  set raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb),
    '{roles}', v_roles, true
  )
  where id = target_user_id;

  return v_roles;
end;
$$;

revoke all on function core.sync_user_role_claims(uuid) from public, anon, authenticated;
grant execute on function core.sync_user_role_claims(uuid) to service_role;

create or replace function core.assign_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, auth, public
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
begin
  if not core.has_any_cap('manage_rbac') then
    raise exception 'Not authorized: manage_rbac';
  end if;
  if not exists (
    select 1 from core.roles r
    where r.module = v_module and r.role = v_role
  ) then
    raise exception 'Unknown role %/%', v_module, v_role;
  end if;
  if not exists (select 1 from core.profiles p where p.id = v_user_id) then
    raise exception 'Unknown profile %', v_user_id;
  end if;

  insert into core.user_roles(user_id, module, role)
  values (v_user_id, v_module, v_role)
  on conflict do nothing;
  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', v_user_id::text, 'role_granted', auth.uid(),
    jsonb_build_object('module', v_module, 'role', v_role));
  return jsonb_build_object('user_id', v_user_id, 'module', v_module, 'role', v_role);
end;
$$;

create or replace function core.revoke_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = core, auth, public
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
begin
  if not core.has_any_cap('manage_rbac') then
    raise exception 'Not authorized: manage_rbac';
  end if;
  delete from core.user_roles
  where user_id = v_user_id and module = v_module and role = v_role;
  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', v_user_id::text, 'role_revoked', auth.uid(),
    jsonb_build_object('module', v_module, 'role', v_role));
  return jsonb_build_object('ok', true, 'user_id', v_user_id, 'module', v_module, 'role', v_role);
end;
$$;

revoke all on function core.assign_user_role(jsonb) from public, anon;
revoke all on function core.revoke_user_role(jsonb) from public, anon;
grant execute on function core.assign_user_role(jsonb) to authenticated, service_role;
grant execute on function core.revoke_user_role(jsonb) to authenticated, service_role;
