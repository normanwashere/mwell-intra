-- A batch delegates every selected item to the certified inspection dispatcher.
-- No inner exception handlers: any failed item rolls back the entire transaction.
create or replace function private.warehouse_inspect_quality_batch(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_items jsonb := payload->'items';
  v_first jsonb;
  v_item jsonb;
  v_started jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_identity text;
  v_seen text[] := array[]::text[];
  v_index integer := 0;
  v_key text := payload->>'idempotency_key';
  v_evidence text;
  v_object_path text;
begin
  if auth.uid() is null or not core.has_live_cap('warehouse', 'inspect_quality') then
    raise exception 'You do not have permission to inspect stock.' using errcode = '42501';
  end if;
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{12,100}$' then
    raise exception 'A valid batch retry key is required.';
  end if;
  if pg_catalog.jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'Select between 1 and 50 inspections.';
  end if;
  if pg_catalog.jsonb_array_length(v_items) not between 1 and 50 then
    raise exception 'Select between 1 and 50 inspections.';
  end if;
  if payload->>'disposition' is null or payload->>'disposition' not in ('accepted','damaged','hold','vendor_return','unavailable') then
    raise exception 'Choose an inspection result.';
  end if;
  if payload->>'disposition' <> 'accepted' and nullif(pg_catalog.btrim(payload->>'reason'), '') is null then
    raise exception 'Add a reason for this inspection result.';
  end if;
  if pg_catalog.jsonb_typeof(payload->'evidence_urls') is distinct from 'array' then
    raise exception 'Attach inspection evidence for this batch.';
  end if;
  if pg_catalog.jsonb_array_length(payload->'evidence_urls') not between 1 and 20
     or exists (select 1 from pg_catalog.jsonb_array_elements(payload->'evidence_urls') evidence
       where pg_catalog.jsonb_typeof(evidence) <> 'string' or nullif(pg_catalog.btrim(evidence #>> '{}'), '') is null) then
    raise exception 'Attach inspection evidence for this batch.';
  end if;
  v_first := v_items->0;
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
      or v_item->>'source_type' is null or v_item->>'source_type' not in ('receipt','return')
      or nullif(v_item->>'source_id','') is null or nullif(v_item->>'product_id','') is null then
      raise exception 'The inspection source is missing. Refresh the queue.';
    end if;
    if exists (select 1 from pg_catalog.unnest(array['source_type','source_id','product_id','procurement_po_line_id','bin_id','lot_id']) field
        where nullif(v_item->>field,'') is distinct from nullif(v_first->>field,'')) then
      raise exception 'Select items from the same source, product, PO line, bin and lot.';
    end if;
    v_identity := coalesce(nullif(pg_catalog.upper(pg_catalog.btrim(v_item->>'serial_number')), ''), '');
    if v_identity = any(v_seen) then raise exception 'The same inspection was selected more than once.'; end if;
    v_seen := pg_catalog.array_append(v_seen, v_identity);
    if coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]*$'
      or (v_item->>'quantity')::numeric > 2147483647
      or (v_identity <> '' and (v_item->>'quantity')::integer <> 1) then
      raise exception 'Each serial must have a quantity of one. Bulk quantities must be positive whole numbers.';
    end if;
  end loop;
  v_started := private.begin_idempotent_command('inspect_quality_batch', v_key, payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  -- Attaching a path can grant readers access later. Only this actor's real
  -- private uploads may create a new attachment; read visibility is not authority.
  for v_evidence in select value from pg_catalog.jsonb_array_elements_text(payload->'evidence_urls') loop
    v_object_path := case when v_evidence like 'evidence/%' then pg_catalog.substr(v_evidence,10) else v_evidence end;
    if v_object_path !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$'
       or exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(v_object_path,'/')) segment where segment in ('.','..')) then
      raise exception 'Upload the inspection photos using your account, then try again.' using errcode = '42501';
    end if;
    perform 1 from storage.objects o
      where o.bucket_id = 'evidence' and o.name = v_object_path
        and coalesce(o.owner_id,o.owner::text) = auth.uid()::text
        and (o.owner is null or o.owner = auth.uid())
      for key share;
    if not found then
      raise exception 'Upload the inspection photos using your account, then try again.' using errcode = '42501';
    end if;
  end loop;
  -- All items share one custody source. Underlying commands retain their row locks.
  for v_item in select value from pg_catalog.jsonb_array_elements(v_items) loop
    v_result := warehouse.inspect_quality(v_item || pg_catalog.jsonb_build_object(
      'idempotency_key', 'qb-' || v_key || '-' || v_index::text,
      'disposition', payload->>'disposition', 'reason', payload->>'reason',
      'evidence_urls', payload->'evidence_urls'));
    if pg_catalog.jsonb_typeof(v_result->'inspection') is distinct from 'object' then
      raise exception 'The inspection confirmation is incomplete. The batch was not saved.';
    end if;
    v_results := v_results || pg_catalog.jsonb_build_array(v_result->'inspection');
    v_index := v_index + 1;
  end loop;
  return private.finish_idempotent_command((v_started->>'command_id')::uuid,
    pg_catalog.jsonb_build_object('inspections', v_results));
end;
$$;

create or replace function warehouse.inspect_quality_batch(payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.warehouse_inspect_quality_batch(payload);
$$;
revoke all on function private.warehouse_inspect_quality_batch(jsonb), warehouse.inspect_quality_batch(jsonb) from public, anon;
grant execute on function private.warehouse_inspect_quality_batch(jsonb), warehouse.inspect_quality_batch(jsonb) to authenticated;
