-- Mwell Intra — rate limits + document upload validation (additions beyond spec)
--
-- Adds a small, in-database sliding-hour rate limiter that public-facing RPCs
-- can call, and a MIME/size validator for document uploads. Both are minimal,
-- idempotent, and cost nothing when unused.

-- ---------------------------------------------------------------------------
-- 1) Rate limit bucket table
-- ---------------------------------------------------------------------------
create table if not exists core.rate_limits (
  bucket       text not null,
  actor        uuid not null,
  window_start timestamptz not null,
  count        int  not null default 0,
  primary key (bucket, actor, window_start)
);

create index if not exists rate_limits_actor_idx on core.rate_limits (actor);

-- Sliding-hour counter. Truncates now() to the hour so each actor gets one
-- bucket row per hour per named bucket. Raises when the count would exceed
-- max_per_hour. SECURITY DEFINER: writes to a private table.
create or replace function core.check_rate_limit(p_bucket text, p_max_per_hour int)
returns void language plpgsql security definer set search_path = core, public as $$
declare
  v_window timestamptz := date_trunc('hour', now());
  v_actor  uuid := auth.uid();
  v_count  int;
begin
  if v_actor is null then raise exception 'Not authenticated'; end if;
  insert into core.rate_limits (bucket, actor, window_start, count)
  values (p_bucket, v_actor, v_window, 1)
  on conflict (bucket, actor, window_start) do update set
    count = core.rate_limits.count + 1
  returning count into v_count;
  if v_count > p_max_per_hour then
    raise exception 'Rate limit exceeded for %: % / hour', p_bucket, p_max_per_hour
      using errcode = 'insufficient_privilege';
  end if;
end; $$;

revoke all on function core.check_rate_limit(text, int) from public, anon;
grant execute on function core.check_rate_limit(text, int) to authenticated, service_role;

-- Nightly purge (called by pg_cron if scheduled — no-op if no old rows).
create or replace function core.job_purge_old_rate_limits()
returns void language sql security definer set search_path = core as $$
  delete from core.rate_limits
   where window_start < now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- 2) Document upload validation (MIME whitelist + size cap)
-- ---------------------------------------------------------------------------
create or replace function core.assert_document_valid(p_mime text, p_size_bytes bigint)
returns void language plpgsql immutable as $$
begin
  if p_size_bytes is null or p_size_bytes < 0 then
    raise exception 'Invalid document size';
  end if;
  if p_size_bytes > 10485760 then
    raise exception 'Document too large: % bytes (max 10 MiB)', p_size_bytes;
  end if;
  if p_mime is null or p_mime not in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  ) then
    raise exception 'Unsupported document MIME type: %', coalesce(p_mime, '(null)');
  end if;
end; $$;

revoke all on function core.assert_document_valid(text, bigint) from public, anon;
grant execute on function core.assert_document_valid(text, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Wire into register_document (rate-limit vendors to 100 uploads/hour)
-- ---------------------------------------------------------------------------
-- Overrides the register_document body from 20260706090800_core_rpcs.sql to
-- (a) rate-limit vendor callers and (b) validate MIME + size when the payload
-- carries them. Internal callers (manage_documents) skip the rate limit; the
-- MIME/size check runs whenever payload has 'mime_type' + 'size_bytes'.
create or replace function core.register_document(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.documents; v_entity_type text; v_entity_id uuid;
begin
  if not (core.has_any_cap('manage_documents') or core.has_any_cap('submit_documents')) then
    raise exception 'Not authorized: manage_documents';
  end if;
  v_entity_type := payload->>'entity_type';
  v_entity_id := (payload->>'entity_id')::uuid;
  if v_entity_type is null or v_entity_id is null then
    raise exception 'entity_type and entity_id are required';
  end if;
  if core.is_vendor() then
    if v_entity_type <> 'vendor' or v_entity_id is distinct from core.current_vendor_id() then
      raise exception 'Vendors may only register documents for their own vendor record.';
    end if;
    perform core.check_rate_limit('register_document.vendor', 100);
  end if;
  if payload ? 'mime_type' or payload ? 'size_bytes' then
    perform core.assert_document_valid(
      payload->>'mime_type',
      nullif(payload->>'size_bytes','')::bigint
    );
  end if;
  insert into core.documents (
    entity_type, entity_id, doc_type, storage_path, version, status, expires_at, uploaded_by
  ) values (
    v_entity_type, v_entity_id, payload->>'doc_type', payload->>'storage_path',
    coalesce((payload->>'version')::int, 1),
    coalesce(nullif(payload->>'status',''), 'submitted'),
    nullif(payload->>'expires_at','')::date,
    auth.uid()
  )
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    coalesce(nullif(payload->>'module',''), 'core'), 'document', v.id, 'created', auth.uid(),
    jsonb_build_object('entity_type', v.entity_type, 'entity_id', v.entity_id,
                       'doc_type', v.doc_type, 'version', v.version,
                       'storage_path', v.storage_path)
  );
  return to_jsonb(v);
end; $$;

revoke all on function core.register_document(jsonb) from public, anon;
grant execute on function core.register_document(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Rate-limit procurement.create_request (50/hr per user)
-- ---------------------------------------------------------------------------
create or replace function procurement.create_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.requests;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  perform core.check_rate_limit('procurement.create_request', 50);
  insert into procurement.requests (
    title, description, requester_id, department, status, core_vendor_id, estimated_amount
  ) values (
    payload->>'title',
    nullif(payload->>'description', ''),
    auth.uid(),
    nullif(payload->>'department', ''),
    coalesce(nullif(payload->>'status', ''), 'draft'),
    nullif(payload->>'core_vendor_id', '')::uuid,
    nullif(payload->>'estimated_amount', '')::numeric
  ) returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'created', auth.uid(),
          jsonb_build_object('title', v.title, 'status', v.status));
  return to_jsonb(v);
end; $$;

notify pgrst, 'reload schema';
