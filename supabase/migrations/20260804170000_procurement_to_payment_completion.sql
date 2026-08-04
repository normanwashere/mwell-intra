-- Complete the governed procurement-to-payment path: competitive sourcing,
-- non-stock acceptance, structured invoice matching, payment posting, closure.

alter table procurement.sourcing_events
  add column if not exists selected_vendor_id uuid references core.vendors(id) on delete restrict,
  add column if not exists closure_note text,
  add column if not exists closed_at timestamptz;

alter table procurement.acceptance_packs
  add column if not exists accepted_amount numeric(14,2);

alter table procurement.payment_readiness_packs
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists invoice_amount numeric(14,2),
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists withholding_amount numeric(14,2) not null default 0,
  add column if not exists purchase_order_amount numeric(14,2),
  add column if not exists accepted_amount numeric(14,2),
  add column if not exists variance_amount numeric(14,2),
  add column if not exists released_amount numeric(14,2) not null default 0;

create table if not exists procurement.payment_releases (
  id uuid primary key default gen_random_uuid(),
  payment_readiness_pack_id uuid not null references procurement.payment_readiness_packs(id) on delete restrict,
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_reference text not null unique,
  payment_method text not null check (payment_method in ('bank_transfer','check','corporate_card','other')),
  paid_at date not null,
  recorded_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  status text not null default 'posted' check (status in ('posted','voided'))
);

alter table procurement.payment_releases enable row level security;
drop policy if exists direct_access_denied on procurement.payment_releases;
create policy direct_access_denied on procurement.payment_releases
for all to authenticated using (false) with check (false);
revoke all on procurement.payment_releases from public, anon, authenticated;
grant all on procurement.payment_releases to service_role;

create index if not exists sourcing_events_request_status_idx
  on procurement.sourcing_events(request_id,status);
create index if not exists sourcing_responses_event_received_idx
  on procurement.sourcing_responses(sourcing_event_id,received_at);
create index if not exists payment_releases_pack_status_idx
  on procurement.payment_releases(payment_readiness_pack_id,status);

create or replace function procurement.sourcing_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_request procurement.requests;
  v_route procurement.route_decisions;
  v_event procurement.sourcing_events;
  v_responses jsonb := '[]'::jsonb;
begin
  select * into v_request from procurement.requests where id=payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  if v_request.requester_id<>auth.uid()
     and not core.has_cap('procurement','view_dashboard')
     and not core.has_cap('procurement','manage_rfp')
     and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to view sourcing';
  end if;
  select * into v_route from procurement.route_decisions decision
    where decision.request_id=v_request.id and decision.status='confirmed'
    order by decision.request_version desc limit 1;
  if not found then return jsonb_build_object('requestId',v_request.id,'event',null); end if;
  select * into v_event from procurement.sourcing_events source
    where source.request_id=v_request.id and source.status<>'cancelled'
    order by source.created_at desc limit 1;
  if not found then return jsonb_build_object('requestId',v_request.id,'method',v_route.method,'event',null); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',response.id,'vendorId',response.vendor_id,'vendorName',vendor.legal_name,
    'invitedAt',response.invited_at,'receivedAt',response.received_at,
    'deadlineCompliant',response.deadline_compliant,'proposalReference',response.proposal_storage_path,
    'commercial',response.commercial,'technical',response.technical,
    'materialExceptions',response.material_exceptions
  ) order by vendor.legal_name),'[]'::jsonb) into v_responses
  from procurement.sourcing_responses response
  join core.vendors vendor on vendor.id=response.vendor_id
  where response.sourcing_event_id=v_event.id;
  return jsonb_build_object(
    'requestId',v_request.id,'method',v_route.method,
    'event',jsonb_build_object(
      'id',v_event.id,'status',v_event.status,'issuedAt',v_event.issued_at,
      'submissionDeadline',v_event.submission_deadline,'intendedResponses',v_event.intended_responses,
      'selectedVendorId',v_event.selected_vendor_id,'closureNote',v_event.closure_note,
      'closedAt',v_event.closed_at,'responses',v_responses
    )
  );
end $$;

