-- Restore database authority for Procurement request decisions and Legal
-- accreditation decisions after later cutover definitions weakened the
-- governed contracts. Forward-only: no historical migration is modified.

create or replace function procurement.decide_request_step(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step procurement.approval_steps;
  v_req procurement.requests;
  v_request_id text := nullif(payload->>'request_id', '');
  v_step_id text := nullif(payload->>'step_id', '');
  v_decision text := nullif(payload->>'decision', '');
  v_sig jsonb := payload->'signature';
  v_tier_ok boolean := false;
  v_decider_email text := auth.jwt()->>'email';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if core.is_vendor() then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  if not (
    core.has_cap('procurement', 'approve_request')
    or core.has_module_role('legal')
  ) then
    raise exception 'Not authorized: procurement.approve_request';
  end if;
  if v_decision is null or v_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  -- Retain compatibility with the deployed step-id-only payload while the
  -- application sends both request_id and step_id.
  if v_request_id is null and v_step_id is not null then
    select request_id into v_request_id
    from procurement.approval_steps
    where id = v_step_id;
  end if;
  if v_request_id is null then
    raise exception 'request_id or step_id is required';
  end if;

  select * into v_req
  from procurement.requests
  where id = v_request_id
  for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if v_req.status not in ('submitted', 'under_review') then
    raise exception 'Request % is not awaiting approval (status %)', v_req.id, v_req.status;
  end if;
  if v_req.requester_id = auth.uid() then
    raise exception 'Requesters cannot approve their own request';
  end if;

  select * into v_step
  from procurement.approval_steps
  where request_id = v_req.id
    and status = 'pending'
  order by step_order
  limit 1
  for update;
  if not found then
    raise exception 'No pending approval step for request %', v_req.id;
  end if;
  if v_step_id is not null and v_step.id <> v_step_id then
    raise exception 'Step % is not the next pending step for request %', v_step_id, v_req.id;
  end if;
  if nullif(payload->>'tier', '') is not null and payload->>'tier' <> v_step.tier then
    raise exception 'Payload tier does not match the next pending tier %', v_step.tier;
  end if;
  if v_step.assigned_user_id is not null
     and v_step.assigned_user_id is distinct from auth.uid() then
    raise exception 'The next pending step is assigned to a different approver';
  end if;

  v_tier_ok := case v_step.tier
    when 'dept_head' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid()
        and ur.module = 'procurement'
        and ur.role = 'approver'
    )
    when 'procurement_head' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid()
        and ur.module = 'procurement'
        and ur.role in ('procurement_officer', 'admin')
    )
    when 'finance' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid()
        and ur.module = 'procurement'
        and ur.role = 'finance'
    )
    when 'legal' then core.has_module_role('legal') and not core.is_vendor()
    when 'final_approver' then exists (
      select 1 from core.user_roles ur
      where ur.user_id = auth.uid()
        and ur.module = 'procurement'
        and ur.role = 'admin'
    )
    else false
  end;
  if not v_tier_ok then
    raise exception 'Caller does not hold the % tier for the next pending step', v_step.tier;
  end if;

  if jsonb_typeof(v_sig) is distinct from 'object' then
    v_sig := null;
  end if;
  if v_decision = 'approved' and (
    v_sig is null
    or nullif(v_sig->>'signature_png', '') is null
    or nullif(v_sig->>'signer_name', '') is null
    or nullif(v_sig->>'signature_method', '') is null
  ) then
    raise exception 'Approvals require an electronic signature (signature_png, signer_name, signature_method)';
  end if;

  update procurement.approval_steps
  set status = v_decision,
      note = nullif(payload->>'note', ''),
      decided_at = now(),
      decided_by_email = v_decider_email,
      signature = v_sig
  where id = v_step.id
    and status = 'pending'
  returning * into v_step;
  if not found then
    raise exception 'Approval step was already decided';
  end if;

  if v_decision = 'rejected' then
    update procurement.requests
    set status = 'rejected',
        decided_at = now(),
        decided_by_email = v_decider_email,
        decision_note = v_step.note,
        updated_at = now()
    where id = v_req.id
    returning * into v_req;
  elsif not exists (
    select 1 from procurement.approval_steps
    where request_id = v_req.id and status = 'pending'
  ) then
    update procurement.requests
    set status = 'approved',
        decided_at = now(),
        decided_by_email = v_decider_email,
        decision_note = v_step.note,
        updated_at = now()
    where id = v_req.id
    returning * into v_req;
  else
    update procurement.requests
    set status = 'under_review',
        updated_at = now()
    where id = v_req.id
    returning * into v_req;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'procurement',
    'request',
    v_req.id,
    'approval_step_' || v_decision,
    auth.uid(),
    jsonb_build_object('step_id', v_step.id, 'tier', v_step.tier)
  );

  return to_jsonb(v_req);
end;
$$;

revoke all on function procurement.decide_request_step(jsonb) from public, anon;
grant execute on function procurement.decide_request_step(jsonb) to authenticated, service_role;

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case legal.accreditation_cases;
  v_snapshot legal.vendor_application_snapshots;
  v_review legal.accreditation_decision_reviews;
  v_status text := coalesce(nullif(payload->>'decision',''), nullif(payload->>'status',''), 'approved');
  v_effective jsonb := payload;
  v_high_risk boolean;
  v_open integer;
  v_missing_docs integer;
  v_missing_signatures integer;
