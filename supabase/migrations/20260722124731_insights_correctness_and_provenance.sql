-- Make Insights decision-safe: target direction, no-data semantics, coverage,
-- reporting windows, and source freshness are explicit projection fields.

drop view if exists core.v_insights_snapshot;
drop function if exists core.insights_snapshot();

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
set search_path = core, warehouse, procurement, legal, public
as $$
  select
    'wh-fill'::text,
    'warehouse'::text,
    'Fulfillment rate'::text,
    case
      when count(*) = 0 then null
      when coalesce(sum(a.quantity), 0) <= 0 then null
      else round(
        100 * sum(a.quantity) filter (where a.status in ('issued', 'returned'))::numeric
          / nullif(sum(a.quantity), 0),
        1
      )
    end,
    '%'::text,
    'minimum'::text,
    95::numeric,
    null::numeric,
    case
      when count(*) = 0 then 'no_data'
      when coalesce(sum(a.quantity), 0) <= 0 then 'incomplete'
      else 'current'
    end::text,
    count(*)::bigint,
    'Issued or returned units against approved event demand'::text,
    '/warehouse/analytics'::text,
    current_timestamp - interval '30 days',
    current_timestamp,
    max(a.created_at),
    current_timestamp as extracted_at
  from warehouse.allocations a
  where a.created_at >= current_timestamp - interval '30 days'
  having core.has_cap('insights', 'view_warehouse')

  union all

  select
    'wh-variance'::text,
    'warehouse'::text,
    'Open stock variances'::text,
    case when count(*) = 0 then null
      else count(*) filter (where c.status in ('submitted', 'pending_approval', 'rejected'))::numeric
    end,
    null::text,
    'maximum'::text,
    null::numeric,
    0::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Submitted counts awaiting a final variance decision'::text,
    '/warehouse/cycle-counts'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(coalesce(c.submitted_at, c.created_at)),
    current_timestamp as extracted_at
  from warehouse.cycle_counts c
  where c.created_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_warehouse')

  union all

  select
    'pr-cycle'::text,
    'procurement'::text,
    'Average PR-to-PO cycle'::text,
    case when count(*) = 0 then null
      else round(avg(extract(epoch from (r.updated_at - r.created_at)) / 86400)::numeric, 1)
    end,
    ' days'::text,
    'maximum'::text,
    null::numeric,
    5::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Elapsed time for approved purchase requests'::text,
    '/procurement/purchase-orders'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(r.updated_at),
    current_timestamp as extracted_at
  from procurement.requests r
  where r.status = 'approved'
    and r.updated_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_procurement')

  union all

  select
    'pr-approval'::text,
    'procurement'::text,
    'Approvals waiting'::text,
    case when count(*) = 0 then null
      else count(*) filter (where r.status in ('submitted', 'under_review'))::numeric
    end,
    null::text,
    'maximum'::text,
    null::numeric,
    0::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Purchase requests waiting for a DOA decision'::text,
    '/procurement/approvals'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(r.updated_at),
    current_timestamp as extracted_at
  from procurement.requests r
  where r.created_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_procurement')

  union all

  select
    'lg-review'::text,
    'legal'::text,
    'Accreditation review time'::text,
    case when count(*) = 0 then null
      else round(avg(extract(epoch from (c.decided_at - c.submitted_at)) / 86400)::numeric, 1)
    end,
    ' days'::text,
    'maximum'::text,
    null::numeric,
    3::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Submitted accreditation to legal determination'::text,
    '/legal/accreditation'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(c.decided_at),
    current_timestamp as extracted_at
  from legal.accreditation_cases c
  where c.decided_at is not null
    and c.submitted_at is not null
    and c.decided_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_legal')

  union all

  select
    'fn-ready'::text,
    'finance'::text,
    'Payment packs ready'::text,
    case when count(*) = 0 then null
      else count(*) filter (where p.status = 'ready_for_finance')::numeric
    end,
    null::text,
    'informational'::text,
    null::numeric,
    null::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Reconciled packs awaiting Finance review'::text,
    '/finance'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(coalesce(p.finance_reviewed_at, p.prepared_at)),
    current_timestamp as extracted_at
  from procurement.payment_readiness_packs p
  where p.prepared_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_finance')

  union all

  select
    'ex-risk'::text,
    'executive'::text,
    'Priority exceptions'::text,
    case when count(*) = 0 then null
      else count(*) filter (where q.status in ('open', 'in_review'))::numeric
    end,
    null::text,
    'maximum'::text,
    null::numeric,
    0::numeric,
    case when count(*) = 0 then 'no_data' else 'current' end::text,
    count(*)::bigint,
    'Open governed remediation items across departments'::text,
    '/work'::text,
    current_timestamp - interval '90 days',
    current_timestamp,
    max(coalesce(q.resolved_at, q.created_at)),
    current_timestamp as extracted_at
  from core.policy_remediation_queue q
  where q.created_at >= current_timestamp - interval '90 days'
  having core.has_cap('insights', 'view_executive');
$$;

revoke all on function core.insights_snapshot() from public, anon;
grant execute on function core.insights_snapshot() to authenticated, service_role;

create view core.v_insights_snapshot
with (security_invoker = true)
as select * from core.insights_snapshot();

grant select on core.v_insights_snapshot to authenticated, service_role;
