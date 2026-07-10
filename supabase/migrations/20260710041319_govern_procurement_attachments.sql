insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'procurement-requests',
  'procurement-requests',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists procurement.request_attachments (
  id text primary key,
  request_id text not null references procurement.requests(id) on delete cascade,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  sha256 text not null,
  kind text,
  uploaded_by uuid references core.profiles(id) on delete set null,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  constraint request_attachments_size_check
    check (size_bytes > 0 and size_bytes <= 10485760),
  constraint request_attachments_mime_check
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  constraint request_attachments_sha256_check
    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint request_attachments_kind_check
    check (
      kind is null or kind in (
        'budget', 'previous_cost', 'spec', 'quote', 'award_recommendation',
        'justification', 'bond', 'brochure', 'other'
      )
    )
);

create index if not exists request_attachments_request_idx
  on procurement.request_attachments(request_id);

alter table procurement.request_attachments enable row level security;
alter table procurement.request_attachments force row level security;

drop policy if exists request_attachments_read on procurement.request_attachments;
create policy request_attachments_read
  on procurement.request_attachments
  for select
  to authenticated
  using (
    core.has_cap('procurement', 'view_dashboard')
    or exists (
      select 1
        from procurement.requests r
       where r.id = request_id
         and r.requester_id = auth.uid()
    )
  );

revoke all on procurement.request_attachments from public, anon, authenticated;
grant select on procurement.request_attachments to authenticated;
grant all on procurement.request_attachments to service_role;

drop policy if exists procurement_requests_auth_read on storage.objects;
create policy procurement_requests_auth_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'procurement-requests'
    and (
      owner_id = auth.uid()::text
      or core.has_cap('procurement', 'view_dashboard')
      or exists (
        select 1
          from procurement.request_attachments a
          join procurement.requests r on r.id = a.request_id
         where a.storage_path = name
           and r.requester_id = auth.uid()
      )
    )
  );

drop policy if exists procurement_requests_auth_write on storage.objects;
drop policy if exists procurement_requests_auth_insert on storage.objects;
create policy procurement_requests_auth_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'procurement-requests'
    and core.has_cap('procurement', 'create_request')
    and (storage.foldername(name))[1] = 'request'
    and (storage.foldername(name))[2] ~ '^req_[A-Za-z0-9_-]{8,}$'
  );

drop policy if exists procurement_requests_unregistered_cleanup on storage.objects;
create policy procurement_requests_unregistered_cleanup
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'procurement-requests'
    and owner_id = auth.uid()::text
    and not exists (
      select 1
        from procurement.request_attachments a
       where a.storage_path = name
    )
  );

