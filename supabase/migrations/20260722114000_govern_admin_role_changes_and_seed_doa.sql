-- Govern privileged role changes and establish editable UAT DOA baselines.

create table if not exists core.role_change_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles(id) on delete restrict,
  module text not null,
  role text not null,
  action text not null check (action in ('grant','revoke')),
  approval_reference text not null check (length(btrim(approval_reference)) >= 3),
  reason text not null check (length(btrim(reason)) >= 5),
  effective_at timestamptz not null,
  expires_at timestamptz,
  changed_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

create index if not exists role_change_evidence_user_idx
  on core.role_change_evidence(user_id, created_at desc);
create index if not exists role_change_evidence_actor_idx
  on core.role_change_evidence(changed_by, created_at desc);

alter table core.role_change_evidence enable row level security;
revoke all on core.role_change_evidence from public, anon, authenticated;
grant select on core.role_change_evidence to authenticated;
grant all on core.role_change_evidence to service_role;

drop policy if exists role_change_evidence_read on core.role_change_evidence;
create policy role_change_evidence_read on core.role_change_evidence
for select to authenticated
using (
  core.has_cap('core','manage_rbac')
  or core.has_cap('core','view_audit')
  or user_id = auth.uid()
);

create or replace function core.assign_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_approval_reference text := nullif(btrim(payload->>'approval_reference'),'');
  v_reason text := nullif(btrim(payload->>'reason'),'');
  v_effective_at timestamptz := nullif(payload->>'effective_at','')::timestamptz;
  v_expires_at timestamptz := nullif(payload->>'expires_at','')::timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
  v_evidence_id uuid;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  if v_approval_reference is null then raise exception 'Approval reference is required'; end if;
  if v_reason is null then raise exception 'Business reason is required'; end if;
  if v_effective_at is null then raise exception 'Effective date is required'; end if;
  if v_effective_at > now() + interval '5 minutes' then
    raise exception 'Future grants require scheduled activation';
  end if;
  if v_expires_at is not null and v_expires_at <= greatest(v_effective_at, now()) then
    raise exception 'Expiry must be after the effective date';
  end if;
  perform core.lock_role_bundle_keys(v_module, v_role);
  if not exists (
    select 1 from core.roles
    where module = v_module and role = v_role and is_active
  ) then
    raise exception 'Unknown or inactive role %:%', v_module, v_role;
  end if;
  if not exists (select 1 from core.profiles where id = v_user_id) then
    raise exception 'Unknown profile %', v_user_id;
  end if;

  v_before := jsonb_build_object('assigned', exists(
    select 1 from core.user_roles
    where user_id = v_user_id and module = v_module and role = v_role
  ));
  insert into core.user_roles(user_id, module, role)
  values (v_user_id, v_module, v_role)
  on conflict do nothing;
  get diagnostics v_changed = row_count;
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', true
  );
  if v_changed = 0 then return v_after; end if;

  insert into core.role_change_evidence(
    user_id,module,role,action,approval_reference,reason,effective_at,expires_at,changed_by
  ) values (
    v_user_id,v_module,v_role,'grant',v_approval_reference,v_reason,
    v_effective_at,v_expires_at,auth.uid()
  ) returning id into v_evidence_id;

  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_granted', auth.uid(),
    jsonb_build_object(
      'before',v_before,'after',v_after,'evidence_id',v_evidence_id,
      'approval_reference',v_approval_reference,'reason',v_reason,
      'effective_at',v_effective_at,'expires_at',v_expires_at
    )
  );
  return v_after;
end;
$$;

