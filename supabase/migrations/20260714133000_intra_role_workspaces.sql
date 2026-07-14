-- First-class Intra workspaces: Events, My Work, and Insights.
-- UI RBAC mirror: packages/rbac/src/modules/{events,insights}.ts.

insert into core.capabilities(module, cap) values
  ('events','view_events'), ('events','create_event'),
  ('events','manage_events'), ('events','request_fulfillment'),
  ('events','close_event'), ('events','admin'),
  ('insights','view_warehouse'), ('insights','view_procurement'),
  ('insights','view_legal'), ('insights','view_finance'),
  ('insights','view_executive'), ('insights','prepare_exports'),
  ('insights','admin')
on conflict do nothing;

insert into core.roles(module, role, label) values
  ('events','requester','Event Requester'),
  ('events','coordinator','Event Coordinator'),
  ('events','viewer','Event Viewer'),
  ('events','admin','Events Administrator'),
  ('insights','analyst','Data Analyst'),
  ('insights','manager','Department Manager'),
  ('insights','executive','Executive'),
  ('insights','admin','Insights Administrator')
on conflict (module, role) do update set label = excluded.label;

insert into core.role_capabilities(module, role, cap) values
  ('events','requester','view_events'),
  ('events','requester','create_event'),
  ('events','requester','request_fulfillment'),
  ('events','coordinator','view_events'),
  ('events','coordinator','create_event'),
  ('events','coordinator','manage_events'),
  ('events','coordinator','request_fulfillment'),
  ('events','coordinator','close_event'),
  ('events','viewer','view_events'),
  ('events','admin','view_events'),
  ('events','admin','create_event'),
  ('events','admin','manage_events'),
  ('events','admin','request_fulfillment'),
  ('events','admin','close_event'),
  ('events','admin','admin'),
  ('insights','analyst','view_warehouse'),
  ('insights','analyst','view_procurement'),
  ('insights','analyst','view_legal'),
  ('insights','analyst','view_finance'),
  ('insights','analyst','prepare_exports'),
  ('insights','manager','view_warehouse'),
  ('insights','manager','view_procurement'),
  ('insights','manager','view_legal'),
  ('insights','manager','view_finance'),
  ('insights','manager','view_executive'),
  ('insights','executive','view_executive'),
  ('insights','admin','view_warehouse'),
  ('insights','admin','view_procurement'),
  ('insights','admin','view_legal'),
  ('insights','admin','view_finance'),
  ('insights','admin','view_executive'),
  ('insights','admin','prepare_exports'),
  ('insights','admin','admin')
on conflict do nothing;

-- Preserve current operating responsibilities while separating workspaces.
insert into core.user_roles(user_id, module, role)
select user_id, 'events', case role
  when 'marketing' then 'coordinator'
  when 'business_unit' then 'requester'
  else 'admin'
end
from core.user_roles
where module = 'warehouse' and role in ('marketing','business_unit','warehouse_admin')
on conflict do nothing;

insert into core.user_roles(user_id, module, role)
select user_id, 'insights', case role
  when 'bi_analyst' then 'analyst'
  else 'admin'
end
from core.user_roles
where module = 'warehouse' and role in ('bi_analyst','warehouse_admin')
on conflict do nothing;

insert into core.user_roles(user_id, module, role)
select user_id, 'events', 'admin'
from core.user_roles where module = 'core' and role = 'platform_admin'
on conflict do nothing;

insert into core.user_roles(user_id, module, role)
select user_id, 'insights', 'admin'
from core.user_roles where module = 'core' and role = 'platform_admin'
on conflict do nothing;

-- Keep JWT app_metadata aligned for the existing SessionProvider contract.
with grouped as (
  select user_id, jsonb_object_agg(module, roles order by module) as roles
  from (
    select user_id, module, jsonb_agg(role order by role) as roles
    from core.user_roles
    group by user_id, module
  ) per_module
  group by user_id
)
update auth.users u
set raw_app_meta_data = jsonb_set(
  coalesce(u.raw_app_meta_data, '{}'::jsonb),
  '{roles}', grouped.roles, true
)
from grouped
where grouped.user_id = u.id;

-- Events owns lifecycle intent; Warehouse remains the physical custodian.
drop policy if exists events_insert on warehouse.events;
create policy events_insert on warehouse.events
  for insert to authenticated
  with check (
    core.has_cap('events', 'create_event')
    or core.has_cap('warehouse', 'reserve_allocate')
  );

create or replace function warehouse.create_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, core, public
as $$
declare v_event warehouse.events;
begin
  if not (
    core.has_cap('events', 'create_event')
    or core.has_cap('warehouse', 'reserve_allocate')
  ) then
    raise exception 'Not authorized: events/create_event';
  end if;
  insert into warehouse.events
  select * from jsonb_populate_record(null::warehouse.events, payload->'event')
  returning * into v_event;
  return to_jsonb(v_event);
end;
$$;

revoke all on function warehouse.create_event(jsonb) from public, anon;
grant execute on function warehouse.create_event(jsonb) to authenticated, service_role;

