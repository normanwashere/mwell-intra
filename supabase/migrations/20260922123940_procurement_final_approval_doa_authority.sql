-- Final authority belongs to the named, scoped DOA assignment, not an admin
-- role name. No policy, account, training or historical decision is rewritten.
create or replace function private.procurement_actor_has_current_tier(p_user_id uuid, p_tier text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from core.user_roles assignment
    join core.profiles profile on profile.id=assignment.user_id
      and profile.status='active' and profile.kind='employee'
    join core.roles definition on definition.module=assignment.module and definition.role=assignment.role and definition.is_active
    join core.role_capabilities capability on capability.module=assignment.module and capability.role=assignment.role
    where assignment.user_id=p_user_id
      and assignment.module=case when p_tier='legal' then 'legal' else 'procurement' end
      and capability.cap=case when p_tier='legal' then 'review_accreditation' else 'approve_request' end
      and assignment.effective_at<=statement_timestamp()
      and (assignment.expires_at is null or assignment.expires_at>statement_timestamp())
      and (p_tier in ('legal','final_approver') or assignment.role=any(case p_tier
        when 'dept_head' then array['approver']
        when 'procurement_head' then array['procurement_officer','admin']
        when 'finance' then array['finance']
        else array[]::text[] end))
  )
$$;
alter function private.procurement_actor_has_current_tier(uuid,text) owner to postgres;
revoke all on function private.procurement_actor_has_current_tier(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.procurement_final_doa_matches(p_request procurement.requests, p_step procurement.approval_steps)
returns boolean language sql stable security definer set search_path = '' as $$
  with current_matrices as (
    select m.id,m.version from procurement.doa_matrices m
    join core.departments d on d.code=m.department and d.is_active
    where m.department=p_request.department and m.active and m.status='active'
      and m.effective_at<=statement_timestamp()
      and (m.expires_at is null or m.expires_at>statement_timestamp())
  ), scoped_assignments as (
    select a.approver_user_id from procurement.doa_assignments a
    join current_matrices m on m.id=a.matrix_id
    where m.version=p_step.matrix_version
      and a.department=p_request.department and a.active and a.tier='final_approver'
      and (a.category is null or a.category=p_request.category)
      and a.min_amount::text not in ('NaN','Infinity','-Infinity')
      and (a.max_amount is null or a.max_amount::text not in ('NaN','Infinity','-Infinity'))
      and p_request.estimated_amount>=a.min_amount
      and (a.max_amount is null or p_request.estimated_amount<=a.max_amount)
  )
  select coalesce(
    p_step.request_id=p_request.id and p_step.tier='final_approver'
    and p_step.status='pending' and p_step.assigned_user_id=auth.uid()
    and p_request.requester_id<>auth.uid() and p_request.status in ('submitted','under_review')
    and p_request.estimated_amount>=0
    and p_request.estimated_amount::text not in ('NaN','Infinity','-Infinity')
    and (select count(*) from current_matrices)=1
    and (select count(*) from scoped_assignments)=1
    and exists (select 1 from scoped_assignments where approver_user_id=auth.uid()),false)
$$;
alter function private.procurement_final_doa_matches(procurement.requests,procurement.approval_steps) owner to postgres;
revoke all on function private.procurement_final_doa_matches(procurement.requests,procurement.approval_steps) from public,anon,authenticated,service_role;

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
      'reason','Your account does not have the approval permission needed for this step. Ask the administrator or Legal team to check your assigned role.');
  end if;
  if s.tier='final_approver' and not private.procurement_final_doa_matches(r,s) then
    return jsonb_build_object('canDecide',false,'stepId',s.id,'reasonCode','approval_doa_required',
      'reason','This request no longer matches one current approval policy for its department, category and amount. Ask Legal or the policy administrator to review the assigned approver and policy version. The request has not been changed.');
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
alter function procurement.request_decision_eligibility(jsonb) owner to postgres;
revoke all on function procurement.request_decision_eligibility(jsonb) from public,anon,service_role;
grant execute on function procurement.request_decision_eligibility(jsonb) to authenticated;

