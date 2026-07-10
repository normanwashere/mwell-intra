insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'warehouse-exports',
  'warehouse-exports',
  false,
  52428800,
  array['text/csv']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists warehouse.export_jobs (
  id text primary key,
  export_type text not null,
  filename text not null,
  storage_path text not null unique,
  checksum_sha256 text not null,
  row_count integer not null,
  status text not null default 'ready',
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references core.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  corrected_from text references warehouse.export_jobs(id) on delete restrict,
  constraint warehouse_export_type_check
    check (export_type in ('inventory', 'movements', 'allocations')),
  constraint warehouse_export_filename_check
    check (filename ~ '^mwell-intra-(inventory|movements|allocations)-[0-9]{8}T[0-9]{6}Z\\.csv$'),
  constraint warehouse_export_checksum_check
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint warehouse_export_row_count_check check (row_count >= 0),
  constraint warehouse_export_status_check
    check (status in ('ready', 'reviewed', 'correction_required', 'superseded')),
  constraint warehouse_export_review_check check (
    (status = 'ready' and reviewed_by is null and reviewed_at is null)
    or (status <> 'ready' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists warehouse_export_jobs_created_idx
  on warehouse.export_jobs(created_at desc);
create index if not exists warehouse_export_jobs_creator_idx
  on warehouse.export_jobs(created_by, created_at desc);
create index if not exists warehouse_export_jobs_reviewer_idx
  on warehouse.export_jobs(reviewed_by)
  where reviewed_by is not null;
create index if not exists warehouse_export_jobs_correction_idx
  on warehouse.export_jobs(corrected_from)
  where corrected_from is not null;

alter table warehouse.export_jobs enable row level security;
alter table warehouse.export_jobs force row level security;

drop policy if exists warehouse_export_jobs_read on warehouse.export_jobs;
create policy warehouse_export_jobs_read
  on warehouse.export_jobs
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  );

revoke all on warehouse.export_jobs from public, anon, authenticated;
grant select on warehouse.export_jobs to authenticated;
grant all on warehouse.export_jobs to service_role;

drop policy if exists warehouse_exports_read on storage.objects;
create policy warehouse_exports_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'warehouse-exports'
    and (
      owner_id = auth.uid()::text
      or core.has_cap('warehouse', 'view_analytics')
      or core.has_cap('warehouse', 'view_finance')
    )
  );

drop policy if exists warehouse_exports_insert on storage.objects;
create policy warehouse_exports_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'warehouse-exports'
    and (
      core.has_cap('warehouse', 'view_analytics')
      or core.has_cap('warehouse', 'view_finance')
    )
    and (storage.foldername(name))[1] = 'exports'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists warehouse_exports_orphan_cleanup on storage.objects;
create policy warehouse_exports_orphan_cleanup
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'warehouse-exports'
    and owner_id = auth.uid()::text
    and not exists (
      select 1
        from warehouse.export_jobs j
       where j.storage_path = name
    )
  );

create or replace function warehouse.register_export_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job warehouse.export_jobs;
  v_id text := nullif(payload->>'id', '');
  v_kind text := nullif(payload->>'export_type', '');
  v_path text := nullif(payload->>'storage_path', '');
  v_corrected_from text := nullif(payload->>'corrected_from', '');
begin
  if not (
    core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  ) then
    raise exception 'Not authorized: warehouse.register_export_job';
  end if;
  if v_id is null or v_id !~ '^exp_[A-Za-z0-9_-]{12,}$' then
    raise exception 'Invalid export id';
  end if;
  if v_kind not in ('inventory', 'movements', 'allocations') then
    raise exception 'Invalid export type';
  end if;
  if v_path is null or v_path not like 'exports/' || auth.uid()::text || '/%' then
    raise exception 'Export path is outside the user scope';
  end if;
  if lower(coalesce(payload->>'checksum_sha256', '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid SHA-256 checksum is required';
  end if;
  if v_corrected_from is not null and not exists (
    select 1
      from warehouse.export_jobs j
     where j.id = v_corrected_from
       and j.status = 'correction_required'
       and j.export_type = v_kind
  ) then
    raise exception 'Correction source is not eligible or does not match the export type';
  end if;

  insert into warehouse.export_jobs (
    id,
    export_type,
    filename,
    storage_path,
    checksum_sha256,
    row_count,
    created_by,
    created_by_email,
    corrected_from
  ) values (
    v_id,
    v_kind,
    payload->>'filename',
    v_path,
    lower(payload->>'checksum_sha256'),
    coalesce(nullif(payload->>'row_count', '')::integer, 0),
    auth.uid(),
    coalesce(auth.jwt()->>'email', ''),
    v_corrected_from
  )
  returning * into v_job;

  if v_job.corrected_from is not null then
    update warehouse.export_jobs
       set status = 'superseded',
           review_note = concat_ws('; ', review_note, 'Superseded by ' || v_job.id)
     where id = v_job.corrected_from
       and status = 'correction_required';
  end if;

  insert into core.activity_log (
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'warehouse', 'export_job', v_job.id, 'created', auth.uid(),
    jsonb_build_object(
      'export_type', v_job.export_type,
      'row_count', v_job.row_count,
      'checksum_sha256', v_job.checksum_sha256
    )
  );

  return to_jsonb(v_job);
end;
$$;

create or replace function warehouse.prepare_export_download(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job warehouse.export_jobs;
begin
  select *
    into v_job
    from warehouse.export_jobs j
   where j.id = payload->>'export_id';
  if not found then
    raise exception 'Export not found';
  end if;
  if not (
    v_job.created_by = auth.uid()
    or core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  ) then
    raise exception 'Not authorized: warehouse.prepare_export_download';
  end if;

  insert into core.activity_log (
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'warehouse', 'export_job', v_job.id, 'download_prepared', auth.uid(),
    jsonb_build_object('status', v_job.status, 'checksum_sha256', v_job.checksum_sha256)
  );

  return jsonb_build_object(
    'storage_path', v_job.storage_path,
    'filename', v_job.filename,
    'checksum_sha256', v_job.checksum_sha256,
    'expires_in', 60
  );
end;
$$;

create or replace function warehouse.review_export_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job warehouse.export_jobs;
  v_status text := nullif(payload->>'status', '');
  v_note text := left(coalesce(nullif(payload->>'review_note', ''), ''), 1000);
begin
  if not core.has_cap('warehouse', 'view_finance') then
    raise exception 'Not authorized: warehouse.review_export_job';
  end if;
  if v_status not in ('reviewed', 'correction_required') then
    raise exception 'Invalid export review status';
  end if;
  if v_status = 'correction_required' and v_note = '' then
    raise exception 'A review note is required for corrections';
  end if;

  update warehouse.export_jobs
     set status = v_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(v_note, '')
   where id = payload->>'export_id'
     and status = 'ready'
     and created_by <> auth.uid()
  returning * into v_job;
  if not found then
    raise exception 'Ready export not found or creator cannot review own export';
  end if;

  insert into core.activity_log (
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'warehouse', 'export_job', v_job.id, v_status, auth.uid(),
    jsonb_build_object('review_note', v_job.review_note)
  );

  return to_jsonb(v_job);
end;
$$;

revoke all on function warehouse.register_export_job(jsonb) from public, anon;
revoke all on function warehouse.prepare_export_download(jsonb) from public, anon;
revoke all on function warehouse.review_export_job(jsonb) from public, anon;
grant execute on function warehouse.register_export_job(jsonb) to authenticated;
grant execute on function warehouse.prepare_export_download(jsonb) to authenticated;
grant execute on function warehouse.review_export_job(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