-- Personal aggregate. Each branch is capability- or ownership-scoped.
create or replace function core.my_work()
returns table(
  id text, source text, title text, description text, status text,
  priority text, due_at timestamptz, href text
)
language sql
security definer
stable
set search_path = core, warehouse, procurement, legal, public
as $$
  select 'receipt:' || r.id, 'warehouse', 'Inspect receipt ' || r.id,
    'Receipt evidence and line disposition require quality review.',
    r.quality_status, 'high', r.created_at + interval '1 day',
    '/warehouse/quality-control'
  from warehouse.receipts r
  where core.has_cap('warehouse','inspect_quality')
    and r.quality_status in ('pending','partial')
  union all
  select 'count:' || c.id, 'warehouse', 'Review cycle count ' || c.id,
    'A submitted stock count requires variance review.', c.status,
    'high', coalesce(c.submitted_at, c.created_at) + interval '1 day',
    '/warehouse/cycle-counts'
  from warehouse.cycle_counts c
  where core.has_cap('warehouse','approve_stock_adjustment')
    and c.status in ('submitted','pending_approval')
  union all
  select 'request:' || r.id::text, 'procurement', 'Review purchase request ' || r.id::text,
    r.title, r.status, 'normal', r.updated_at + interval '2 days',
    '/procurement/approvals'
  from procurement.requests r
  where core.has_cap('procurement','approve_request')
    and r.status in ('submitted','under_review')
  union all
  select 'legal:' || c.id::text, 'legal', 'Review vendor accreditation',
    'The submitted vendor case needs a legal determination.', c.status,
    'normal', coalesce(c.submitted_at, c.created_at) + interval '3 days',
    '/legal/accreditation'
  from legal.accreditation_cases c
  where core.has_cap('legal','review_accreditation')
    and c.status in ('submitted','under_review')
  union all
  select 'payment:' || p.id::text, 'finance', 'Review payment readiness pack',
    'A reconciled acceptance and invoice pack is ready for Finance.', p.status,
    'high', p.prepared_at + interval '2 days',
    '/procurement/purchase-orders/' || p.purchase_order_id
  from procurement.payment_readiness_packs p
  where core.has_cap('procurement','view_finance')
    and p.status = 'ready_for_finance'
  union all
  select 'event:' || e.id, 'events', 'Confirm event fulfillment: ' || e.name,
    'Review reservations, issue readiness, and the return plan.', 'planned',
    'normal', e.start_date::timestamptz - interval '1 day',
    '/events/' || e.id
  from warehouse.events e
  where core.has_cap('events','view_events')
    and e.start_date >= current_date
    and e.start_date <= current_date + 30;
$$;

revoke all on function core.my_work() from public, anon;
grant execute on function core.my_work() to authenticated, service_role;
create or replace view core.v_my_work
with (security_invoker = true)
as select * from core.my_work();
grant select on core.v_my_work to authenticated, service_role;

-- Governed KPI snapshot. The function is definer-rights but every metric is
-- explicitly gated by the caller's Insights capability.
create or replace function core.insights_snapshot()
returns table(
  id text, area text, label text, value numeric, unit text, target numeric,
  detail text, source_href text, updated_at timestamptz
)
language sql
security definer
stable
set search_path = core, warehouse, procurement, legal, public
as $$
  select 'wh-fill', 'warehouse', 'Fulfillment rate',
    coalesce(round(100 * sum(a.quantity) filter (where a.status in ('issued','returned'))::numeric / nullif(sum(a.quantity),0),1),0),
    '%', 95, 'Issued or returned units against approved event demand', '/warehouse/analytics', now()
  from warehouse.allocations a where core.has_cap('insights','view_warehouse')
  union all
  select 'wh-variance', 'warehouse', 'Open stock variances', count(*)::numeric,
    null, 0, 'Submitted counts awaiting a final variance decision', '/warehouse/cycle-counts', now()
  from warehouse.cycle_counts c where core.has_cap('insights','view_warehouse') and c.status in ('submitted','pending_approval','rejected')
  union all
  select 'pr-cycle', 'procurement', 'Average PR-to-PO cycle',
    coalesce(round(avg(extract(epoch from (r.updated_at-r.created_at))/86400)::numeric,1),0), ' days', 5,
    'Elapsed time for approved purchase requests', '/procurement/purchase-orders', now()
  from procurement.requests r where core.has_cap('insights','view_procurement') and r.status = 'approved'
  union all
  select 'pr-approval', 'procurement', 'Approvals waiting', count(*)::numeric,
    null, 0, 'Purchase requests waiting for a DOA decision', '/procurement/approvals', now()
  from procurement.requests r where core.has_cap('insights','view_procurement') and r.status in ('submitted','under_review')
  union all
  select 'lg-review', 'legal', 'Accreditation review time',
    coalesce(round(avg(extract(epoch from (c.decided_at-c.submitted_at))/86400)::numeric,1),0), ' days', 3,
    'Submitted accreditation to legal determination', '/legal/accreditation', now()
  from legal.accreditation_cases c where core.has_cap('insights','view_legal') and c.decided_at is not null and c.submitted_at is not null
  union all
  select 'fn-ready', 'finance', 'Payment packs ready', count(*)::numeric,
    null, 0, 'Reconciled packs awaiting Finance review', '/finance', now()
  from procurement.payment_readiness_packs p where core.has_cap('insights','view_finance') and p.status = 'ready_for_finance'
  union all
  select 'ex-risk', 'executive', 'Priority exceptions', count(*)::numeric,
    null, 0, 'Open governed remediation items across departments', '/work', now()
  from core.policy_remediation_queue q where core.has_cap('insights','view_executive') and q.status in ('open','in_review');
$$;

revoke all on function core.insights_snapshot() from public, anon;
grant execute on function core.insights_snapshot() to authenticated, service_role;
create or replace view core.v_insights_snapshot
with (security_invoker = true)
as select * from core.insights_snapshot();
grant select on core.v_insights_snapshot to authenticated, service_role;
