-- Forward-only read projections. Invoker mode preserves each source's RLS.
create function core.platform_finance_page(p_source text, p_after text default '', p_size integer default 200)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_relation text; v_key text; v_columns text := '*'; v_result jsonb;
begin
  if p_size is null or p_size not between 1 and 500 then raise exception 'Invalid page size'; end if;
  case p_source
    when 'activity' then v_relation := 'core.v_finance_activity'; v_key := 'source::text || '':'' || ref_id::text';
    when 'orders' then v_relation := 'procurement.purchase_orders'; v_key := 'id::text'; v_columns := 'id,po_number,vendor_name,total,status,updated_at';
    when 'payments' then v_relation := 'procurement.payment_readiness_packs'; v_key := 'id::text';
    when 'inventory' then v_relation := 'warehouse.inventory_position_v1'; v_key := 'product_id::text'; v_columns := 'product_id,sum(on_hand) as on_hand';
    when 'products' then v_relation := 'warehouse.products'; v_key := 'id::text'; v_columns := 'id,unit_cost';
    when 'close' then v_relation := 'core.finance_close_entry_authority'; v_key := 'id::text';
    else raise exception 'Unsupported Finance source';
  end case;
  if not (core.has_live_cap('warehouse','view_finance') or core.has_live_cap('procurement','view_finance')) then raise exception 'Finance read access required'; end if;
  if p_source in ('orders','payments') and not core.has_live_cap('procurement','view_finance') then raise exception 'Procurement Finance read access required'; end if;
  if p_source in ('inventory','products') and not core.has_live_cap('warehouse','view_finance') then raise exception 'Warehouse Finance read access required'; end if;
  execute format('with population as (select %s from %s %s), page as (select p.*, %s as page_key from population p where (%s) > $1 order by (%s) limit $2) select jsonb_build_object(''rows'',coalesce(jsonb_agg(to_jsonb(page) order by page_key),''[]''::jsonb),''next'',max(page_key),''total'',(select count(*) from population)) from page',
    v_columns, v_relation, case when p_source = 'inventory' then 'group by product_id' else '' end, v_key, v_key, v_key)
    into v_result using coalesce(p_after,''), p_size;
  return v_result;
end $$;
revoke all on function core.platform_finance_page(text,text,integer) from public, anon;
grant execute on function core.platform_finance_page(text,text,integer) to authenticated;

