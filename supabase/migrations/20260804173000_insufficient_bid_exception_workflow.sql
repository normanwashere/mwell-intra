-- Make the insufficient-response branch operable without weakening sourcing.

create or replace function procurement.submit_insufficient_bid_exception(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event procurement.sourcing_events; v_pack procurement.exception_packs; v_received int;
begin
  if not core.has_cap('procurement','manage_rfp') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to submit a sourcing exception'; end if;
  select * into v_event from procurement.sourcing_events where id=(payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status<>'issued' or v_event.intended_responses is null then raise exception 'An issued sourcing event with a response target is required'; end if;
  select count(*) into v_received from procurement.sourcing_responses where sourcing_event_id=v_event.id and received_at is not null;
  if v_received>=v_event.intended_responses then raise exception 'The recorded response target has been met'; end if;
  if length(trim(coalesce(payload->>'justification','')))<20 or length(trim(coalesce(payload->>'price_reasonableness','')))<10 then
    raise exception 'Detailed justification and price reasonableness are required'; end if;
  update procurement.exception_packs set status='superseded'
    where request_id=v_event.request_id and exception_type='insufficient_bids' and status in ('draft','under_review','rejected');
  insert into procurement.exception_packs(request_id,exception_type,justification,evidence,price_reasonableness,status)
  values(v_event.request_id,'insufficient_bids',trim(payload->>'justification'),
    jsonb_build_object('sourcingEventId',v_event.id,'intendedResponses',v_event.intended_responses,
      'receivedResponses',v_received,'createdBy',auth.uid(),'createdAt',now()),
    trim(payload->>'price_reasonableness'),'under_review') returning * into v_pack;
  return to_jsonb(v_pack);
end $$;

create or replace function procurement.review_insufficient_bid_exception(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pack procurement.exception_packs; v_decision text:=payload->>'decision';
begin
  if not core.has_cap('procurement','approve_award') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to review a sourcing exception'; end if;
  if v_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into v_pack from procurement.exception_packs
    where id=(payload->>'id')::uuid and exception_type='insufficient_bids' for update;
  if not found or v_pack.status<>'under_review' then raise exception 'Exception is not awaiting review'; end if;
  if v_pack.evidence->>'createdBy'=auth.uid()::text then raise exception 'The exception author cannot approve their own request'; end if;
  if nullif(trim(payload->>'note'),'') is null then raise exception 'A review note is required'; end if;
  update procurement.exception_packs set status=v_decision,
    procurement_head_reviewed_by=auth.uid(),procurement_head_reviewed_at=now(),
    evidence=evidence||jsonb_build_object('reviewNote',trim(payload->>'note'),'reviewedBy',auth.uid(),'reviewedAt',now())
  where id=v_pack.id returning * into v_pack;
  return to_jsonb(v_pack);
end $$;

create or replace function procurement.insufficient_bid_exception(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_request procurement.requests; v_pack procurement.exception_packs;
begin
  select * into v_request from procurement.requests where id=payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  if v_request.requester_id<>auth.uid() and not core.has_cap('procurement','view_dashboard')
     and not core.has_cap('procurement','approve_award') then raise exception 'Not authorized to view sourcing exception'; end if;
  select * into v_pack from procurement.exception_packs
    where request_id=v_request.id and exception_type='insufficient_bids' and status<>'superseded'
    order by id desc limit 1;
  return case when found then to_jsonb(v_pack) else null end;
end $$;

revoke all on function procurement.submit_insufficient_bid_exception(jsonb),
  procurement.review_insufficient_bid_exception(jsonb),procurement.insufficient_bid_exception(jsonb) from public,anon;
grant execute on function procurement.submit_insufficient_bid_exception(jsonb),
  procurement.review_insufficient_bid_exception(jsonb),procurement.insufficient_bid_exception(jsonb) to authenticated,service_role;
