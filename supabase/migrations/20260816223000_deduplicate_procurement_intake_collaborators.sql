-- A user can hold more than one Procurement role. Collapse intake and
-- approval collaborators before the unique-key upsert so one multi-role user
-- cannot make request creation or submission fail atomically.

create or replace function procurement.create_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_request_id text;
begin
  if auth.uid() is null then
    raise exception 'An attributable requester is required';
  end if;
  if not core.has_live_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  perform private.assert_minimum_request_contract(payload);
  v_result := procurement.create_request_pre_requester_privacy(payload);
  v_request_id := v_result->>'id';
  insert into procurement.request_collaborators(
    request_id,
    user_id,
    access_level,
    reason,
    granted_by
  )
  select distinct
    v_request_id,
    role.user_id,
    'manage',
    'system_intake_assignment',
    auth.uid()
  from core.user_roles as role
  join core.profiles as profile
    on profile.id = role.user_id
   and profile.status = 'active'
  where role.module = 'procurement'
    and role.role in ('procurement_officer', 'admin')
    and role.user_id <> auth.uid()
  on conflict(request_id, user_id) do update set
    access_level = excluded.access_level,
    reason = excluded.reason,
    granted_by = excluded.granted_by,
    granted_at = now(),
    revoked_by = null,
    revoked_at = null;
  return v_result;
end;
$$;

create or replace function procurement.submit_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'An attributable requester is required';
  end if;
  if not core.has_live_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  select *
    into v_request
  from procurement.requests
  where id = payload->>'id'
  for update;
  if not found then
    raise exception 'Request not found';
  end if;
  perform private.assert_minimum_request_contract(to_jsonb(v_request));
  v_result := procurement.submit_request_pre_requester_privacy(payload);
  insert into procurement.request_collaborators(
    request_id,
    user_id,
    access_level,
    reason,
    granted_by
  )
  select distinct
    v_request.id,
    step.assigned_user_id,
    'approve',
    'approval_assignment',
    auth.uid()
  from procurement.approval_steps as step
  where step.request_id = v_request.id
    and step.assigned_user_id is not null
  on conflict(request_id, user_id) do update set
    access_level = excluded.access_level,
    reason = excluded.reason,
    granted_by = excluded.granted_by,
    granted_at = now(),
    revoked_by = null,
    revoked_at = null;
  return v_result;
end;
$$;

alter function procurement.create_request(jsonb) owner to postgres;
alter function procurement.submit_request(jsonb) owner to postgres;
revoke all on function procurement.create_request(jsonb) from public, anon;
revoke all on function procurement.submit_request(jsonb) from public, anon;
grant execute on function procurement.create_request(jsonb)
  to authenticated, service_role;
grant execute on function procurement.submit_request(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