create function core.platform_finance_totals(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('periodStart',p_start,'periodEnd',p_end,
    'committedValue',coalesce(sum(amount) filter(where source='procurement_po'),0),
    'receivedValue',coalesce(sum(amount) filter(where source='warehouse_receipt'),0),
    'returnedValue',abs(coalesce(sum(amount) filter(where source='warehouse_return'),0)))
  from core.v_finance_activity where occurred_at >= p_start::timestamp at time zone 'Asia/Manila'
    and occurred_at < (p_end + 1)::timestamp at time zone 'Asia/Manila'
    and (core.has_live_cap('warehouse','view_finance') or core.has_live_cap('procurement','view_finance'));
$$;
revoke all on function core.platform_finance_totals(date,date) from public, anon;
grant execute on function core.platform_finance_totals(date,date) to authenticated;

create function core.platform_user_directory(p_query text default '', p_status text default 'active', p_kind text default 'all', p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not core.has_live_cap('core','manage_rbac') then raise exception 'Platform administration required'; end if;
  if p_page < 1 or length(p_query) > 200 then raise exception 'Invalid directory query'; end if;
  with population as (
    select id,email,full_name,title,kind,vendor_id,status from core.profiles
    where (p_status='all' or status=p_status) and (p_kind='all' or kind=p_kind)
      and (coalesce(email,'') ilike '%' || p_query || '%' or coalesce(full_name,'') ilike '%' || p_query || '%')
  ), page as (select * from population order by email,id limit 20 offset ((p_page-1)*20))
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by email,id) from page),'[]'::jsonb),
    'total',(select count(*) from population),'roles',coalesce((select jsonb_agg(to_jsonb(r)) from core.user_roles r join page p on p.id=r.user_id),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function core.platform_user_directory(text,text,text,integer) from public, anon;
grant execute on function core.platform_user_directory(text,text,text,integer) to authenticated;

-- Attribute exception reasons without rewriting the applied mutation wrapper chain.
alter table core.finance_close_entries add column correction_by uuid references auth.users(id), add column correction_at timestamptz;
create function core.platform_close_correction_actor() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status='exception' and old.status is distinct from new.status then
    new.correction_by := auth.uid(); new.correction_at := statement_timestamp();
  end if;
  return new;
end $$;
create trigger platform_close_correction_actor before update on core.finance_close_entries for each row execute function core.platform_close_correction_actor();
create or replace view core.finance_close_entry_authority with (security_invoker=true) as
select lineage.*, reconciliation.approved_by as settlement_approved_by, entry.correction_by, entry.correction_at
from core.finance_close_entry_lineage lineage
join core.finance_close_entries entry on entry.id=lineage.id
left join warehouse.event_reconciliations reconciliation on lineage.source_record_type='event_reconciliation' and reconciliation.event_id=lineage.source_record_id;
notify pgrst, 'reload schema';

alter table core.insight_followups
  add column acknowledged_by uuid references auth.users(id),
  add column acknowledged_at timestamptz,
  add column resolved_by uuid references auth.users(id),
  add column resolved_at timestamptz,
  add column resolution_reference text;

create function core.platform_followup_owner(p_area text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select case p_area
    when 'finance' then core.has_live_cap('warehouse','manage_finance_close') or core.has_live_cap('procurement','review_payment_readiness')
    when 'warehouse' then core.has_live_cap('warehouse','resolve_exceptions')
    when 'procurement' then core.has_live_cap('procurement','admin')
    when 'legal' then core.has_live_cap('legal','admin')
    when 'executive' then core.has_live_cap('core','manage_rbac')
    else false end;
$$;
revoke all on function core.platform_followup_owner(text) from public,anon;
grant execute on function core.platform_followup_owner(text) to authenticated;
drop policy insight_followups_read on core.insight_followups;
create policy insight_followups_read on core.insight_followups for select to authenticated
  using (requested_by=auth.uid() or core.platform_followup_owner(area));

create function core.platform_followup_page(p_after uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from (
    select f.*,core.platform_followup_owner(area) as can_act from core.insight_followups f
    where p_after is null or id > p_after order by id limit 100
  ) p;
$$;
revoke all on function core.platform_followup_page(uuid) from public,anon;
grant execute on function core.platform_followup_page(uuid) to authenticated;

create function core.platform_transition_followup(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f core.insight_followups; action text := payload->>'action';
begin
  select * into f from core.insight_followups where id=(payload->>'id')::uuid for update;
  if not found or not core.platform_followup_owner(f.area) then raise exception 'Follow-up owner capability required'; end if;
  if action='acknowledge' then
    if f.status='acknowledged' and f.acknowledged_by=auth.uid() then return to_jsonb(f); end if;
    if f.status <> 'open' then raise exception 'Follow-up changed; refresh'; end if;
    update core.insight_followups set status='acknowledged',acknowledged_by=auth.uid(),acknowledged_at=statement_timestamp() where id=f.id returning * into f;
  elsif action='resolve' then
    if f.status='resolved' and f.resolved_by=auth.uid() and f.resolution_reference=payload->>'resolution_reference' then return to_jsonb(f); end if;
    if f.status <> 'acknowledged' then raise exception 'Acknowledge before resolution'; end if;
    if length(btrim(coalesce(payload->>'resolution_reference',''))) not between 6 and 200
      or payload->>'resolution_reference' ~ '://|@' then raise exception 'A controlled resolution record reference is required, not a URL or personal detail'; end if;
    update core.insight_followups set status='resolved',resolved_by=auth.uid(),resolved_at=statement_timestamp(),resolution_reference=btrim(payload->>'resolution_reference') where id=f.id returning * into f;
  else raise exception 'Invalid follow-up transition'; end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('insights','insight_followup',f.id,action,auth.uid(),jsonb_build_object('resolution_reference',f.resolution_reference));
  return to_jsonb(f);
end $$;
revoke all on function core.platform_transition_followup(jsonb) from public,anon;
grant execute on function core.platform_transition_followup(jsonb) to authenticated;
notify pgrst, 'reload schema';

-- Release rows have no direct authenticated SELECT grant. Expose only the
-- bounded close-selection projection to certified preparers with Finance read scope.
create function core.platform_close_release_sources(p_query text default '',p_id text default null)
returns table(type text,id text,module text,reference text,party text,amount numeric,occurred_at timestamptz,href text)
language sql stable security definer set search_path='' as $$
  select 'payment_release'::text,r.id::text,'procurement'::text,r.payment_reference,p.vendor_name,r.amount,r.recorded_at,
    '/procurement/purchase-orders/'||p.id
  from procurement.payment_releases r join procurement.purchase_orders p on p.id=r.purchase_order_id
  where core.has_live_cap('warehouse','manage_finance_close') and core.has_live_cap('procurement','view_finance')
    and r.status='posted' and (p_id is null or r.id::text=p_id)
    and (coalesce(p_query,'')='' or r.payment_reference ilike '%'||p_query||'%' or p.po_number ilike '%'||p_query||'%' or p.vendor_name ilike '%'||p_query||'%')
  order by r.recorded_at desc,r.id limit 50;
$$;
revoke all on function core.platform_close_release_sources(text,text) from public,anon;
grant execute on function core.platform_close_release_sources(text,text) to authenticated;

create function core.platform_close_sources(p_query text default '', p_type text default null, p_id text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  with sources as (
    select 'purchase_order'::text as type,id::text, 'procurement'::text as module,po_number as reference,vendor_name as party,total as amount,updated_at as occurred_at,
      '/procurement/purchase-orders/'||id as href from procurement.purchase_orders
    union all
    select 'warehouse_receipt',id::text,'warehouse',id::text,null::text,null::numeric,created_at,'/warehouse/receiving?receipt='||id from warehouse.receipts
    union all
    select * from core.platform_close_release_sources(p_query,p_id)
  ) select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from (
    select * from sources where core.has_live_cap('warehouse','manage_finance_close')
      and (p_type is null or type=p_type) and (p_id is null or id=p_id)
      and (p_query='' or reference ilike '%'||p_query||'%' or party ilike '%'||p_query||'%')
    order by occurred_at desc,id limit 50
  ) s;
$$;
revoke all on function core.platform_close_sources(text,text,text) from public,anon;
grant execute on function core.platform_close_sources(text,text,text) to authenticated;

create function core.platform_close_evidence_options(p_type text,p_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not core.has_live_cap('warehouse','manage_finance_close') or not private.can_use_action_evidence(p_type,p_id,true) then raise exception 'Source preparation not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'label',e.filename,'type','core_document') order by e.created_at,e.id),'[]'::jsonb) into result
  from private.action_evidence e join core.documents d on d.id::text=e.id::text and d.storage_path=e.storage_path
  join storage.objects o on o.bucket_id='documents' and o.name=e.storage_path
  where e.source_type=p_type and e.source_id=p_id and e.uploaded_by=auth.uid() and e.ready
    and d.status in ('submitted','approved') and (d.expires_at is null or d.expires_at>=current_date)
    and (o.metadata->>'size')::bigint=e.size_bytes and o.metadata->>'mimetype'=e.mime_type;
  return result;
end $$;
revoke all on function core.platform_close_evidence_options(text,text) from public,anon;
grant execute on function core.platform_close_evidence_options(text,text) to authenticated;

-- Read-only Finance evidence admission, without changing any upload/write authority.
alter function private.can_use_action_evidence(text,text,boolean) rename to platform_previous_can_use_action_evidence;
create function private.can_use_action_evidence(p_type text,p_id text,p_upload boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if private.platform_previous_can_use_action_evidence(p_type,p_id,p_upload) then return true; end if;
  if p_upload or auth.uid() is null or not exists(select 1 from core.profiles where id=auth.uid() and status='active') then return false; end if;
  return exists(select 1 from core.finance_close_entries where source_record_type=p_type and source_record_id=p_id)
    and case when p_type in ('procurement_request','purchase_order','payment_readiness_pack','payment_release') then core.has_live_cap('procurement','view_finance')
      when p_type in ('warehouse_receipt','event_reconciliation') then core.has_live_cap('warehouse','view_finance') else false end;
end $$;
revoke all on function private.can_use_action_evidence(text,text,boolean) from public,anon,authenticated;
grant execute on function private.can_use_action_evidence(text,text,boolean) to service_role;

create function core.platform_close_evidence(p_entry uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e core.finance_close_entries; reference text; href text; bucket text; filename text;
begin
  select * into e from core.finance_close_entries where id=p_entry;
  if not found or not private.can_use_action_evidence(e.source_record_type,e.source_record_id,false) then raise exception 'Evidence source access restricted'; end if;
  if e.evidence_record_type='event_reconciliation' then
    select evidence_url into reference from warehouse.event_reconciliations where event_id=e.source_record_id;
  else
    perform private.assert_finance_close_binding(e.source_record_type,e.source_record_id,e.evidence_record_type,e.evidence_record_id);
    reference:=private.finance_close_evidence_reference(e.evidence_record_type,e.evidence_record_id);
  end if;
  if reference like 'evidence://%' then
    perform private.assert_action_evidence(reference,e.source_record_type,e.source_record_id);
  elsif e.evidence_record_type='request_attachment' then
    bucket:='procurement-requests';
    select a.filename into filename from procurement.request_attachments a join storage.objects o on o.bucket_id=bucket and o.name=a.storage_path
      where a.id::text=e.evidence_record_id and a.storage_path=reference
        and (o.metadata->>'size')::bigint=a.size_bytes and o.metadata->>'mimetype'=a.mime_type;
    if filename is null then raise exception 'Attachment object missing or metadata changed'; end if;
  elsif e.evidence_record_type='core_document' then
    select case when d.entity_type in ('receipt','warehouse_receipt','return') then 'evidence' else 'documents' end into bucket
      from core.documents d where d.id::text=e.evidence_record_id and d.storage_path=reference
        and d.status in ('submitted','approved') and (d.expires_at is null or d.expires_at>=current_date)
        and not exists(select 1 from core.documents newer where newer.entity_type=d.entity_type and newer.entity_id=d.entity_id and newer.doc_type=d.doc_type and newer.version>d.version);
    if bucket is null or not exists(select 1 from storage.objects o where o.bucket_id=bucket and o.name=reference) then raise exception 'Registered document unavailable, expired, superseded or missing'; end if;
    filename:='finance-evidence';
  elsif e.evidence_record_type='warehouse_receipt' then
    href:='/warehouse/receiving?receipt='||e.evidence_record_id;
  elsif e.evidence_record_type in ('payment_release','payment_readiness_pack') then
    if e.evidence_record_type='payment_release' then select '/procurement/purchase-orders/'||purchase_order_id into href from procurement.payment_releases where id::text=e.evidence_record_id;
    else select '/procurement/purchase-orders/'||purchase_order_id into href from procurement.payment_readiness_packs where id::text=e.evidence_record_id; end if;
  else
    raise exception 'Evidence type is unavailable for inspection';
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail) values('core','finance_close_entry',e.id,'evidence_inspected',auth.uid(),jsonb_build_object('evidence_type',e.evidence_record_type));
  return jsonb_build_object('reference',case when reference like 'evidence://%' then reference end,'href',href,
    'bucket',bucket,'storage_path',case when bucket is not null then reference end,'filename',filename);
end $$;
revoke all on function core.platform_close_evidence(uuid) from public,anon;
grant execute on function core.platform_close_evidence(uuid) to authenticated;
notify pgrst,'reload schema';
