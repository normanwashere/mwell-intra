-- Validate DOA assignments against the same current role tiers used at decision
-- time. Existing policies, assignments, decisions and learning stay unchanged.
create or replace function private.procurement_actor_has_current_tier(p_user_id uuid, p_tier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.user_roles assignment
    join core.profiles profile on profile.id=assignment.user_id and profile.status='active'
    join core.roles definition on definition.module=assignment.module and definition.role=assignment.role and definition.is_active
    join core.role_capabilities capability on capability.module=assignment.module and capability.role=assignment.role
    where assignment.user_id=p_user_id
      and assignment.module=case when p_tier='legal' then 'legal' else 'procurement' end
      and capability.cap=case when p_tier='legal' then 'review_accreditation' else 'approve_request' end
      and assignment.effective_at<=statement_timestamp()
      and (assignment.expires_at is null or assignment.expires_at>statement_timestamp())
      and (p_tier='legal' or assignment.role=any(case p_tier
        when 'dept_head' then array['approver']
        when 'procurement_head' then array['procurement_officer','admin']
        when 'finance' then array['finance']
        when 'final_approver' then array['admin']
        else array[]::text[] end))
  )
$$;
alter function private.procurement_actor_has_current_tier(uuid,text) owner to postgres;
revoke all on function private.procurement_actor_has_current_tier(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.has_current_procurement_tier(p_tier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.procurement_actor_has_current_tier(auth.uid(),p_tier)
$$;
revoke all on function private.has_current_procurement_tier(text) from public,anon,authenticated,service_role;

create or replace function procurement.request_decision_eligibility(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r procurement.requests; s procurement.approval_steps; permitted boolean := false;
begin
  select * into r from procurement.requests where id=payload->>'request_id';
  if auth.uid() is null or core.is_vendor() or r.id is null then
    return jsonb_build_object('canDecide',false,'reason','Request unavailable');
  end if;
  select * into s from procurement.approval_steps where request_id=r.id and status='pending' order by step_order limit 1;
  if r.requester_id=auth.uid() then
    return jsonb_build_object('canDecide',false,'reason','Requesters cannot decide their own request');
  end if;
  if s.id is null or r.status not in ('submitted','under_review') or s.assigned_user_id is distinct from auth.uid() then
    return jsonb_build_object('canDecide',false,'reason','Waiting on the assigned approver');
  end if;
  if not private.has_current_procurement_tier(s.tier) then
    return jsonb_build_object('canDecide',false,'stepId',s.id,'reasonCode','approval_role_required',
      'reason','Your account does not have the role needed for this assigned approval step. Ask the administrator or Legal team to review the approval assignment.');
  end if;
  permitted := case s.tier
    when 'legal' then core.has_live_cap('legal','review_accreditation')
    when 'dept_head' then core.has_live_cap('procurement','approve_request')
    when 'procurement_head' then core.has_live_cap('procurement','approve_request')
    when 'finance' then core.has_live_cap('procurement','approve_request')
    when 'final_approver' then core.has_live_cap('procurement','approve_request')
    else false end;
  return jsonb_build_object('canDecide',permitted,'stepId',s.id,
    'reasonCode',case when permitted then 'assigned_approver' else 'approval_training_required' end,
    'reason',case when permitted then 'Assigned to you' else 'Complete the required training for this approval role, then try again. If it is already complete, ask the administrator to check your current certification.' end);
end; $$;
revoke all on function procurement.request_decision_eligibility(jsonb) from public,anon,service_role;
grant execute on function procurement.request_decision_eligibility(jsonb) to authenticated;

-- The public wrapper still enforces current manage-DOA authority and a separate
-- checker. This private implementation rejects bad assignments before any policy
-- is superseded; it neither grants roles nor completes training.
create or replace function private.policy_activate_doa_matrix(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    left join core.profiles p on p.id=a.approver_user_id
    where a.matrix_id=v_matrix.id and a.active
      and (p.id is null or p.kind is distinct from 'employee' or p.status is distinct from 'active')
  ) then raise exception 'Every approver must be an active employee'; end if;
  if exists (
    select 1 from procurement.doa_assignments a
    where a.matrix_id=v_matrix.id and a.active
      and not private.procurement_actor_has_current_tier(a.approver_user_id,a.tier)
  ) then
    raise exception 'An assigned approver does not have the required role for their approval step. Ask the administrator or Legal team to correct the assignment before activating this policy.';
  end if;
  if exists (
    select 1 from procurement.doa_assignments a
    join procurement.doa_assignments b on b.matrix_id=a.matrix_id and b.id>a.id
      and b.tier=a.tier and coalesce(b.category,'')=coalesce(a.category,'')
      and numrange(b.min_amount,b.max_amount,'[]') && numrange(a.min_amount,a.max_amount,'[]')
    where a.matrix_id=v_matrix.id and a.active and b.active
  ) then raise exception 'Assignment amount bands overlap for the same tier and category'; end if;

  update procurement.doa_matrices set active=false,status='superseded',updated_at=now()
  where lower(department)=lower(v_matrix.department) and active and id<>v_matrix.id;
  select coalesce(full_name,email) into v_actor_name from core.profiles where id=auth.uid();
  update procurement.doa_matrices set active=true,status='active',activated_by=auth.uid(),
    activated_at=now(),approved_by_name=coalesce(v_actor_name,'Authorized administrator'),
    approved_at=now(),updated_at=now()
  where id=v_matrix.id returning * into v_matrix;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('procurement','doa_matrix',v_matrix.id::text,'doa_matrix_activated',auth.uid(),
    jsonb_build_object('department',v_matrix.department,'version',v_matrix.version));
  return to_jsonb(v_matrix);
end; $$;

notify pgrst, 'reload schema';
