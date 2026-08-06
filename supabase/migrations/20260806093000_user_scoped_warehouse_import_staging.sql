-- Stage Warehouse imports through the authenticated user's governed session.
-- This removes the need for a database-wide secret in the web application.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'warehouse-imports',
  'warehouse-imports',
  false,
  10485760,
  array['text/csv', 'application/vnd.ms-excel']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists warehouse_import_objects_insert on storage.objects;
create policy warehouse_import_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'warehouse-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and core.has_cap('warehouse', 'import_warehouse_data')
  );

drop policy if exists warehouse_import_objects_read on storage.objects;
create policy warehouse_import_objects_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'warehouse-imports'
    and core.has_cap('warehouse', 'import_warehouse_data')
  );

drop policy if exists warehouse_import_objects_delete_own on storage.objects;
create policy warehouse_import_objects_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'warehouse-imports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and core.has_cap('warehouse', 'import_warehouse_data')
  );

create or replace function warehouse.stage_import_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job warehouse.import_jobs;
  v_issue jsonb;
  v_source_rows integer;
  v_accepted_rows integer;
  v_rejected_rows integer;
  v_duplicate_rows integer;
begin
  if not core.has_cap('warehouse', 'import_warehouse_data') then
    raise exception 'Not authorized: warehouse.import_warehouse_data';
  end if;
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if payload ->> 'import_kind' not in ('locations_bins_v1', 'products_opening_stock_v1') then
    raise exception 'Invalid import kind';
  end if;
  if payload ->> 'status' not in ('invalid', 'ready') then
    raise exception 'Staged import status must be invalid or ready';
  end if;
  if coalesce(payload ->> 'storage_path', '') not like auth.uid()::text || '/%' then
    raise exception 'Import storage path must belong to the authenticated user';
  end if;
  if coalesce(payload ->> 'checksum_sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Import checksum is invalid';
  end if;
  if jsonb_typeof(coalesce(payload -> 'issues', '[]'::jsonb)) <> 'array' then
    raise exception 'Import issues must be an array';
  end if;

  begin
    v_source_rows := (payload ->> 'source_rows')::integer;
    v_accepted_rows := (payload ->> 'accepted_rows')::integer;
    v_rejected_rows := (payload ->> 'rejected_rows')::integer;
    v_duplicate_rows := (payload ->> 'duplicate_rows')::integer;
  exception when others then
    raise exception 'Import counts must be whole numbers';
  end;
  if v_source_rows <> v_accepted_rows + v_rejected_rows + v_duplicate_rows then
    raise exception 'Import row reconciliation mismatch';
  end if;

  insert into warehouse.import_jobs(
    import_kind, schema_version, filename, storage_path, checksum_sha256,
    source_rows, accepted_rows, rejected_rows, duplicate_rows, status,
    created_by, created_by_email, corrected_from
  ) values (
    payload ->> 'import_kind',
    coalesce(nullif(payload ->> 'schema_version', ''), '1'),
    payload ->> 'filename',
    payload ->> 'storage_path',
    payload ->> 'checksum_sha256',
    v_source_rows,
    v_accepted_rows,
    v_rejected_rows,
    v_duplicate_rows,
    payload ->> 'status',
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    nullif(payload ->> 'corrected_from', '')::uuid
  ) returning * into v_job;

  for v_issue in
    select value from jsonb_array_elements(coalesce(payload -> 'issues', '[]'::jsonb))
  loop
    insert into warehouse.import_errors(
      import_job_id, row_number, field_name, error_code, message
    ) values (
      v_job.id,
      greatest(1, (v_issue ->> 'row_number')::integer),
      coalesce(v_issue ->> 'field_name', ''),
      coalesce(v_issue ->> 'error_code', 'validation'),
      coalesce(v_issue ->> 'message', 'Import validation failed')
    );
  end loop;

  return to_jsonb(v_job);
end;
$$;

revoke all on function warehouse.stage_import_job(jsonb) from public, anon;
grant execute on function warehouse.stage_import_job(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
