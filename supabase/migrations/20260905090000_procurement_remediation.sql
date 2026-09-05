-- Forward-only Sep 05 procurement/Legal remediation. No authority is widened.
create or replace function private.has_current_procurement_tier(p_tier text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from core.user_roles assignment
    join core.profiles profile on profile.id=assignment.user_id and profile.status='active'
    join core.roles definition on definition.module=assignment.module and definition.role=assignment.role and definition.is_active
    join core.role_capabilities capability on capability.module=assignment.module and capability.role=assignment.role
    where assignment.user_id=auth.uid()
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
revoke all on function private.has_current_procurement_tier(text) from public,anon,authenticated,service_role;

create or replace function procurement.request_decision_eligibility(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  permitted := private.has_current_procurement_tier(s.tier) and case s.tier
    when 'legal' then core.has_live_cap('legal','review_accreditation')
    when 'dept_head' then core.has_live_cap('procurement','approve_request')
    when 'procurement_head' then core.has_live_cap('procurement','approve_request')
    when 'finance' then core.has_live_cap('procurement','approve_request')
    when 'final_approver' then core.has_live_cap('procurement','approve_request')
    else false end;
  return jsonb_build_object('canDecide',permitted,'stepId',s.id,'reason',case when permitted then 'Assigned to you' else 'Current role certification is required' end);
end; $$;

create or replace function procurement.decide_request_step(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_id text; eligibility jsonb;
begin
  request_id := payload->>'request_id';
  if request_id is null then select s.request_id into request_id from procurement.approval_steps s where s.id=payload->>'step_id'; end if;
  perform 1 from procurement.requests r where r.id=request_id for update;
  eligibility := procurement.request_decision_eligibility(jsonb_build_object('request_id',request_id));
  if not coalesce((eligibility->>'canDecide')::boolean,false) then raise exception '%',eligibility->>'reason'; end if;
  -- The existing implementation still checks ordering, assignee, tier and signature.
  return procurement.decide_request_step_uncertified_impl(payload);
end; $$;
revoke all on function procurement.request_decision_eligibility(jsonb), procurement.decide_request_step(jsonb) from public,anon,service_role;
grant execute on function procurement.request_decision_eligibility(jsonb), procurement.decide_request_step(jsonb) to authenticated;

alter table procurement.requests add column if not exists revision integer not null default 0;
-- Active ladders are rebuilt by the prior submit implementation. Keep their
-- stable identities and full decisions separately so exception FKs survive.
create table procurement.approval_step_audit (
  id text primary key,
  request_id text not null references procurement.requests(id) on delete restrict,
  request_revision integer not null,
  snapshot jsonb not null,
  archived_at timestamptz
);
alter table procurement.approval_step_audit enable row level security;
revoke all on procurement.approval_step_audit from public,anon,authenticated,service_role;
insert into procurement.approval_step_audit(id,request_id,request_revision,snapshot)
select s.id,s.request_id,r.revision,to_jsonb(s)
from procurement.approval_steps s join procurement.requests r on r.id=s.request_id;

create or replace function private.retain_procurement_approval_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare step jsonb; rev integer;
begin
  step:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if exists(select 1 from procurement.approval_step_audit where id=step->>'id' and archived_at is not null) then
    raise exception 'Archived approval identity cannot be reused or changed';
  end if;
  select revision into rev from procurement.requests where id=step->>'request_id';
  insert into procurement.approval_step_audit(id,request_id,request_revision,snapshot,archived_at)
  values(step->>'id',step->>'request_id',rev,step,case when tg_op='DELETE' then statement_timestamp() end)
  on conflict(id) do update set snapshot=excluded.snapshot,archived_at=excluded.archived_at;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function private.retain_procurement_approval_audit() from public,anon,authenticated,service_role;
create trigger retain_procurement_approval_audit before insert or update or delete on procurement.approval_steps
for each row execute function private.retain_procurement_approval_audit();

-- Same retained IDs, still restrictive: references now include archived steps.
alter table procurement.exception_packs drop constraint exception_packs_final_approval_step_id_fkey;
alter table procurement.exception_packs add constraint exception_packs_final_approval_step_id_fkey
foreign key(final_approval_step_id) references procurement.approval_step_audit(id) on delete restrict;

create table procurement.request_revisions (
  request_id text not null references procurement.requests(id), revision integer not null,
  snapshot jsonb not null, actor_id uuid not null, created_at timestamptz not null default now(),
  primary key(request_id,revision)
);
alter table procurement.request_revisions enable row level security;
revoke all on procurement.request_revisions from public,anon,authenticated;

create or replace function procurement.revise_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r procurement.requests; a jsonb; l jsonb; total numeric:=0; att procurement.request_attachments;
begin
  if auth.uid() is null or core.is_vendor() or not core.has_live_cap('procurement','create_request') then raise exception 'Request creation authority required'; end if;
  select * into r from procurement.requests where id=payload->>'id' for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the request owner may revise'; end if;
  if r.status not in ('draft','rejected') then raise exception 'Only draft or rejected requests may be revised'; end if;
  if r.revision is distinct from (payload->>'expected_revision')::integer then raise exception 'Request changed; reload before revising'; end if;
  -- Stabilize linked histories before testing eligibility and archiving them.
  perform 1 from procurement.purchase_orders where request_id=r.id for update;
  perform 1 from procurement.sourcing_events where request_id=r.id for update;
  perform 1 from procurement.exception_packs where request_id=r.id for update;
  if exists(select 1 from procurement.purchase_orders where request_id=r.id and status<>'cancelled') then raise exception 'Resolve the purchase order before revising'; end if;
  if exists(select 1 from procurement.sourcing_events where request_id=r.id and status not in ('cancelled','failed_bid')) then raise exception 'Resolve active sourcing before revising'; end if;
  if nullif(btrim(payload->>'title'),'') is null or nullif(btrim(payload->'justification'->>'need'),'') is null then raise exception 'Title and business need are required'; end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines')=0 then raise exception 'Request lines are required'; end if;
  for l in select value from jsonb_array_elements(payload->'lines') loop
    if nullif(btrim(l->>'description'),'') is null or coalesce((l->>'quantity')::numeric,0)<1 or (l->>'quantity')::numeric<>trunc((l->>'quantity')::numeric) or coalesce((l->>'unitPrice')::numeric,-1)<0 then raise exception 'Invalid request line'; end if;
    total:=total+(l->>'quantity')::numeric*(l->>'unitPrice')::numeric;
  end loop;
  insert into procurement.request_revisions values(r.id,r.revision,to_jsonb(r)||jsonb_build_object(
    'approvalSteps',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from procurement.approval_steps s where request_id=r.id),
    'exceptionPacks',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from procurement.exception_packs e where request_id=r.id),
    'routeDecisions',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from procurement.route_decisions d where request_id=r.id),
    'sourcingEvents',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from procurement.sourcing_events e where request_id=r.id)),auth.uid(),now());
  for a in select value from jsonb_array_elements(coalesce(payload->'attachments','[]'::jsonb)) loop
    if not exists(select 1 from storage.objects o where o.bucket_id='procurement-requests' and o.name=a->>'storage_path' and o.owner_id=auth.uid()::text and split_part(o.name,'/',2)=r.id) then raise exception 'Uploaded request evidence not found or not owned'; end if;
    insert into procurement.request_attachments(id,request_id,filename,mime_type,size_bytes,storage_path,sha256,kind,uploaded_by,uploaded_by_email)
    values(a->>'id',r.id,a->>'filename',a->>'mime_type',(a->>'size_bytes')::bigint,a->>'storage_path',a->>'sha256',a->>'kind',auth.uid(),auth.jwt()->>'email') returning * into att;
    r.attachments:=coalesce(r.attachments,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',att.id,'filename',att.filename,'mimeType',att.mime_type,'sizeBytes',att.size_bytes,'storagePath',att.storage_path,'sha256',att.sha256,'kind',att.kind,'uploadedAt',att.uploaded_at,'uploadedByEmail',att.uploaded_by_email));
  end loop;
  -- The audit trigger retains exact decisions and exception references. Only
  -- the active ladder is cleared; sourcing children and exception history stay.
  delete from procurement.approval_steps where request_id=r.id;
  update procurement.exception_packs set status='superseded' where request_id=r.id and status<>'superseded';
  update procurement.sourcing_events set status='cancelled' where request_id=r.id and status='failed_bid';
  update procurement.route_decisions set status='policy_decision_required' where request_id=r.id and status='confirmed';
  update procurement.requests set title=btrim(payload->>'title'),lines=payload->'lines',estimated_amount=total,
    justification=payload->'justification',core_vendor_id=nullif(payload->>'vendor_id','')::uuid,
    vendor_name=(select legal_name from core.vendors where id=nullif(payload->>'vendor_id','')::uuid),
    attachments=r.attachments,status='draft',revision=r.revision+1,
    route_confirmed_at=null,route_confirmed_by=null,decided_at=null,decided_by_email=null,decision_note=null,submitted_at=null,updated_at=now(),
    compliance=coalesce(r.compliance,'{}'::jsonb)||'{"routeConfirmed":false}'::jsonb
    where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;
revoke all on function procurement.revise_request(jsonb) from public,anon,service_role;
grant execute on function procurement.revise_request(jsonb) to authenticated;

-- A payment document is immutable private request evidence bound to a PO/vendor.
alter table procurement.request_attachments
  add column if not exists payment_po_id text references procurement.purchase_orders(id),
  add column if not exists payment_vendor_id uuid,
  add column if not exists payment_purpose text,
  add column if not exists payment_evidence_version integer;

-- Payment files share the private bucket, but must not inherit requester access.
create or replace function private.can_read_payment_evidence()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not core.is_vendor() and (
    core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')
    or core.has_live_cap('procurement','view_finance'))
$$;
create or replace function private.can_read_procurement_evidence_path(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_read_payment_evidence() or not exists (
    select 1 from procurement.request_attachments where storage_path=p_path and payment_po_id is not null)
$$;
revoke all on function private.can_read_payment_evidence(),private.can_read_procurement_evidence_path(text) from public,anon,service_role;
grant execute on function private.can_read_payment_evidence(),private.can_read_procurement_evidence_path(text) to authenticated;
create policy payment_attachment_read_boundary on procurement.request_attachments as restrictive
  for select to authenticated using (payment_po_id is null or private.can_read_payment_evidence());
create policy payment_object_read_boundary on storage.objects as restrictive
  for select to authenticated using (bucket_id<>'procurement-requests' or private.can_read_procurement_evidence_path(name));

alter function procurement.prepare_request_attachment_access(jsonb) rename to prepare_request_attachment_access_pre_sep05;
create or replace function procurement.prepare_request_attachment_access(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d procurement.request_attachments;
begin
  select * into d from procurement.request_attachments where id=payload->>'attachment_id';
  if d.payment_po_id is null then return procurement.prepare_request_attachment_access_pre_sep05(payload); end if;
  if not private.can_read_payment_evidence() then raise exception 'Payment evidence access required'; end if;
  if not exists(select 1 from storage.objects where bucket_id='procurement-requests' and name=d.storage_path) then raise exception 'Payment document is unavailable'; end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('procurement','request_attachment',d.id,'download_prepared',auth.uid(),jsonb_build_object('purchase_order_id',d.payment_po_id,'sha256',d.sha256));
  return jsonb_build_object('bucket','procurement-requests','storage_path',d.storage_path,'filename',d.filename,'sha256',d.sha256,'expires_in',60);
end; $$;
revoke all on function procurement.prepare_request_attachment_access_pre_sep05(jsonb) from public,anon,authenticated,service_role;
revoke all on function procurement.prepare_request_attachment_access(jsonb) from public,anon,service_role;
grant execute on function procurement.prepare_request_attachment_access(jsonb) to authenticated;

create or replace function procurement.register_payment_document(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare po procurement.purchase_orders; a jsonb:=payload->'attachment'; d procurement.request_attachments;
begin
  if auth.uid() is null or core.is_vendor() or not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Payment preparation authority required'; end if;
  select * into po from procurement.purchase_orders where id=payload->>'purchase_order_id' for share;
  if not found or po.status<>'issued' then raise exception 'Issued purchase order required'; end if;
  if payload->>'purpose' not in ('invoice','acceptance','tax','foreign') or payload->>'purpose' is null then raise exception 'Document purpose required'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='procurement-requests' and o.name=a->>'storage_path' and o.owner_id=auth.uid()::text and split_part(o.name,'/',2)=po.request_id) then raise exception 'Private uploaded evidence not found or not owned'; end if;
  insert into procurement.request_attachments(id,request_id,filename,mime_type,size_bytes,storage_path,sha256,kind,uploaded_by,uploaded_by_email,payment_po_id,payment_vendor_id,payment_purpose,payment_evidence_version)
  values(a->>'id',po.request_id,a->>'filename',a->>'mime_type',(a->>'size_bytes')::bigint,a->>'storage_path',a->>'sha256','other',auth.uid(),auth.jwt()->>'email',po.id,po.core_vendor_id,payload->>'purpose',po.acceptance_evidence_version) returning * into d;
  return to_jsonb(d);
end; $$;

create or replace function procurement.payment_evidence_options(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare po procurement.purchase_orders;
begin
  if not private.can_read_payment_evidence() then raise exception 'Payment evidence access required'; end if;
  select * into po from procurement.purchase_orders where id=payload->>'purchase_order_id';
  if not found then raise exception 'Purchase order unavailable'; end if;
  return jsonb_build_object('foreignVendor',exists(select 1 from legal.accreditation_cases c where c.vendor_id=po.core_vendor_id and coalesce(c.jurisdiction,'PH')<>'PH'),
    'packDocuments',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'purpose',d.payment_purpose)),'[]'::jsonb) from procurement.request_attachments d join procurement.payment_readiness_packs p on p.purchase_order_id=d.payment_po_id where p.id=nullif(payload->>'pack_id','')::uuid and p.purchase_order_id=po.id and d.id in (select value from jsonb_each_text(p.document_ids))),
    'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'filename',d.filename,'purpose',d.payment_purpose)),'[]'::jsonb) from procurement.request_attachments d join storage.objects o on o.bucket_id='procurement-requests' and o.name=d.storage_path where d.payment_po_id=po.id and d.payment_vendor_id=po.core_vendor_id and d.payment_evidence_version=po.acceptance_evidence_version));
end; $$;
revoke all on function procurement.register_payment_document(jsonb),procurement.payment_evidence_options(jsonb) from public,anon,service_role;
grant execute on function procurement.register_payment_document(jsonb),procurement.payment_evidence_options(jsonb) to authenticated;

alter table procurement.payment_readiness_packs add column if not exists document_ids jsonb;
create table procurement.vendor_invoice_identities (
  vendor_id uuid not null, invoice_identity text not null,
  current_pack_id uuid not null references procurement.payment_readiness_packs(id),
  primary key(vendor_id,invoice_identity)
);
alter table procurement.vendor_invoice_identities enable row level security;
revoke all on procurement.vendor_invoice_identities from public,anon,authenticated;
insert into procurement.vendor_invoice_identities(vendor_id,invoice_identity,current_pack_id)
select distinct on (po.core_vendor_id,lower(regexp_replace(btrim(p.invoice_number),'\s+',' ','g')))
  po.core_vendor_id,lower(regexp_replace(btrim(p.invoice_number),'\s+',' ','g')),p.id
from procurement.payment_readiness_packs p join procurement.purchase_orders po on po.id=p.purchase_order_id
where po.core_vendor_id is not null and nullif(btrim(p.invoice_number),'') is not null
order by po.core_vendor_id,lower(regexp_replace(btrim(p.invoice_number),'\s+',' ','g')),p.prepared_at desc,p.id;

alter function private.policy_prepare_invoice_payment_readiness(jsonb) rename to policy_prepare_invoice_payment_readiness_pre_sep05;
create or replace function private.policy_prepare_invoice_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare po procurement.purchase_orders; d procurement.request_attachments; prior procurement.payment_readiness_packs; k text; purpose text; normalized text; previous uuid; result jsonb; ids jsonb:='{}'::jsonb; locked_vendor uuid;
begin
  if auth.uid() is null or core.is_vendor() or not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Payment preparation authority required'; end if;
  select * into po from procurement.purchase_orders where id=payload->>'purchase_order_id';
  if not found or po.core_vendor_id is null then raise exception 'Vendor-bound purchase order required'; end if;
  normalized:=lower(regexp_replace(btrim(payload->>'invoice_number'),'\s+',' ','g'));
  if coalesce(normalized,'')='' then raise exception 'Invoice number required'; end if;
  -- Vendor-scoped lock serializes invoices across different purchase orders too.
  perform pg_advisory_xact_lock(hashtextextended(po.core_vendor_id::text,0));
  locked_vendor:=po.core_vendor_id;
  select * into po from procurement.purchase_orders where id=po.id for update;
  if po.core_vendor_id is distinct from locked_vendor then raise exception 'Purchase order vendor changed; refresh before preparing'; end if;
  previous:=nullif(payload->>'corrected_from','')::uuid;
  select p.* into prior from procurement.payment_readiness_packs p join procurement.purchase_orders other_po on other_po.id=p.purchase_order_id
    where other_po.core_vendor_id=po.core_vendor_id and lower(regexp_replace(btrim(p.invoice_number),'\s+',' ','g'))=normalized
    order by p.prepared_at desc limit 1 for update of p;
  if found and (previous is distinct from prior.id or prior.purchase_order_id<>po.id or not (prior.status='returned' or (prior.status in ('accepted','released') and prior.evidence_stale))) then raise exception 'Duplicate vendor invoice number; use the returned invoice correction'; end if;
  if previous is not null and (prior.id is null or prior.id<>previous) then raise exception 'Correction must retain the original invoice identity'; end if;
  if previous is not null and coalesce(prior.released_amount,0)>0 then raise exception 'A paid invoice requires Finance reconciliation before replacement'; end if;
  foreach k in array array['invoice_or_si_storage_path','milestone_support_storage_path','tax_withholding_support_storage_path','foreign_vendor_evidence_storage_path'] loop
    purpose:=case k when 'invoice_or_si_storage_path' then 'invoice' when 'milestone_support_storage_path' then 'acceptance' when 'tax_withholding_support_storage_path' then 'tax' else 'foreign' end;
    if purpose='foreign' and nullif(payload->>k,'') is null then continue; end if;
    select a.* into d from procurement.request_attachments a join storage.objects o on o.bucket_id='procurement-requests' and o.name=a.storage_path
      where a.id=payload->>k and a.payment_po_id=po.id and a.payment_vendor_id=po.core_vendor_id and a.payment_purpose=purpose and a.payment_evidence_version=po.acceptance_evidence_version;
    if not found then raise exception 'Select current uploaded % evidence for this purchase order',purpose; end if;
    ids:=ids||jsonb_build_object(purpose,d.id);
    payload:=jsonb_set(payload,array[k],to_jsonb(d.storage_path));
  end loop;
  payload:=jsonb_set(payload,'{invoice_number}',to_jsonb(normalized));
  result:=private.policy_prepare_invoice_payment_readiness_pre_sep05(payload);
  insert into procurement.vendor_invoice_identities(vendor_id,invoice_identity,current_pack_id)
  values(po.core_vendor_id,normalized,(result->>'id')::uuid)
  on conflict(vendor_id,invoice_identity) do update set current_pack_id=excluded.current_pack_id
    where procurement.vendor_invoice_identities.current_pack_id=previous;
  if not found then raise exception 'Invoice identity already reserved'; end if;
  update procurement.payment_readiness_packs set document_ids=ids where id=(result->>'id')::uuid;
  return result||jsonb_build_object('document_ids',ids);
end; $$;
revoke all on function private.policy_prepare_invoice_payment_readiness(jsonb),private.policy_prepare_invoice_payment_readiness_pre_sep05(jsonb) from public,anon,authenticated,service_role;

-- The compatibility entry point must not bypass document or invoice guards.
create or replace function procurement.prepare_payment_readiness(payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.policy_prepare_invoice_payment_readiness(payload)
$$;
revoke all on function procurement.prepare_payment_readiness(jsonb) from public,anon,service_role;
grant execute on function procurement.prepare_payment_readiness(jsonb) to authenticated;

create or replace function procurement.vendor_purchase_order_acknowledgements(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or core.current_vendor_id() is null then raise exception 'Vendor session is required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'poNumber',po.po_number,'vendorName',po.vendor_name,
    'documentHash',encode(sha256(convert_to(jsonb_build_object('lines',po.lines,'total',po.total,'expectedDate',po.expected_date,'terms',r.solicitation_requirements)::text,'UTF8')),'hex'),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('description',line->'description','quantity',line->'quantity','uom',line->'uom','unitPrice',coalesce(line->'unitPrice',line->'unit_price'))),'[]'::jsonb) from jsonb_array_elements(po.lines) line),
    'total',po.total,'expectedDate',po.expected_date,'terms',jsonb_build_object(
      'paymentTerms',r.solicitation_requirements->'paymentTerms','deliveryTerms',r.solicitation_requirements->'deliveryTerms',
      'shippingTerms',r.solicitation_requirements->'shippingTerms','scopeOfWork',r.solicitation_requirements->'scopeOfWork',
      'acceptanceCriteria',r.solicitation_requirements->'acceptanceCriteria','validityPeriod',r.solicitation_requirements->'validityPeriod'),
    'lifecycle',private.policy_po_lifecycle_projection(po.id)) order by po.issued_at desc)
    from procurement.purchase_orders po left join procurement.requests r on r.id=po.request_id
    where po.status='issued' and po.core_vendor_id=core.current_vendor_id()),'[]'::jsonb);