create or replace function procurement.create_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v procurement.requests;
  v_id text;
  v_att jsonb;
  v_attachments jsonb := '[]'::jsonb;
  v_size bigint;
  v_storage_path text;
  v_mime text;
  v_checksum text;
  v_attachment_id text;
  v_uploaded_at timestamptz;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;

  v_id := coalesce(
    nullif(payload->>'id', ''),
    'req_' || replace(gen_random_uuid()::text, '-', '')
  );
  if v_id !~ '^req_[A-Za-z0-9_-]{8,}$' then
    raise exception 'Invalid request id';
  end if;

  if jsonb_typeof(coalesce(payload->'attachments', '[]'::jsonb)) <> 'array' then
    raise exception 'attachments must be an array';
  end if;

  for v_att in
    select value from jsonb_array_elements(coalesce(payload->'attachments', '[]'::jsonb))
  loop
    if v_att ? 'dataUrl' or v_att ? 'data_url' or v_att ? 'file' then
      raise exception 'Attachment bytes must be uploaded to private Storage';
    end if;
    v_attachment_id := nullif(v_att->>'id', '');
    v_mime := nullif(v_att->>'mime_type', '');
    v_size := nullif(v_att->>'size_bytes', '')::bigint;
    v_storage_path := nullif(v_att->>'storage_path', '');
    v_checksum := lower(nullif(v_att->>'sha256', ''));
    v_uploaded_at := coalesce(nullif(v_att->>'uploaded_at', '')::timestamptz, now());

    if v_attachment_id is null or nullif(v_att->>'filename', '') is null then
      raise exception 'Each attachment requires id and filename';
    end if;
    if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
      raise exception 'Unsupported attachment MIME type';
    end if;
    if v_size is null or v_size <= 0 or v_size > 10485760 then
      raise exception 'Attachment size must be between 1 byte and 10 MB';
    end if;
    if v_storage_path is null or v_storage_path not like 'request/' || v_id || '/%' then
      raise exception 'Attachment path is outside the request scope';
    end if;
    if v_checksum is null or v_checksum !~ '^[0-9a-f]{64}$' then
      raise exception 'Attachment SHA-256 checksum is required';
    end if;

    v_attachments := v_attachments || jsonb_build_array(
      jsonb_build_object(
        'id', v_attachment_id,
        'filename', v_att->>'filename',
        'mimeType', v_mime,
        'sizeBytes', v_size,
        'storagePath', v_storage_path,
        'sha256', v_checksum,
        'uploadedAt', v_uploaded_at,
        'uploadedByEmail', coalesce(v_att->>'uploaded_by_email', auth.jwt()->>'email'),
        'kind', nullif(v_att->>'kind', '')
      )
    );
  end loop;

  insert into procurement.requests (
    id,
    title,
    description,
    requester_id,
    requester_name,
    requester_email,
    department,
    cost_center,
    project_code,
    budget_code,
    needed_by,
    core_vendor_id,
    vendor_name,
    estimated_amount,
    category,
    sourcing_method,
    sourcing_override,
    justification,
    attachments,
    compliance,
    lines
  ) values (
    v_id,
    payload->>'title',
    nullif(payload->>'description', ''),
    auth.uid(),
    nullif(payload->>'requester_name', ''),
    coalesce(nullif(payload->>'requester_email', ''), auth.jwt()->>'email'),
    nullif(payload->>'department', ''),
    nullif(payload->>'cost_center', ''),
    nullif(payload->>'project_code', ''),
    nullif(payload->>'budget_code', ''),
    nullif(payload->>'needed_by', '')::date,
    nullif(payload->>'vendor_id', '')::uuid,
    nullif(payload->>'vendor_name', ''),
    nullif(payload->>'estimated_amount', '')::numeric,
    nullif(payload->>'category', ''),
    nullif(payload->>'sourcing_method', ''),
    coalesce(nullif(payload->>'sourcing_override', '')::boolean, false),
    payload->'justification',
    v_attachments,
    payload->'compliance',
    coalesce(payload->'lines', '[]'::jsonb)
  )
  returning * into v;

  for v_att in select value from jsonb_array_elements(v_attachments)
  loop
    insert into procurement.request_attachments (
      id,
      request_id,
      filename,
      mime_type,
      size_bytes,
      storage_path,
      sha256,
      kind,
      uploaded_by,
      uploaded_by_email,
      uploaded_at
    ) values (
      v_att->>'id',
      v.id,
      v_att->>'filename',
      v_att->>'mimeType',
      (v_att->>'sizeBytes')::bigint,
      v_att->>'storagePath',
      v_att->>'sha256',
      nullif(v_att->>'kind', ''),
      auth.uid(),
      v_att->>'uploadedByEmail',
      (v_att->>'uploadedAt')::timestamptz
    );
  end loop;

  insert into core.activity_log (
    module,
    entity_type,
    entity_id,
    action,
    actor,
    detail
  ) values (
    'procurement',
    'request',
    v.id,
    'created',
    auth.uid(),
    jsonb_build_object(
      'title', v.title,
      'attachment_count', jsonb_array_length(v_attachments)
    )
  );

  return to_jsonb(v);
end;
$$;

revoke all on function procurement.create_request(jsonb) from public, anon;
grant execute on function procurement.create_request(jsonb)
  to authenticated, service_role;

create or replace function procurement.prepare_request_attachment_access(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v procurement.request_attachments;
begin
  select a.*
    into v
    from procurement.request_attachments a
    join procurement.requests r on r.id = a.request_id
   where a.id = payload->>'attachment_id'
     and (
       r.requester_id = auth.uid()
       or core.has_cap('procurement', 'view_dashboard')
     );

  if not found then
    raise exception 'Attachment not found or not accessible';
  end if;

  insert into core.activity_log (
    module,
    entity_type,
    entity_id,
    action,
    actor,
    detail
  ) values (
    'procurement',
    'request_attachment',
    v.id,
    'download_prepared',
    auth.uid(),
    jsonb_build_object('request_id', v.request_id, 'sha256', v.sha256)
  );

  return jsonb_build_object(
    'bucket', 'procurement-requests',
    'storage_path', v.storage_path,
    'filename', v.filename,
    'sha256', v.sha256,
    'expires_in', 60
  );
end;
$$;

revoke all on function procurement.prepare_request_attachment_access(jsonb)
  from public, anon;
grant execute on function procurement.prepare_request_attachment_access(jsonb)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