create or replace function core.revoke_user_role(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_module text := payload->>'module';
  v_role text := payload->>'role';
  v_approval_reference text := nullif(btrim(payload->>'approval_reference'),'');
  v_reason text := nullif(btrim(payload->>'reason'),'');
  v_effective_at timestamptz := nullif(payload->>'effective_at','')::timestamptz;
  v_expires_at timestamptz := nullif(payload->>'expires_at','')::timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_changed integer;
  v_evidence_id uuid;
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_user_id = auth.uid() then
    raise exception 'Self-assignment is not allowed: cannot modify your own role assignment';
  end if;
  if v_approval_reference is null then raise exception 'Approval reference is required'; end if;
  if v_reason is null then raise exception 'Business reason is required'; end if;
  if v_effective_at is null then raise exception 'Effective date is required'; end if;

  perform core.lock_role_bundle_keys(v_module, v_role);
  v_before := jsonb_build_object('assigned', exists(
    select 1 from core.user_roles
    where user_id = v_user_id and module = v_module and role = v_role
  ));
  delete from core.user_roles
  where user_id = v_user_id and module = v_module and role = v_role;
  get diagnostics v_changed = row_count;
  v_after := jsonb_build_object(
    'user_id', v_user_id, 'module', v_module, 'role', v_role, 'assigned', false
  );
  if v_changed = 0 then return v_after; end if;

  insert into core.role_change_evidence(
    user_id,module,role,action,approval_reference,reason,effective_at,expires_at,changed_by
  ) values (
    v_user_id,v_module,v_role,'revoke',v_approval_reference,v_reason,
    v_effective_at,v_expires_at,auth.uid()
  ) returning id into v_evidence_id;

  perform core.sync_user_role_claims(v_user_id);
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'user_role', v_user_id::text, 'role_revoked', auth.uid(),
    jsonb_build_object(
      'before',v_before,'after',v_after,'evidence_id',v_evidence_id,
      'approval_reference',v_approval_reference,'reason',v_reason,
      'effective_at',v_effective_at
    )
  );
  return v_after;
end;
$$;

revoke all on function core.assign_user_role(jsonb) from public, anon;
revoke all on function core.revoke_user_role(jsonb) from public, anon;
grant execute on function core.assign_user_role(jsonb) to authenticated, service_role;
grant execute on function core.revoke_user_role(jsonb) to authenticated, service_role;

-- Editable temporary baselines. Admin or Legal can create a revision and
-- supersede these records in the existing DOA workspace.
with seeds(department, version, approver_email) as (
  values
    ('Operations','UAT-TEMP-OPS-1','intra.test.operations.lead@mwell.com.ph'),
    ('Procurement','UAT-TEMP-PROC-1','intra.test.procurement.lead@mwell.com.ph'),
    ('Marketing','UAT-TEMP-MKT-1','intra.test.marketing.events@mwell.com.ph'),
    ('Product','UAT-TEMP-PROD-1','intra.test.product.owner@mwell.com.ph'),
    ('Finance','UAT-TEMP-FIN-1','intra.test.finance@mwell.com.ph'),
    ('Legal','UAT-TEMP-LGL-1','intra.test.legal.lead@mwell.com.ph'),
    ('Technology','UAT-TEMP-TECH-1','intra.test.admin@mwell.com.ph'),
    ('Sales','UAT-TEMP-SALES-1','intra.test.admin@mwell.com.ph'),
    ('Project Management Office','UAT-TEMP-PMO-1','intra.test.admin@mwell.com.ph')
)
insert into procurement.doa_matrices(
  version,department,source_document,approved_by_name,approved_at,effective_at,
  active,status,created_by,activated_by,activated_at,updated_at
)
select
  s.version,s.department,'Temporary UAT baseline - replace with approved DOA',
  'Temporary UAT baseline',now(),now(),true,'active',p.id,p.id,now(),now()
from seeds s
join core.profiles p on lower(p.email)=lower(s.approver_email)
on conflict (version) do nothing;

with seeds(department, version, approver_email) as (
  values
    ('Operations','UAT-TEMP-OPS-1','intra.test.operations.lead@mwell.com.ph'),
    ('Procurement','UAT-TEMP-PROC-1','intra.test.procurement.lead@mwell.com.ph'),
    ('Marketing','UAT-TEMP-MKT-1','intra.test.marketing.events@mwell.com.ph'),
    ('Product','UAT-TEMP-PROD-1','intra.test.product.owner@mwell.com.ph'),
    ('Finance','UAT-TEMP-FIN-1','intra.test.finance@mwell.com.ph'),
    ('Legal','UAT-TEMP-LGL-1','intra.test.legal.lead@mwell.com.ph'),
    ('Technology','UAT-TEMP-TECH-1','intra.test.admin@mwell.com.ph'),
    ('Sales','UAT-TEMP-SALES-1','intra.test.admin@mwell.com.ph'),
    ('Project Management Office','UAT-TEMP-PMO-1','intra.test.admin@mwell.com.ph')
)
insert into procurement.doa_assignments(
  matrix_id,department,category,min_amount,max_amount,tier,approver_user_id,active
)
select m.id,s.department,null,0,null,'final_approver',p.id,true
from seeds s
join procurement.doa_matrices m on m.version=s.version
join core.profiles p on lower(p.email)=lower(s.approver_email)
where not exists (
  select 1 from procurement.doa_assignments a
  where a.matrix_id=m.id and a.tier='final_approver'
);