begin
  if not core.has_cap('legal','approve_accreditation') then
    raise exception 'Not authorized';
  end if;
  if v_status not in ('approved','rejected','provisional') then
    raise exception 'Invalid accreditation decision';
  end if;

  select * into v_case
  from legal.accreditation_cases
  where id = payload->>'id'
  for update;
  if not found then
    raise exception 'Accreditation case not found';
  end if;
  if v_case.status not in ('submitted', 'under_review') then
    raise exception 'Accreditation case % is not awaiting a decision (status %)', v_case.id, v_case.status;
  end if;

  select * into v_snapshot
  from legal.vendor_application_snapshots
  where case_id = v_case.id
  order by version desc, created_at desc, id desc
  limit 1;
  if not found or v_snapshot.status <> 'submitted' or v_snapshot.submitted_at is null then
    raise exception 'A current submitted vendor application snapshot is required';
  end if;

  if v_status = 'approved' then
    select count(*) into v_open
    from legal.requirement_checklist_items item
    where item.case_id = v_case.id
      and item.required
      and item.decision not in ('approved','na');

    select count(*) into v_missing_docs
    from legal.requirement_checklist_items item
    left join lateral (
      select candidate.id, candidate.status
      from legal.accreditation_docs candidate
      where candidate.case_id = item.case_id
        and (
          candidate.requirement_id = item.id
          or candidate.id = any(item.document_ids)
        )
      order by candidate.version desc, candidate.uploaded_at desc, candidate.id desc
      limit 1
    ) current_document on true
    where item.case_id = v_case.id
      and item.required
      and item.decision = 'approved'
      and not item.instrument
      and (
        current_document.id is null
        or current_document.status <> 'approved'
      );

    select count(*) into v_missing_signatures
    from legal.requirement_checklist_items item
    where item.case_id = v_case.id
      and item.required
      and item.decision = 'approved'
      and item.instrument
      and not exists (
        select 1 from legal.signed_instruments instrument
        where instrument.case_id = item.case_id
          and instrument.revoked_at is null
          and (instrument.code = item.instrument_code or instrument.code = item.code)
      );

    if v_open > 0 or v_missing_docs > 0 or v_missing_signatures > 0 then
      raise exception 'Required checklist items, current approved documents, or signatures remain unresolved';
    end if;
  end if;

  v_high_risk := v_status in ('rejected', 'provisional')
    or v_case.risk_tier = 'high'
    or coalesce(v_case.handles_personal_data, false);
  if v_high_risk then
    select * into v_review
    from legal.accreditation_decision_reviews
    where case_id = v_case.id and status = 'pending'
    for update;
    if not found then
      insert into legal.accreditation_decision_reviews(
        case_id, proposed_status, payload, proposed_by
      ) values (
        v_case.id, v_status, payload, auth.uid()
      ) returning * into v_review;
      update legal.accreditation_cases
      set pending_decision_status = v_status,
          pending_decision_proposed_by_email = auth.jwt()->>'email',
          updated_at = now()
      where id = v_case.id
      returning * into v_case;
      insert into legal.case_timeline(case_id, actor_email, action, detail)
      values (
        v_case.id,
        auth.jwt()->>'email',
        'decision_proposed',
        'Independent Legal confirmation required'
      );
      return to_jsonb(v_case) || jsonb_build_object(
        'decision_pending', true,
        'decision_review_id', v_review.id
      );
    end if;
    if v_review.proposed_status <> v_status then
      raise exception 'A different decision is already awaiting confirmation';
    end if;
    if v_review.proposed_by = auth.uid() then
      return to_jsonb(v_case) || jsonb_build_object(
        'decision_pending', true,
        'decision_review_id', v_review.id
      );
    end if;
    update legal.accreditation_decision_reviews
    set status = 'confirmed',
        confirmed_by = auth.uid(),
        confirmed_at = now()
    where id = v_review.id;
    v_effective := v_review.payload;
    perform 1
    from legal.accreditation_decision_reviews
    where id = v_review.id and proposed_by <> auth.uid();
  end if;

  update legal.accreditation_cases
  set status = v_status,
      decided_at = now(),
      decided_by_email = auth.jwt()->>'email',
      decision_note = nullif(v_effective->>'note',''),
      expires_at = nullif(v_effective->>'expires_at','')::date,
      scope = nullif(v_effective->>'scope',''),
      pending_decision_status = null,
      pending_decision_proposed_by_email = null,
      updated_at = now()
  where id = v_case.id
  returning * into v_case;

  update core.vendors
  set accreditation_status = v_case.status,
      accreditation_expires_at = v_case.expires_at
  where id = v_case.vendor_id;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (
    v_case.id,
    v_case.decided_by_email,
    v_case.status,
    coalesce(v_case.decision_note,'Decision recorded')
  );

  return to_jsonb(v_case) || jsonb_build_object('decision_pending', false);
end;
$$;

revoke all on function legal.approve_accreditation_case(jsonb) from public, anon;
grant execute on function legal.approve_accreditation_case(jsonb) to authenticated, service_role;
