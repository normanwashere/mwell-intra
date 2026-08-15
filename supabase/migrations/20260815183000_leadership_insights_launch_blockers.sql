-- Leadership / Insights launch blockers.
-- Forward-only: do not fold this into the shared authority remediation.

drop view if exists core.v_insights_snapshot;
alter function core.insights_snapshot() rename to insights_snapshot_pre_leadership_launch;

create function core.insights_snapshot()
returns table(
  id text,
  area text,
  label text,
  value numeric,
  unit text,
  target_direction text,
  target_min numeric,
  target_max numeric,
  data_status text,
  sample_count bigint,
  detail text,
  source_href text,
  reporting_period_start timestamptz,
  reporting_period_end timestamptz,
  source_updated_at timestamptz,
  extracted_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  with projected as (
    select prior.*
    from core.insights_snapshot_pre_leadership_launch() prior
    where prior.id <> 'pr-cycle'

    union all

    select
      'pr-cycle'::text,
      'procurement'::text,
      'Average PR-to-PO cycle'::text,
      case
        when count(*) = 0 then null
        else round(
          avg(extract(epoch from (first_po.first_issued_at - r.submitted_at)) / 86400)::numeric,
          1
        )
      end,
      ' days'::text,
      'maximum'::text,
      null::numeric,
      5::numeric,
      case when count(*) = 0 then 'no_data' else 'current' end::text,
      count(*)::bigint,
      'Elapsed time from approved PR submission to its first issued PO'::text,
      '/procurement/purchase-orders'::text,
      current_timestamp - interval '90 days',
      current_timestamp,
      max(greatest(r.updated_at, first_po.source_updated_at)),
      current_timestamp
    from procurement.requests r
    join lateral (
      select
        min(po.issued_at) as first_issued_at,
        max(po.updated_at) as source_updated_at
      from procurement.purchase_orders po
      where po.request_id = r.id
        and po.issued_at is not null
    ) first_po on first_po.first_issued_at is not null
    where r.status = 'approved'
      and r.submitted_at is not null
      and r.submitted_at >= current_timestamp - interval '90 days'
    having core.has_cap('insights', 'view_procurement')
  )
  select
    projected.id,
    projected.area,
    projected.label,
    projected.value,
    projected.unit,
    projected.target_direction,
    projected.target_min,
    projected.target_max,
    case
      when projected.data_status in ('no_data', 'incomplete') then projected.data_status
      when projected.source_updated_at is null then 'incomplete'
      when projected.source_updated_at < current_timestamp - interval '24 hours' then 'stale'
      else 'current'
    end,
    projected.sample_count,
    projected.detail,
    projected.source_href,
    projected.reporting_period_start,
    projected.reporting_period_end,
    projected.source_updated_at,
    current_timestamp
  from projected;
$$;

revoke all on function core.insights_snapshot_pre_leadership_launch()
  from public, anon, authenticated;
revoke all on function core.insights_snapshot() from public, anon;
grant execute on function core.insights_snapshot() to authenticated, service_role;

create view core.v_insights_snapshot
with (security_invoker = true)
as select * from core.insights_snapshot();

revoke all privileges on table core.v_insights_snapshot
  from public, anon, authenticated;
grant select on table core.v_insights_snapshot to authenticated, service_role;

drop trigger if exists reject_insights_snapshot_write
  on core.v_insights_snapshot;
create trigger reject_insights_snapshot_write
instead of insert or update or delete on core.v_insights_snapshot
for each row execute function core.reject_insights_snapshot_write();

-- Export creation is a certified command. Read-only metric access never grants it.
create or replace function warehouse.register_export_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
    and not (
      core.has_live_cap('insights', 'prepare_exports')
      or core.has_live_cap('warehouse', 'register_exports')
    )
  then
    raise exception 'Not authorized: governed export preparation';
  end if;
  return warehouse.register_export_job_uncertified_impl(payload);
end;
$$;

revoke all on function warehouse.register_export_job(jsonb) from public, anon;
grant execute on function warehouse.register_export_job(jsonb)
  to authenticated, service_role;

alter table warehouse.export_jobs
  drop constraint if exists warehouse_export_type_check;
alter table warehouse.export_jobs
  add constraint warehouse_export_type_check
  check (export_type in (
    'inventory', 'movements', 'allocations',
    'inventory_position', 'quality', 'cycle_counts', 'insights_snapshot'
  ));
alter table warehouse.export_jobs
  drop constraint if exists warehouse_export_filename_check;
alter table warehouse.export_jobs
  add constraint warehouse_export_filename_check
  check (
    filename ~ '^mwell-intra-(inventory|movements|allocations|inventory_position|quality|cycle_counts|insights_snapshot)-[0-9]{8}T[0-9]{6}Z[.]csv$'
  );

create or replace function core.register_insights_export(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job warehouse.export_jobs;
  v_id text := nullif(payload ->> 'id', '');
  v_filename text := nullif(payload ->> 'filename', '');
  v_path text := nullif(payload ->> 'storage_path', '');
begin
  if auth.role() <> 'service_role'
    and not core.has_live_cap('insights', 'prepare_exports')
  then
    raise exception 'Not authorized: insights.prepare_exports';
  end if;
  if v_id is null or v_id !~ '^exp_[A-Za-z0-9_-]{12,}$' then
    raise exception 'Invalid export id';
  end if;
  if v_filename is null
    or v_filename !~ '^mwell-intra-insights_snapshot-[0-9]{8}T[0-9]{6}Z[.]csv$'
  then
    raise exception 'Invalid governed Insights filename';
  end if;
  if v_path is null or v_path not like 'exports/' || auth.uid()::text || '/%' then
    raise exception 'Export path is outside the user scope';
  end if;
  if lower(coalesce(payload ->> 'checksum_sha256', '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid SHA-256 checksum is required';
  end if;

  insert into warehouse.export_jobs (
    id, export_type, filename, storage_path, checksum_sha256, row_count,
    created_by, created_by_email
  ) values (
    v_id, 'insights_snapshot', v_filename, v_path,
    lower(payload ->> 'checksum_sha256'),
    coalesce(nullif(payload ->> 'row_count', '')::integer, 0),
    auth.uid(), coalesce(auth.jwt() ->> 'email', '')
  ) returning * into v_job;

  insert into core.activity_log (
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'insights', 'export_job', v_job.id, 'created', auth.uid(),
    jsonb_build_object(
      'export_type', v_job.export_type,
      'row_count', v_job.row_count,
      'checksum_sha256', v_job.checksum_sha256
    )
  );
  return to_jsonb(v_job);
end;
$$;

revoke all on function core.register_insights_export(jsonb) from public, anon;
grant execute on function core.register_insights_export(jsonb)
  to authenticated, service_role;

alter function warehouse.prepare_export_download(jsonb)
  rename to prepare_export_download_pre_insights_certification;

create function warehouse.prepare_export_download(payload jsonb)
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
    from warehouse.export_jobs job
   where job.id = payload ->> 'export_id';
  if not found then
    raise exception 'Export not found';
  end if;

  if auth.role() <> 'service_role'
    and not (
      core.has_live_cap('warehouse', 'review_exports')
      or (
        v_job.created_by = auth.uid()
        and (
          (v_job.export_type = 'insights_snapshot'
            and core.has_live_cap('insights', 'prepare_exports'))
          or (v_job.export_type <> 'insights_snapshot'
            and core.has_live_cap('warehouse', 'register_exports'))
        )
      )
    )
  then
    raise exception 'Not authorized: governed export download';
  end if;

  return warehouse.prepare_export_download_pre_insights_certification(payload);
end;
$$;

revoke all on function warehouse.prepare_export_download_pre_insights_certification(jsonb)
  from public, anon, authenticated;
grant execute on function warehouse.prepare_export_download_pre_insights_certification(jsonb)
  to service_role;
revoke all on function warehouse.prepare_export_download(jsonb) from public, anon;
grant execute on function warehouse.prepare_export_download(jsonb)
  to authenticated, service_role;

drop policy if exists warehouse_export_jobs_read on warehouse.export_jobs;
create policy warehouse_export_jobs_read
  on warehouse.export_jobs
  for select
  to authenticated
  using (
    (
      created_by = auth.uid()
      and (
        (export_type = 'insights_snapshot'
          and core.has_live_cap('insights', 'prepare_exports'))
        or (export_type <> 'insights_snapshot'
          and core.has_live_cap('warehouse', 'register_exports'))
      )
    )
    or core.has_live_cap('warehouse', 'review_exports')
  );

drop policy if exists warehouse_exports_read on storage.objects;
create policy warehouse_exports_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'warehouse-exports'
    and (
      (
        owner_id = auth.uid()::text
        and exists (
          select 1
          from warehouse.export_jobs job
          where job.storage_path = name
            and (
              (job.export_type = 'insights_snapshot'
                and core.has_live_cap('insights', 'prepare_exports'))
              or (job.export_type <> 'insights_snapshot'
                and core.has_live_cap('warehouse', 'register_exports'))
            )
        )
      )
      or core.has_live_cap('warehouse', 'review_exports')
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
      core.has_live_cap('insights', 'prepare_exports')
      or core.has_live_cap('warehouse', 'register_exports')
    )
    and (storage.foldername(name))[1] = 'exports'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Privacy-minimal handoff ledger: references and reason codes only.
create table core.insight_followups (
  id uuid primary key default gen_random_uuid(),
  metric_id text not null,
  area text not null check (area in ('warehouse', 'procurement', 'legal', 'finance', 'executive')),
  request_type text not null check (request_type in ('validation', 'escalation')),
  reason_code text not null check (
    reason_code in ('stale_source', 'definition_question', 'target_breach', 'access_issue')
  ),
  idempotency_key text not null check (length(idempotency_key) between 12 and 120),
  requested_by uuid not null references auth.users(id) on delete restrict,
  assigned_module text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz not null default current_timestamp,
  unique (requested_by, idempotency_key)
);

create index insight_followups_requester_created_idx
  on core.insight_followups(requested_by, created_at desc);
create index insight_followups_owner_status_idx
  on core.insight_followups(assigned_module, status, created_at desc);

alter table core.insight_followups enable row level security;
alter table core.insight_followups force row level security;

create policy insight_followups_read
  on core.insight_followups
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    or core.has_live_cap('insights', 'view_executive')
    or core.has_live_cap(assigned_module, 'admin')
  );

revoke all on table core.insight_followups from public, anon, authenticated;
grant select on table core.insight_followups to authenticated;
grant all on table core.insight_followups to service_role;

create or replace function core.request_insight_followup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metric record;
  v_followup core.insight_followups;
  v_request_type text := nullif(payload ->> 'request_type', '');
  v_reason_code text := nullif(payload ->> 'reason_code', '');
  v_idempotency_key text := nullif(payload ->> 'idempotency_key', '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_request_type not in ('validation', 'escalation') then
    raise exception 'A valid follow-up type is required';
  end if;
  if v_reason_code not in ('stale_source', 'definition_question', 'target_breach', 'access_issue') then
    raise exception 'A valid follow-up reason is required';
  end if;
  if v_idempotency_key is null or length(v_idempotency_key) not between 12 and 120 then
    raise exception 'A valid idempotency key is required';
  end if;

  select snapshot.id, snapshot.area
    into v_metric
    from core.insights_snapshot() snapshot
   where snapshot.id = nullif(payload ->> 'metric_id', '')
   limit 1;
  if not found then
    raise exception 'Metric is unavailable in the caller scope';
  end if;

  insert into core.insight_followups (
    metric_id,
    area,
    request_type,
    reason_code,
    idempotency_key,
    requested_by,
    assigned_module
  ) values (
    v_metric.id,
    v_metric.area,
    v_request_type,
    v_reason_code,
    v_idempotency_key,
    auth.uid(),
    case when v_metric.area = 'executive' then 'insights' else v_metric.area end
  )
  on conflict (requested_by, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning * into v_followup;

  insert into core.activity_log (
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'insights',
    'insight_followup',
    v_followup.id,
    'requested',
    auth.uid(),
    jsonb_build_object(
      'metric_id', v_followup.metric_id,
      'area', v_followup.area,
      'request_type', v_followup.request_type,
      'reason_code', v_followup.reason_code,
      'assigned_module', v_followup.assigned_module
    )
  );

  return jsonb_build_object(
    'id', v_followup.id,
    'metric_id', v_followup.metric_id,
    'request_type', v_followup.request_type,
    'reason_code', v_followup.reason_code,
    'assigned_module', v_followup.assigned_module,
    'status', v_followup.status,
    'created_at', v_followup.created_at
  );
end;
$$;

revoke all on function core.request_insight_followup(jsonb) from public, anon;
grant execute on function core.request_insight_followup(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
