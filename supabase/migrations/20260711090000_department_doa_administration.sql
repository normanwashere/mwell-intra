-- Department-scoped Delegation of Authority administration.

alter table procurement.doa_matrices
  add column if not exists department text,
  add column if not exists status text not null default 'draft',
  add column if not exists created_by uuid references core.profiles(id) on delete restrict,
  add column if not exists activated_by uuid references core.profiles(id) on delete restrict,
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update procurement.doa_matrices
set department = 'Unassigned'
where department is null;

alter table procurement.doa_matrices
  alter column department set not null,
  add constraint doa_matrix_status_check
    check (status in ('draft','active','superseded','expired'));

alter table procurement.doa_assignments
  alter column department drop not null;

update procurement.doa_assignments a
set department = m.department
from procurement.doa_matrices m
where a.matrix_id=m.id and a.department is null;

alter table procurement.doa_assignments
  alter column department set not null;

create unique index if not exists doa_one_active_matrix_per_department
  on procurement.doa_matrices (lower(department))
  where active;
create index if not exists doa_assignments_matrix_lookup
  on procurement.doa_assignments (matrix_id, tier, min_amount, max_amount, category)
  where active;

insert into core.capabilities(module, cap)
values ('legal','manage_doa')
on conflict (module, cap) do nothing;

insert into core.role_capabilities(module, role, cap)
values ('legal','admin','manage_doa')
on conflict do nothing;

create or replace function private.policy_can_manage_doa()
returns boolean language sql stable security definer set search_path = ''
as $$
  select core.has_cap('core','manage_rbac') or core.has_cap('legal','manage_doa')
$$;

create or replace function private.policy_save_doa_matrix(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_matrix procurement.doa_matrices;
  v_id uuid;
  v_department text := nullif(btrim(payload->>'department'),'');
  v_assignments jsonb := coalesce(payload->'assignments','[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.policy_can_manage_doa() then raise exception 'Not authorized to manage DOA'; end if;
  if v_department is null then raise exception 'Department is required'; end if;
  if nullif(btrim(payload->>'version'),'') is null then raise exception 'Version is required'; end if;
  if jsonb_typeof(v_assignments) <> 'array' then raise exception 'Assignments must be an array'; end if;

  v_id := nullif(payload->>'id','')::uuid;
  if v_id is null then
    insert into procurement.doa_matrices(
      version, department, source_document, approved_by_name, approved_at,
      effective_at, expires_at, active, status, created_by
    ) values (
      btrim(payload->>'version'), v_department,
      coalesce(nullif(btrim(payload->>'source_document'),''),'Configured in Mwell Intra'),
      'Pending activation', now(), coalesce((payload->>'effective_at')::timestamptz, now()),
      nullif(payload->>'expires_at','')::timestamptz, false, 'draft', auth.uid()
    ) returning * into v_matrix;
  else
    select * into v_matrix from procurement.doa_matrices where id=v_id for update;
    if v_matrix.id is null then raise exception 'DOA matrix not found'; end if;
    if v_matrix.status <> 'draft' then raise exception 'Activated DOA matrices are immutable; create a revision'; end if;
    update procurement.doa_matrices set
      version=btrim(payload->>'version'), department=v_department,
      source_document=coalesce(nullif(btrim(payload->>'source_document'),''),source_document),
      effective_at=coalesce((payload->>'effective_at')::timestamptz,effective_at),
      expires_at=nullif(payload->>'expires_at','')::timestamptz, updated_at=now()
    where id=v_id returning * into v_matrix;
    delete from procurement.doa_assignments where matrix_id=v_id;
  end if;

  insert into procurement.doa_assignments(
    matrix_id, department, category, min_amount, max_amount, tier, approver_user_id, active
  )
  select v_matrix.id, v_department, nullif(btrim(a.category),''), a.min_amount,
    a.max_amount, a.tier, a.approver_user_id, true
  from jsonb_to_recordset(v_assignments) as a(
    category text, min_amount numeric, max_amount numeric, tier text, approver_user_id uuid
  );

  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('procurement','doa_matrix',v_matrix.id::text,'doa_matrix_saved',auth.uid(),
    jsonb_build_object('department',v_department,'version',v_matrix.version));
  return to_jsonb(v_matrix);
end;
$$;

create or replace function private.policy_activate_doa_matrix(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_matrix procurement.doa_matrices;
  v_actor_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.policy_can_manage_doa() then raise exception 'Not authorized to manage DOA'; end if;
  select * into v_matrix from procurement.doa_matrices where id=(payload->>'id')::uuid for update;
  if v_matrix.id is null then raise exception 'DOA matrix not found'; end if;
  if v_matrix.status <> 'draft' then raise exception 'Only draft matrices can be activated'; end if;
  if not exists (select 1 from procurement.doa_assignments where matrix_id=v_matrix.id and active) then
    raise exception 'At least one assignment is required';
  end if;
  if not exists (select 1 from procurement.doa_assignments where matrix_id=v_matrix.id and active and tier='final_approver') then
    raise exception 'At least one final approver assignment is required';
  end if;
  if exists (
    select 1 from procurement.doa_assignments a
    join core.profiles p on p.id=a.approver_user_id
    where a.matrix_id=v_matrix.id and a.active and (p.kind <> 'employee' or p.status <> 'active')
  ) then raise exception 'Every approver must be an active employee'; end if;
  if exists (
    select 1 from procurement.doa_assignments a
    join procurement.doa_assignments b on b.matrix_id=a.matrix_id and b.id>a.id
      and b.tier=a.tier and coalesce(b.category,'')=coalesce(a.category,'')
      and numrange(b.min_amount, b.max_amount, '[]') && numrange(a.min_amount, a.max_amount, '[]')
    where a.matrix_id=v_matrix.id and a.active and b.active
  ) then raise exception 'Assignment amount bands overlap for the same tier and category'; end if;

  update procurement.doa_matrices set active=false, status='superseded', updated_at=now()
  where lower(department)=lower(v_matrix.department) and active and id<>v_matrix.id;
  select coalesce(full_name,email) into v_actor_name from core.profiles where id=auth.uid();
  update procurement.doa_matrices set active=true, status='active', activated_by=auth.uid(),
    activated_at=now(), approved_by_name=coalesce(v_actor_name,'Authorized administrator'),
    approved_at=now(), updated_at=now()
  where id=v_matrix.id returning * into v_matrix;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('procurement','doa_matrix',v_matrix.id::text,'doa_matrix_activated',auth.uid(),
    jsonb_build_object('department',v_matrix.department,'version',v_matrix.version));
  return to_jsonb(v_matrix);
end;
$$;

create or replace function procurement.save_doa_matrix(payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.policy_save_doa_matrix(payload) $$;
create or replace function procurement.activate_doa_matrix(payload jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.policy_activate_doa_matrix(payload) $$;

revoke all on function private.policy_can_manage_doa() from public, anon, authenticated;
revoke all on function private.policy_save_doa_matrix(jsonb) from public, anon, authenticated;
revoke all on function private.policy_activate_doa_matrix(jsonb) from public, anon, authenticated;
revoke all on function procurement.save_doa_matrix(jsonb) from public, anon;
revoke all on function procurement.activate_doa_matrix(jsonb) from public, anon;
grant execute on function procurement.save_doa_matrix(jsonb) to authenticated, service_role;
grant execute on function procurement.activate_doa_matrix(jsonb) to authenticated, service_role;

-- The base submission function uses exact department matching:
-- from procurement.doa_matrices m where m.department = v_request.department