create or replace function procurement.save_sourcing_event(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_route procurement.route_decisions; v_event procurement.sourcing_events;
begin
  if not core.has_cap('procurement','manage_rfp') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_route from procurement.route_decisions
   where request_id=payload->>'request_id' and status='confirmed'
   order by request_version desc limit 1;
  if not found or v_route.method not in ('rfq','rfp') then
    raise exception 'A confirmed RFQ or RFP route is required'; end if;
  select * into v_event from procurement.sourcing_events
   where request_id=v_route.request_id and status<>'cancelled'
   order by created_at desc limit 1 for update;
  if found and v_event.status<>'draft' then raise exception 'Only a draft sourcing event can be edited'; end if;
  if found then
    update procurement.sourcing_events set
      submission_deadline=nullif(payload->>'submission_deadline','')::timestamptz,
      intended_responses=nullif(payload->>'intended_responses','')::int,
      clarification_log=coalesce(payload->'clarification_log',clarification_log)
    where id=v_event.id returning * into v_event;
  else
    insert into procurement.sourcing_events(request_id,route_decision_id,submission_deadline,intended_responses,clarification_log)
    values(v_route.request_id,v_route.id,nullif(payload->>'submission_deadline','')::timestamptz,
      nullif(payload->>'intended_responses','')::int,coalesce(payload->'clarification_log','[]'::jsonb))
    returning * into v_event;
  end if;
  return to_jsonb(v_event);
end $$;

create or replace function procurement.record_sourcing_response(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event procurement.sourcing_events; v_response procurement.sourcing_responses; v_received timestamptz;
begin
  if not core.has_cap('procurement','manage_rfp') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id=(payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status in ('closed','cancelled') then raise exception 'Sourcing event is not open'; end if;
  v_received:=nullif(payload->>'received_at','')::timestamptz;
  if v_received is not null and v_event.status<>'issued' then raise exception 'Issue the event before recording a response'; end if;
  if v_received is not null and nullif(payload->>'proposal_storage_path','') is null then
    raise exception 'A proposal evidence reference is required'; end if;
  insert into procurement.sourcing_responses(
    sourcing_event_id,vendor_id,invited_at,received_at,deadline_compliant,proposal_storage_path,
    commercial,technical,material_exceptions
  ) values(
    v_event.id,(payload->>'vendor_id')::uuid,coalesce(nullif(payload->>'invited_at','')::timestamptz,now()),
    v_received,case when v_received is null or v_event.submission_deadline is null then null else v_received<=v_event.submission_deadline end,
    nullif(payload->>'proposal_storage_path',''),coalesce(payload->'commercial','{}'::jsonb),
    coalesce(payload->'technical','{}'::jsonb),coalesce(payload->'material_exceptions','[]'::jsonb)
  ) on conflict(sourcing_event_id,vendor_id) do update set
    received_at=excluded.received_at,deadline_compliant=excluded.deadline_compliant,
    proposal_storage_path=excluded.proposal_storage_path,commercial=excluded.commercial,
    technical=excluded.technical,material_exceptions=excluded.material_exceptions
  returning * into v_response;
  return to_jsonb(v_response);
end $$;

create or replace function procurement.transition_sourcing_event(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_event procurement.sourcing_events; v_action text:=payload->>'action'; v_received int; v_invited int;
begin
  if not core.has_cap('procurement','manage_rfp') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Sourcing event not found'; end if;
  select count(*),count(*) filter(where received_at is not null) into v_invited,v_received
    from procurement.sourcing_responses where sourcing_event_id=v_event.id;
  if v_action='issue' then
    if v_event.status<>'draft' or v_invited=0 then raise exception 'Invite at least one vendor before issue'; end if;
    if v_event.submission_deadline is null or v_event.submission_deadline<=now() then raise exception 'A future submission deadline is required'; end if;
    update procurement.sourcing_events set status='issued',issued_at=now() where id=v_event.id returning * into v_event;
  elsif v_action='close' then
    if v_event.status<>'issued' or v_received=0 then raise exception 'At least one received response is required'; end if;
    if v_event.intended_responses is not null and v_received<v_event.intended_responses and not exists(
      select 1 from procurement.exception_packs exception where exception.request_id=v_event.request_id
        and exception.exception_type='insufficient_bids' and exception.status='approved'
    ) then raise exception 'An approved insufficient-bids exception is required'; end if;
    if not exists(select 1 from procurement.sourcing_responses response
      where response.sourcing_event_id=v_event.id and response.vendor_id=(payload->>'selected_vendor_id')::uuid and response.received_at is not null)
    then raise exception 'Select a vendor with a received response'; end if;
    if nullif(payload->>'closure_note','') is null then raise exception 'Award rationale is required'; end if;
    update procurement.sourcing_events set status='closed',selected_vendor_id=(payload->>'selected_vendor_id')::uuid,
      closure_note=payload->>'closure_note',closed_at=now() where id=v_event.id returning * into v_event;
    update procurement.requests request set core_vendor_id=v_event.selected_vendor_id,
      vendor_name=vendor.legal_name,updated_at=now()
      from core.vendors vendor where request.id=v_event.request_id and vendor.id=v_event.selected_vendor_id;
  elsif v_action='cancel' then
    if v_event.status='closed' then raise exception 'A closed sourcing event cannot be cancelled'; end if;
    update procurement.sourcing_events set status='cancelled',closure_note=nullif(payload->>'closure_note',''),closed_at=now()
      where id=v_event.id returning * into v_event;
  else raise exception 'Unsupported sourcing transition'; end if;
  return to_jsonb(v_event);
end $$;

create or replace function procurement.record_non_stock_acceptance(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_po procurement.purchase_orders; v_pack procurement.acceptance_packs; v_amount numeric; v_type text; v_hash text;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id' for update;
  if not found or v_po.status not in ('issued','closed') then raise exception 'An issued purchase order is required'; end if;
  if auth.uid()<>(select requester_id from procurement.requests where id=v_po.request_id)
     and not exists(select 1 from procurement.acceptance_reviewer_assignments assignment
       where assignment.request_id=v_po.request_id and assignment.reviewer_id=auth.uid() and assignment.superseded_at is null)
  then raise exception 'Not authorized to record acceptance'; end if;
  v_type:=case payload->>'acceptance_type' when 'service' then 'service_completion' when 'milestone' then 'technical_acceptance' else null end;
  if v_type is null then raise exception 'Only service or milestone acceptance is supported'; end if;
  v_amount:=(payload->>'accepted_amount')::numeric;
  if v_amount<=0 or v_amount>v_po.total then raise exception 'Accepted value must be within the PO value'; end if;
  if nullif(trim(payload->>'accepted_scope'),'') is null then raise exception 'Accepted scope is required'; end if;
  if coalesce((select sum(accepted_amount) from procurement.acceptance_packs pack
    where pack.purchase_order_id=v_po.id and pack.status in ('accepted','accepted_with_exceptions')),0)+v_amount>v_po.total
  then raise exception 'Cumulative accepted value exceeds the PO value'; end if;
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('scope',payload->>'accepted_scope','amount',v_amount)::text,'UTF8'),'sha256'),'hex');
  insert into procurement.acceptance_packs(purchase_order_id,request_id,acceptance_type,accepted_scope,accepted_amount,exceptions,document_hash,status)
  values(v_po.id,v_po.request_id,v_type,jsonb_build_object('summary',payload->>'accepted_scope','acceptedAmount',v_amount),v_amount,
    coalesce(payload->'exceptions','[]'::jsonb),v_hash,
    case when jsonb_array_length(coalesce(payload->'exceptions','[]'::jsonb))>0 then 'accepted_with_exceptions' else 'accepted' end)
  returning * into v_pack;
  return to_jsonb(v_pack);
end $$;

create or replace function procurement.prepare_invoice_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_po procurement.purchase_orders; v_pack procurement.payment_readiness_packs; v_ids uuid[];
  v_accepted numeric; v_prior numeric; v_invoice numeric; v_corrected uuid;
begin
  if not core.has_cap('procurement','author_po') and not core.has_cap('procurement','admin') then raise exception 'Not authorized to prepare payment'; end if;
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id' for update;
  if not found or v_po.status not in ('issued','closed') then raise exception 'An issued purchase order is required'; end if;
  if nullif(trim(payload->>'invoice_number'),'') is null or nullif(payload->>'invoice_date','') is null
     or nullif(payload->>'invoice_or_si_storage_path','') is null or nullif(payload->>'milestone_support_storage_path','') is null
     or nullif(payload->>'tax_withholding_support_storage_path','') is null then raise exception 'Invoice and evidence fields are required'; end if;
  v_invoice:=(payload->>'invoice_amount')::numeric;
  if v_invoice<=0 then raise exception 'Invoice amount must be positive'; end if;
  if exists(select 1 from procurement.payment_readiness_packs prior join procurement.purchase_orders prior_po on prior_po.id=prior.purchase_order_id
    where prior_po.core_vendor_id=v_po.core_vendor_id and lower(prior.invoice_number)=lower(payload->>'invoice_number')
      and prior.purchase_order_id<>v_po.id and prior.status<>'superseded')
  then raise exception 'Duplicate vendor invoice number'; end if;
  select array_agg(pack.id order by pack.accepted_at,pack.id),coalesce(sum(coalesce(pack.accepted_amount,0)),0)
    into v_ids,v_accepted from procurement.acceptance_packs pack
    where pack.purchase_order_id=v_po.id and pack.status='accepted' and jsonb_array_length(pack.exceptions)=0;
  if coalesce(cardinality(v_ids),0)=0 then raise exception 'Acceptance evidence is required'; end if;
  select coalesce(sum(prior.invoice_amount),0) into v_prior from procurement.payment_readiness_packs prior
    where prior.purchase_order_id=v_po.id and prior.status in ('accepted','released') and not prior.evidence_stale;
  if v_invoice>v_accepted-v_prior or v_invoice>v_po.total-v_prior then raise exception 'Invoice exceeds the accepted unpaid value'; end if;
  v_corrected:=nullif(payload->>'corrected_from','')::uuid;
  update procurement.payment_readiness_packs set status='superseded'
    where purchase_order_id=v_po.id and status in ('draft','returned','ready_for_finance');
  insert into procurement.payment_readiness_packs(
    purchase_order_id,acceptance_pack_id,acceptance_pack_ids,accepted_quantity,acceptance_evidence_version,
    policy_version,po_match,invoice_or_si_storage_path,milestone_support_storage_path,tax_withholding_support_storage_path,
    invoice_number,invoice_date,due_date,invoice_amount,tax_amount,withholding_amount,purchase_order_amount,
    accepted_amount,variance_amount,status,corrected_from
  ) values(v_po.id,v_ids[1],v_ids,0,v_po.acceptance_evidence_version,'procurement-policy-revised-2026',true,
    payload->>'invoice_or_si_storage_path',payload->>'milestone_support_storage_path',payload->>'tax_withholding_support_storage_path',
    payload->>'invoice_number',(payload->>'invoice_date')::date,nullif(payload->>'due_date','')::date,v_invoice,
    coalesce((payload->>'tax_amount')::numeric,0),coalesce((payload->>'withholding_amount')::numeric,0),v_po.total,
    v_accepted,v_accepted-v_prior-v_invoice,'ready_for_finance',v_corrected)
  returning * into v_pack;
  return to_jsonb(v_pack);
end $$;

create or replace function procurement.release_payment(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pack procurement.payment_readiness_packs; v_release procurement.payment_releases; v_total numeric;
begin
  if not core.has_cap('procurement','view_finance') and not core.has_cap('procurement','admin') then raise exception 'Not authorized to release payment'; end if;
  select * into v_pack from procurement.payment_readiness_packs where id=(payload->>'payment_readiness_pack_id')::uuid for update;
  if not found or v_pack.status<>'accepted' then raise exception 'Finance acceptance is required before release'; end if;
  if (payload->>'amount')::numeric<=0 or (payload->>'amount')::numeric>v_pack.invoice_amount-v_pack.released_amount then
    raise exception 'Release amount exceeds the unpaid invoice balance'; end if;
  if nullif(trim(payload->>'payment_reference'),'') is null or nullif(payload->>'paid_at','') is null then raise exception 'Payment reference and date are required'; end if;
  insert into procurement.payment_releases(payment_readiness_pack_id,purchase_order_id,amount,payment_reference,payment_method,paid_at)
  values(v_pack.id,v_pack.purchase_order_id,(payload->>'amount')::numeric,payload->>'payment_reference',payload->>'payment_method',(payload->>'paid_at')::date)
  returning * into v_release;
  select coalesce(sum(amount),0) into v_total from procurement.payment_releases
    where payment_readiness_pack_id=v_pack.id and status='posted';
  update procurement.payment_readiness_packs set released_amount=v_total,
    status=case when v_total>=invoice_amount then 'released' else 'accepted' end where id=v_pack.id returning * into v_pack;
  if v_pack.status='released' and v_pack.accepted_amount>=v_pack.purchase_order_amount then
    update procurement.purchase_orders set status='closed',updated_at=now() where id=v_pack.purchase_order_id and status='issued';
  end if;
  return jsonb_build_object('pack',to_jsonb(v_pack),'release',to_jsonb(v_release));
end $$;

create or replace function procurement.review_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if payload->>'status'='returned' and nullif(trim(payload->>'note'),'') is null then
    raise exception 'A correction note is required when returning a payment pack';
  end if;
  return private.policy_review_payment_readiness(payload);
end $$;

revoke all on function procurement.sourcing_workspace(jsonb),procurement.save_sourcing_event(jsonb),
  procurement.record_sourcing_response(jsonb),procurement.transition_sourcing_event(jsonb),
  procurement.record_non_stock_acceptance(jsonb),procurement.prepare_invoice_payment_readiness(jsonb),
  procurement.release_payment(jsonb),procurement.review_payment_readiness(jsonb) from public,anon;
grant execute on function procurement.sourcing_workspace(jsonb),procurement.save_sourcing_event(jsonb),
  procurement.record_sourcing_response(jsonb),procurement.transition_sourcing_event(jsonb),
  procurement.record_non_stock_acceptance(jsonb),procurement.prepare_invoice_payment_readiness(jsonb),
  procurement.release_payment(jsonb),procurement.review_payment_readiness(jsonb) to authenticated,service_role;