end; $$;

alter function procurement.acknowledge_purchase_order(jsonb) rename to acknowledge_purchase_order_pre_sep05;
create or replace function procurement.acknowledge_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare document jsonb;
begin
  if auth.uid() is null or nullif(payload->>'expected_revision','') is null then raise exception 'Authenticated actor and expected_revision are required'; end if;
  perform 1 from procurement.purchase_orders where id=payload->>'purchase_order_id' for update;
  perform 1 from procurement.requests r join procurement.purchase_orders po on po.request_id=r.id where po.id=payload->>'purchase_order_id' for share of r;
  select value into document from jsonb_array_elements(procurement.vendor_purchase_order_acknowledgements('{}'::jsonb)) where value->>'id'=payload->>'purchase_order_id';
  if document is null or document->>'documentHash' is distinct from payload->>'document_hash' then raise exception 'Purchase order content changed or is unavailable'; end if;
  return private.policy_po_lifecycle_transition(payload->>'purchase_order_id',(payload->>'expected_revision')::integer,
    'vendor_acknowledged',payload->>'acknowledgement_reference',jsonb_build_object('documentHash',document->>'documentHash'));
end; $$;
revoke all on function procurement.acknowledge_purchase_order_pre_sep05(jsonb) from public,anon,authenticated,service_role;
revoke all on function procurement.acknowledge_purchase_order(jsonb) from public,anon,service_role;
grant execute on function procurement.acknowledge_purchase_order(jsonb) to authenticated;
