-- P0/P1 production-readiness fixes from the full Intra audit.
-- - Keep Legal review decisions in a closed set.
-- - Prevent final accreditation approval while required evidence is unapproved.
-- - Add the missing legal document RPC contract used by the app.
-- - Move event/bin writes behind warehouse SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- Legal document compatibility and controlled actions
-- ---------------------------------------------------------------------------
alter table legal.accreditation_docs
  add column if not exists data_url text;

create or replace function legal.upload_accreditation_doc(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare
  v_case legal.accreditation_cases;
  v_doc legal.accreditation_docs;
  v_requirement_id text;
  v_version int;
  v_filename text;
  v_vendor_id uuid;
begin
  if not core.has_any_cap('submit_documents') then
    raise exception 'Not authorized: submit_documents';
  end if;

  select *
    into v_case
    from legal.accreditation_cases
   where id = payload->>'case_id'
     and (
       core.has_cap('legal', 'review_accreditation')
       or (core.is_vendor() and vendor_id = core.current_vendor_id())
     );

  if v_case.id is null then
    raise exception 'Accreditation case not found or not accessible';
  end if;

  v_requirement_id := nullif(payload->>'requirement_id', '');
  v_filename := coalesce(nullif(payload->>'filename', ''), 'document');
  v_vendor_id := coalesce(nullif(payload->>'vendor_id', '')::uuid, v_case.vendor_id);

  if core.is_vendor() and v_vendor_id <> core.current_vendor_id() then
    raise exception 'Vendor mismatch for accreditation document';
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
    from legal.accreditation_docs
   where case_id = v_case.id
     and doc_type = payload->>'doc_type'
     and coalesce(requirement_id, '') = coalesce(v_requirement_id, '');

  insert into legal.accreditation_docs (
    case_id, vendor_id, requirement_id, doc_type, filename, mime_type,
    size_bytes, storage_path, data_url, status, version, uploaded_by_email,
    expires_at
  )
  values (
    v_case.id,
    v_vendor_id,
    v_requirement_id,
    payload->>'doc_type',
    v_filename,
    coalesce(nullif(payload->>'mime_type', ''), 'application/octet-stream'),
    coalesce(nullif(payload->>'size_bytes', '')::bigint, 0),
    coalesce(
      nullif(payload->>'storage_path', ''),
      'legal/accreditation/' || v_case.id || '/' || replace(gen_random_uuid()::text, '-', '') || '_' || v_filename
    ),
    case
      when nullif(payload->>'storage_path', '') is null
      then nullif(payload->>'data_url', '')
      else null
    end,
    'submitted',
    v_version,
    coalesce(nullif(payload->>'uploaded_by_email', ''), auth.jwt() ->> 'email'),
    nullif(payload->>'expires_at', '')::date
  )
  returning * into v_doc;

  if v_requirement_id is not null then
    update legal.requirement_checklist_items
       set document_ids = case
             when v_doc.id = any(document_ids) then document_ids
             else array_append(document_ids, v_doc.id)
           end,
           updated_at = now()
     where id = v_requirement_id
       and case_id = v_case.id;
  end if;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (
    v_case.id,
    v_doc.uploaded_by_email,
    'doc_uploaded',
    v_doc.doc_type || ' - ' || v_doc.filename || ' (v' || v_doc.version || ')'
  );

  return to_jsonb(v_doc);
end;
$$;

create or replace function legal.review_checklist_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare
  v legal.requirement_checklist_items;
  v_item_id text;
  v_decision text;
  v_actor text;
  v_note text;
begin
  if not core.has_cap('legal', 'review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;

  v_item_id := coalesce(nullif(payload->>'id', ''), nullif(payload->>'item_id', ''));
  v_decision := coalesce(nullif(payload->>'decision', ''), 'pending');
  v_actor := coalesce(nullif(payload->>'reviewer_email', ''), auth.jwt() ->> 'email');
  v_note := nullif(coalesce(payload->>'reviewer_note', payload->>'note'), '');

  if v_decision not in ('pending', 'approved', 'rejected', 'na') then
    raise exception 'Invalid checklist decision: %', v_decision;
  end if;

  update legal.requirement_checklist_items
     set decision = v_decision,
         reviewer_email = v_actor,
         reviewer_note = v_note,
         reviewed_at = now(),
         updated_at = now()
   where id = v_item_id
   returning * into v;

  if v.id is null then
    raise exception 'Checklist item not found';
  end if;

  if v_decision = 'approved' then
    update legal.accreditation_docs
       set status = 'approved',
           reviewer_note = coalesce(v_note, reviewer_note)
     where case_id = v.case_id
       and status = 'submitted'
       and (requirement_id = v.id or id = any(v.document_ids));
  end if;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (
    v.case_id,
    v_actor,
    'checklist_decided',
    v.requirement || ' -> ' || v.decision
  );

  return to_jsonb(v);
end;
$$;

create or replace function legal.update_accreditation_doc_status(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare
  v_doc legal.accreditation_docs;
  v_status text;
  v_actor text;
  v_note text;
begin
  if not core.has_cap('legal', 'review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;

  v_status := payload->>'status';
  v_actor := coalesce(nullif(payload->>'actor_email', ''), auth.jwt() ->> 'email');
  v_note := nullif(payload->>'note', '');

  if v_status not in ('approved', 'rejected') then
    raise exception 'Invalid document status: %', v_status;
  end if;

  update legal.accreditation_docs
     set status = v_status,
         reviewer_note = v_note
   where id = payload->>'doc_id'
   returning * into v_doc;

  if v_doc.id is null then
    raise exception 'Accreditation document not found';
  end if;

  if v_doc.requirement_id is not null then
    update legal.requirement_checklist_items
       set decision = v_status,
           reviewer_email = v_actor,
           reviewer_note = v_note,
           reviewed_at = now(),
           updated_at = now()
     where id = v_doc.requirement_id;
  end if;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (
    v_doc.case_id,
    v_actor,
    'doc_reviewed',
    v_doc.doc_type || ' - ' || v_doc.filename || ' -> ' || v_doc.status
  );

  return to_jsonb(v_doc);
end;
$$;

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare
  v legal.accreditation_cases;
  v_status text;
  v_open_items int;
  v_missing_docs int;
  v_missing_signatures int;
begin
  if not core.has_cap('legal', 'approve_accreditation') then
    raise exception 'Not authorized: legal.approve_accreditation';
  end if;

  v_status := coalesce(nullif(payload->>'status', ''), 'approved');

  if v_status = 'approved' then
    select count(*)
      into v_open_items
      from legal.requirement_checklist_items i
     where i.case_id = payload->>'id'
       and i.required
       and i.decision not in ('approved', 'na');

    select count(*)
      into v_missing_docs
      from legal.requirement_checklist_items i
     where i.case_id = payload->>'id'
       and i.required
       and i.decision = 'approved'
       and not i.instrument
       and not exists (
         select 1
           from legal.accreditation_docs d
          where d.case_id = i.case_id
            and d.status = 'approved'
            and (d.requirement_id = i.id or d.id = any(i.document_ids))
       );

    select count(*)
      into v_missing_signatures
      from legal.requirement_checklist_items i
     where i.case_id = payload->>'id'
       and i.required
       and i.decision = 'approved'
       and i.instrument
       and not exists (
         select 1
           from legal.signed_instruments s
          where s.case_id = i.case_id
            and s.revoked_at is null
            and (s.code = i.instrument_code or s.code = i.code)
       );

    if v_open_items > 0 or v_missing_docs > 0 or v_missing_signatures > 0 then
      raise exception
        'Accreditation cannot be approved until all required checklist items, documents, and signatures are approved';
    end if;
  end if;

  update legal.accreditation_cases
     set status = v_status,
         decided_at = now(),
         decided_by_email = coalesce(payload->>'actor', auth.jwt() ->> 'email'),
         decision_note = nullif(payload->>'note', ''),
         expires_at = nullif(payload->>'expires_at', '')::date,
         scope = nullif(payload->>'scope', ''),
         updated_at = now()
   where id = payload->>'id'
   returning * into v;

  if v.id is null then
    raise exception 'Accreditation case not found';
  end if;

  update core.vendors
     set accreditation_status = v.status,
         accreditation_expires_at = v.expires_at
   where id = v.vendor_id;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (v.id, v.decided_by_email, v.status, coalesce(v.decision_note, 'Decision recorded'));

  return to_jsonb(v);
end;
$$;

-- ---------------------------------------------------------------------------
-- Warehouse event/bin RPCs and direct-write lockdown
-- ---------------------------------------------------------------------------
drop policy if exists events_insert on warehouse.events;
create policy events_insert on warehouse.events
  for insert to authenticated
  with check (core.has_cap('warehouse', 'reserve_allocate'));

create or replace function warehouse.create_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, core, public
as $$
declare
  v_event warehouse.events;
begin
  if not core.has_cap('warehouse', 'reserve_allocate') then
    raise exception 'Not authorized: reserve_allocate';
  end if;

  insert into warehouse.events
  select * from jsonb_populate_record(null::warehouse.events, payload->'event')
  returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

create or replace function warehouse.create_storage_area(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, core, public
as $$
declare
  v_area warehouse.storage_areas;
begin
  if not core.has_cap('warehouse', 'manage_locations') then
    raise exception 'Not authorized: manage_locations';
  end if;

  if not exists (
    select 1 from warehouse.locations where id = payload#>>'{storage_area,location_id}'
  ) then
    raise exception 'Warehouse location not found';
  end if;

  insert into warehouse.storage_areas
  select * from jsonb_populate_record(null::warehouse.storage_areas, payload->'storage_area')
  returning * into v_area;

  return to_jsonb(v_area);
end;
$$;

create or replace function warehouse.update_storage_area(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, core, public
as $$
declare
  v_area warehouse.storage_areas;
begin
  if not core.has_cap('warehouse', 'manage_locations') then
    raise exception 'Not authorized: manage_locations';
  end if;

  update warehouse.storage_areas
     set code = coalesce(nullif(payload#>>'{patch,code}', ''), code),
         label = case when payload->'patch' ? 'label' then nullif(payload#>>'{patch,label}', '') else label end,
         zone = case when payload->'patch' ? 'zone' then nullif(payload#>>'{patch,zone}', '') else zone end,
         active = case when payload->'patch' ? 'active' then (payload#>>'{patch,active}')::boolean else active end
   where id = payload->>'storage_area_id'
   returning * into v_area;

  if v_area.id is null then
    raise exception 'Storage area not found';
  end if;

  return to_jsonb(v_area);
end;
$$;

drop policy if exists storage_areas_insert on warehouse.storage_areas;
drop policy if exists storage_areas_update on warehouse.storage_areas;
drop policy if exists storage_areas_delete on warehouse.storage_areas;

revoke insert, update, delete on
  warehouse.events,
  warehouse.storage_areas
from authenticated;

grant usage on schema legal, warehouse to authenticated, service_role;
grant select on
  legal.accreditation_cases,
  legal.requirement_checklist_items,
  legal.accreditation_docs,
  legal.case_timeline,
  legal.signed_instruments,
  warehouse.events,
  warehouse.storage_areas
to authenticated, service_role;

do $$
begin
  revoke all on function legal.upload_accreditation_doc(jsonb) from public, anon;
  grant execute on function legal.upload_accreditation_doc(jsonb) to authenticated, service_role;
  revoke all on function legal.review_checklist_item(jsonb) from public, anon;
  grant execute on function legal.review_checklist_item(jsonb) to authenticated, service_role;
  revoke all on function legal.update_accreditation_doc_status(jsonb) from public, anon;
  grant execute on function legal.update_accreditation_doc_status(jsonb) to authenticated, service_role;
  revoke all on function legal.approve_accreditation_case(jsonb) from public, anon;
  grant execute on function legal.approve_accreditation_case(jsonb) to authenticated, service_role;

  revoke all on function warehouse.create_event(jsonb) from public, anon;
  grant execute on function warehouse.create_event(jsonb) to authenticated, service_role;
  revoke all on function warehouse.create_storage_area(jsonb) from public, anon;
  grant execute on function warehouse.create_storage_area(jsonb) to authenticated, service_role;
  revoke all on function warehouse.update_storage_area(jsonb) from public, anon;
  grant execute on function warehouse.update_storage_area(jsonb) to authenticated, service_role;
end $$;

select pg_notify('pgrst', 'reload schema');