create or replace function procurement.decide_request_step_uncertified_impl(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_step procurement.approval_steps;
  v_req procurement.requests;
  v_request_id text := nullif(payload->>'request_id','');
  v_step_id text := nullif(payload->>'step_id','');
  v_decision text := nullif(payload->>'decision','');
  v_sig jsonb := payload->'signature';
  v_eligibility jsonb;
  v_decider_email text := auth.jwt()->>'email';
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if core.is_vendor() or not (core.has_cap('procurement','approve_request') or core.has_module_role('legal')) then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  if v_decision is null or v_decision not in ('approved','rejected') then
    raise exception 'decision must be approved or rejected';
  end if;
  if v_request_id is null and v_step_id is not null then
    select request_id into v_request_id from procurement.approval_steps where id=v_step_id;
  end if;
  if v_request_id is null then raise exception 'request_id or step_id is required'; end if;
  select * into v_req from procurement.requests where id=v_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status not in ('submitted','under_review') then
    raise exception 'Request % is not awaiting approval (status %)',v_req.id,v_req.status;
  end if;
  if v_req.requester_id=auth.uid() then raise exception 'Requesters cannot approve their own request'; end if;
  select * into v_step from procurement.approval_steps
    where request_id=v_req.id and status='pending' order by step_order limit 1 for update;
  if not found then raise exception 'No pending approval step for request %',v_req.id; end if;
  if v_step_id is not null and v_step.id<>v_step_id then
    raise exception 'Step % is not the next pending step for request %',v_step_id,v_req.id;
  end if;
  if nullif(payload->>'tier','') is not null and payload->>'tier'<>v_step.tier then
    raise exception 'Payload tier does not match the next pending tier %',v_step.tier;
  end if;
  if v_step.assigned_user_id is distinct from auth.uid() then
    raise exception 'The next pending step is assigned to a different approver';
  end if;
  if v_step.tier='final_approver' then
    -- Policy locks cannot refresh an earlier REPEATABLE READ/SERIALIZABLE
    -- snapshot. Final decisions require READ COMMITTED to see committed rotation.
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'This approval needs a fresh session. Nothing was saved. Refresh the page and try again.';
    end if;
    -- These small policy tables are rarely written. Shared locks allow parallel
    -- decisions but exclude policy rotation and new matching assignments until
    -- this transaction ends. NOWAIT avoids stalling behind a policy editor.
    begin
      lock table procurement.doa_matrices,procurement.doa_assignments in share mode nowait;
    exception when lock_not_available then
      raise exception 'The approval policy is being updated. Nothing was saved. Please try again shortly.';
    end;
  end if;
  -- Recheck after the request/step and policy locks, even when a UI eligibility
  -- check or the public wrapper previously allowed the action.
  v_eligibility := procurement.request_decision_eligibility(jsonb_build_object('request_id',v_req.id));
  if not coalesce((v_eligibility->>'canDecide')::boolean,false) then
    raise exception '%',coalesce(v_eligibility->>'reason','This approval is not available to your account.');
  end if;
  if jsonb_typeof(v_sig) is distinct from 'object' then v_sig:=null; end if;
  if v_decision='approved' and (v_sig is null or nullif(v_sig->>'signature_png','') is null
      or nullif(v_sig->>'signer_name','') is null or nullif(v_sig->>'signature_method','') is null) then
    raise exception 'Approvals require an electronic signature (signature_png, signer_name, signature_method)';
  end if;
  update procurement.approval_steps set status=v_decision,note=nullif(payload->>'note',''),
    decided_at=now(),decided_by_email=v_decider_email,signature=v_sig
    where id=v_step.id and status='pending' returning * into v_step;
  if not found then raise exception 'Approval step was already decided'; end if;
  if v_decision='rejected' then
    update procurement.requests set status='rejected',decided_at=now(),decided_by_email=v_decider_email,
      decision_note=v_step.note,updated_at=now() where id=v_req.id returning * into v_req;
  elsif not exists(select 1 from procurement.approval_steps where request_id=v_req.id and status='pending') then
    update procurement.requests set status='approved',decided_at=now(),decided_by_email=v_decider_email,
      decision_note=v_step.note,updated_at=now() where id=v_req.id returning * into v_req;
  else
    update procurement.requests set status='under_review',updated_at=now() where id=v_req.id returning * into v_req;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('procurement','request',v_req.id,'approval_step_'||v_decision,auth.uid(),jsonb_build_object('step_id',v_step.id,'tier',v_step.tier));
  return to_jsonb(v_req);
end; $$;
alter function procurement.decide_request_step_uncertified_impl(jsonb) owner to postgres;
revoke all on function procurement.decide_request_step_uncertified_impl(jsonb) from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
