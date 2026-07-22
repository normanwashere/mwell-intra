-- Keep generated My Work links aligned with the implemented Warehouse route.
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
    '/warehouse/quality'
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
