-- Private, record-bound evidence for Event reconciliation and Finance close.
-- No capability expansion: delivery stays behind the authenticated API.
do $$ begin
  if not exists(select 1 from storage.buckets where id='documents' and not public) then
    raise exception 'A private documents bucket is required for action evidence';
  end if;
end $$;

-- Even a broader legacy policy must not expose or overwrite these API-owned objects.
create policy action_evidence_api_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'documents' or name not like 'business-evidence/%')
with check (bucket_id <> 'documents' or name not like 'business-evidence/%');
create table private.action_evidence (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  uploaded_by uuid not null references core.profiles(id),
  filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 4194304),
  storage_path text not null unique,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);
alter table private.action_evidence enable row level security;
revoke all on private.action_evidence from public, anon, authenticated;

create function private.can_use_action_evidence(p_type text, p_id text, p_upload boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or nullif(btrim(p_id),'') is null
    or not exists(select 1 from core.profiles where id=auth.uid() and status='active') then return false; end if;
  if p_type='event_reconciliation' then
    return exists(select 1 from warehouse.events where id=p_id)
      and (not p_upload or not exists(select 1 from warehouse.event_reconciliations where event_id=p_id and status='approved'))
      and (core.has_live_cap('events','manage_events') or (not p_upload and (
        core.has_live_cap('events','view_events') or core.has_live_cap('events','approve_settlement')
        or core.has_live_cap('warehouse','manage_finance_close'))));
  end if;
  if not core.has_live_cap('warehouse','manage_finance_close') then return false; end if;
  return case p_type
    when 'procurement_request' then exists(select 1 from procurement.requests where id=p_id)
    when 'purchase_order' then exists(select 1 from procurement.purchase_orders where id=p_id)
    when 'payment_readiness_pack' then exists(select 1 from procurement.payment_readiness_packs where id::text=p_id)
    when 'payment_release' then exists(select 1 from procurement.payment_releases where id::text=p_id)
    when 'warehouse_receipt' then exists(select 1 from warehouse.receipts where id=p_id)
    else false end;
end $$;

create function core.prepare_action_evidence(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.action_evidence; v_id uuid:=gen_random_uuid(); v_ext text;
begin
  if not private.can_use_action_evidence(payload->>'source_type',payload->>'source_id',true) then
    raise exception 'Not authorized for this evidence record';
  end if;
  perform core.check_rate_limit('action_evidence.upload',100);
  v_ext:=case payload->>'mime_type' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null or length(btrim(coalesce(payload->>'filename','')))=0
    or length(payload->>'filename')>255 or payload->>'filename' ~ '[[:cntrl:]]'
    or length(payload->>'source_id')>255 then raise exception 'Invalid evidence file'; end if;
  if coalesce((payload->>'size_bytes')::bigint,0) not between 1 and 4194304 then
    raise exception 'Choose a non-empty evidence file up to 4 MB'; end if;
  insert into private.action_evidence(id,source_type,source_id,uploaded_by,filename,mime_type,size_bytes,storage_path)
  values(v_id,payload->>'source_type',payload->>'source_id',auth.uid(),payload->>'filename',payload->>'mime_type',
    (payload->>'size_bytes')::bigint,'business-evidence/'||v_id::text||'.'||v_ext) returning * into v;
  return jsonb_build_object('id',v.id,'storage_path',v.storage_path);
end $$;

create function core.complete_action_evidence(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.action_evidence; v_doc core.documents;
begin
  select * into v from private.action_evidence where id=(payload->>'id')::uuid for update;
  if not found or v.uploaded_by is distinct from auth.uid()
    or not private.can_use_action_evidence(v.source_type,v.source_id,true) then
    raise exception 'Not authorized to register this evidence'; end if;
  if not exists(select 1 from storage.objects where bucket_id='documents' and name=v.storage_path
    and (metadata->>'size')::bigint=v.size_bytes and metadata->>'mimetype'=v.mime_type) then
    raise exception 'Private evidence upload is incomplete'; end if;
  if not v.ready then
    -- The registry has both UUID and text deployments. Its entity is this UUID
    -- evidence record; the private row retains the original polymorphic source ID.
    v_doc:=jsonb_populate_record(null::core.documents,jsonb_build_object(
      'id',v.id,'entity_type','action_evidence','entity_id',v.id,'doc_type','action_evidence',
      'storage_path',v.storage_path,'version',1,'status','submitted','uploaded_by',v.uploaded_by,'created_at',now()));
    insert into core.documents select v_doc.*;
    update private.action_evidence set ready=true where id=v.id;
    insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('core','action_evidence',v.id,'registered',auth.uid(),jsonb_build_object('source_type',v.source_type,'source_id',v.source_id));
  end if;
  return jsonb_build_object('reference','evidence://'||v.id::text,'document_id',v.id,'filename',v.filename);
end $$;

create function private.assert_action_evidence(p_reference text,p_type text,p_id text,p_owner boolean default false)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_use_action_evidence(p_type,p_id,false) then
    raise exception 'Not authorized for this evidence source'; end if;
  if not exists(select 1 from private.action_evidence e
    join core.documents d on d.id::text=e.id::text and d.entity_type='action_evidence'
      and d.entity_id::text=e.id::text and d.storage_path=e.storage_path and d.doc_type='action_evidence'
      and d.status in ('submitted','approved') and (d.expires_at is null or d.expires_at>=current_date)
    join storage.objects o on o.bucket_id='documents' and o.name=e.storage_path
      and (o.metadata->>'size')::bigint=e.size_bytes and o.metadata->>'mimetype'=e.mime_type
    where 'evidence://'||e.id::text=p_reference and e.ready and e.source_type=p_type and e.source_id=p_id
      and (not p_owner or e.uploaded_by=auth.uid())) then
    raise exception 'Evidence is incomplete or does not belong to this record and actor'; end if;
end $$;

create function core.action_evidence_access(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.action_evidence;
begin
  select * into v from private.action_evidence where 'evidence://'||id::text=payload->>'reference' and ready;
  if not found or not private.can_use_action_evidence(v.source_type,v.source_id,false) then
    raise exception 'Not authorized to view this evidence'; end if;
  perform private.assert_action_evidence('evidence://'||v.id::text,v.source_type,v.source_id);
  -- Unsubmitted uploads are visible only to their uploader. Reviewers need a bound business record.
  if v.uploaded_by is distinct from auth.uid() and not (
    (v.source_type='event_reconciliation' and exists(select 1 from warehouse.event_reconciliations
      where event_id=v.source_id and evidence_url='evidence://'||v.id::text))
    or exists(select 1 from core.finance_close_entries where source_record_type=v.source_type
      and source_record_id=v.source_id and evidence_url='evidence://'||v.id::text)
  ) then raise exception 'Evidence has not been attached to a reviewable record'; end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('core','action_evidence',v.id,'opened',auth.uid(),jsonb_build_object('source_type',v.source_type,'source_id',v.source_id));
  return jsonb_build_object('storage_path',v.storage_path,'filename',v.filename,'expires_in',300);
end $$;

create or replace function private.is_supported_event_evidence_reference(p_reference text)
returns boolean language sql immutable security definer set search_path='' as $$
  select coalesce(btrim(p_reference) ~ '^evidence://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (btrim(p_reference) ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?([/?#][^[:space:]]*)?$'
      and p_reference !~* '/storage/v1/object/(sign|public)/'
      and p_reference !~* '[?&](token|signature|sig|expires|x-amz-[^=]*|x-goog-[^=]*)='
      and p_reference !~ '%'),false)
$$;

alter function private.assert_finance_close_binding(text,text,text,text) rename to assert_finance_close_binding_pre_action_evidence;
create function private.assert_finance_close_binding(
  p_source_record_type text,p_source_record_id text,p_evidence_record_type text,p_evidence_record_id text
) returns void language plpgsql stable security definer set search_path='' as $$
begin
  if p_evidence_record_type='core_document' and exists(select 1 from private.action_evidence where id::text=p_evidence_record_id) then
    perform private.assert_action_evidence('evidence://'||p_evidence_record_id,p_source_record_type,p_source_record_id);
    return;
  end if;
  perform private.assert_finance_close_binding_pre_action_evidence(p_source_record_type,p_source_record_id,p_evidence_record_type,p_evidence_record_id);
end $$;

alter function private.finance_close_evidence_reference(text,text) rename to finance_close_evidence_reference_pre_action_evidence;
create function private.finance_close_evidence_reference(p_type text,p_id text)
returns text language plpgsql stable security definer set search_path='' as $$
declare v private.action_evidence;
begin
  if p_type='core_document' then
    select * into v from private.action_evidence where id::text=p_id;
    if found then
      perform private.assert_action_evidence('evidence://'||v.id::text,v.source_type,v.source_id);
      return 'evidence://'||v.id::text;
    end if;
  end if;
  return private.finance_close_evidence_reference_pre_action_evidence(p_type,p_id);
end $$;

alter function warehouse.save_event_reconciliation(jsonb) rename to save_event_reconciliation_pre_action_evidence;
create function warehouse.save_event_reconciliation(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ref text;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required'; end if;
  if payload->>'action' in ('save','submit') and not core.has_live_cap('events','manage_events')
    or payload->>'action'='approve' and not core.has_live_cap('events','approve_settlement') then
    raise exception 'Not authorized for Event reconciliation'; end if;
  perform 1 from warehouse.events where id=payload->>'event_id' for update;
  perform 1 from warehouse.event_reconciliations where event_id=payload->>'event_id' for update;
  if payload->>'action' in ('save','submit') then v_ref:=nullif(btrim(payload->>'evidence_url'),'');
  else select evidence_url into v_ref from warehouse.event_reconciliations where event_id=payload->>'event_id'; end if;
  if v_ref like 'evidence://%' then
    perform private.assert_action_evidence(v_ref,'event_reconciliation',payload->>'event_id',payload->>'action' in ('save','submit'));
  elsif v_ref is not null and not private.is_supported_event_evidence_reference(v_ref) then
    raise exception 'Use a registered document or permanent HTTPS evidence link';
  end if;
  return warehouse.save_event_reconciliation_pre_action_evidence(payload);
end $$;

alter function core.manage_finance_close_entry(jsonb) rename to manage_finance_close_entry_pre_action_evidence;
create function core.manage_finance_close_entry(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ref text:=nullif(btrim(payload->>'evidence_url'),''); v core.finance_close_entries; v_canonical text;
  v_from_registry boolean:=v_ref is null;
begin
  if auth.uid() is null or not core.has_live_cap('warehouse','manage_finance_close') then
    raise exception 'Not authorized: warehouse.manage_finance_close'; end if;
  if payload->>'action'='save' then
    if v_from_registry then
      perform private.assert_finance_close_binding(payload->>'source_record_type',payload->>'source_record_id',
        payload->>'evidence_record_type',payload->>'evidence_record_id');
    end if;
    v_canonical:=private.finance_close_evidence_reference(payload->>'evidence_record_type',payload->>'evidence_record_id');
    v_ref:=coalesce(v_ref,nullif(btrim(v_canonical),''));
    if v_ref is null then raise exception 'Registered evidence has no durable reference'; end if;
    if v_canonical like 'evidence://%' and v_ref is distinct from v_canonical then
      raise exception 'Registered evidence identity does not match'; end if;
    if v_ref like 'evidence://%' then
      perform private.assert_action_evidence(v_ref,payload->>'source_record_type',payload->>'source_record_id',true);
      if payload->>'evidence_record_type' is distinct from 'core_document' or 'evidence://'||(payload->>'evidence_record_id') is distinct from v_ref then
        raise exception 'Registered evidence identity does not match'; end if;
    -- Legacy payment IDs/private paths are valid only when resolved from the
    -- source-bound registry, never when supplied as free-text evidence URLs.
    elsif (not v_from_registry or v_ref ~ '^[A-Za-z][A-Za-z0-9+.-]*:')
      and not private.is_supported_event_evidence_reference(v_ref) then
      raise exception 'Use a registered document or permanent HTTPS evidence link';
    end if;
    payload:=payload||jsonb_build_object('evidence_url',v_ref);
  else
    select * into v from core.finance_close_entries where id=(payload->>'id')::uuid for update;
    if v.evidence_url like 'evidence://%' then
      perform private.assert_action_evidence(v.evidence_url,v.source_record_type,v.source_record_id);
    end if;
  end if;
  return core.manage_finance_close_entry_pre_action_evidence(payload);
end $$;

revoke all on function private.can_use_action_evidence(text,text,boolean),
  private.assert_action_evidence(text,text,text,boolean),
  private.assert_finance_close_binding(text,text,text,text),
  private.assert_finance_close_binding_pre_action_evidence(text,text,text,text),
  private.finance_close_evidence_reference(text,text),
  private.finance_close_evidence_reference_pre_action_evidence(text,text),
  warehouse.save_event_reconciliation_pre_action_evidence(jsonb),
  core.manage_finance_close_entry_pre_action_evidence(jsonb)
from public,anon,authenticated;
revoke all on function core.prepare_action_evidence(jsonb),core.complete_action_evidence(jsonb),core.action_evidence_access(jsonb),
  warehouse.save_event_reconciliation(jsonb),core.manage_finance_close_entry(jsonb) from public,anon;
grant execute on function core.prepare_action_evidence(jsonb),core.complete_action_evidence(jsonb),core.action_evidence_access(jsonb),
  warehouse.save_event_reconciliation(jsonb),core.manage_finance_close_entry(jsonb) to authenticated,service_role;
select pg_notify('pgrst','reload schema');
