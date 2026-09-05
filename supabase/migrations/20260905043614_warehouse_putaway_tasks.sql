-- Tasks describe remaining staging work, never historical inspection rows.
-- Invoker security retains the existing source-table RLS and API grants.
create or replace view warehouse.warehouse_tasks
with (security_invoker = true)
as
with staging as (
  select position.*
  from warehouse.inventory_position_v1 position
  join warehouse.locations location on location.id = position.location_id
  where position.bin_id is null and position.available > 0
    and location.type = 'warehouse'
    -- Match inventory_holds SELECT policy: invisible holds are not zero holds.
    and (
      core.has_cap('warehouse', 'inspect_quality')
      or core.has_cap('warehouse', 'view_exceptions')
      or core.has_cap('warehouse', 'view_finance')
    )
), eligible_units as (
  select unit.*, staging.available,
    row_number() over (partition by unit.product_id, unit.location_id order by unit.id) as ordinal
  from warehouse.inventory_units unit
  join staging on staging.product_id = unit.product_id and staging.location_id = unit.location_id
  where unit.bin_id is null and unit.status = 'in_stock'
    and not exists (
      select 1 from warehouse.inventory_holds hold
      where hold.product_id = unit.product_id and hold.location_id = unit.location_id
        and hold.bin_id is null and hold.status = 'active'
        and (hold.serial_number is null or hold.serial_number = unit.serial_number)
    )
)
select 'quality-' || inspection.id::text as id,
  'quality'::text as task_type, inspection.id::text as source_id,
  'Inspect receipt stock'::text as title, 'due'::text as status,
  null::uuid as assignee_id, inspection.inspected_at + interval '1 day' as due_at,
  null::timestamptz as completed_at, inspection.inspected_at as created_at
from warehouse.quality_inspections inspection
where inspection.disposition = 'pending'
union all
select 'exception-' || exception.id::text, 'exception', exception.id::text,
  'Resolve ' || replace(exception.exception_type, '_', ' '),
  case when exception.status = 'in_progress' then 'blocked' else 'due' end,
  exception.owner_id, exception.due_at, null::timestamptz, exception.created_at
from warehouse.exceptions exception
where exception.status in ('open', 'in_progress')
union all
select 'putaway-unit-' || unit.id, 'putaway', unit.id,
  'Put away ' || product.name || ' / ' || unit.serial_number, 'due',
  null::uuid, null::timestamptz, null::timestamptz, timestamptz '1970-01-01 00:00:00+00'
from eligible_units unit
join warehouse.products product on product.id = unit.product_id and product.serialized
where unit.ordinal <= unit.available
union all
select 'putaway-staging:' || json_build_array(staging.product_id, staging.location_id)::text,
  'putaway', 'staging:' || json_build_array(staging.product_id, staging.location_id)::text,
  'Put away ' || product.name || ' / ' || staging.available::text || ' units', 'due',
  null::uuid, null::timestamptz, null::timestamptz, timestamptz '1970-01-01 00:00:00+00'
from staging
join warehouse.products product on product.id = staging.product_id and not product.serialized;

revoke all on warehouse.warehouse_tasks from public, anon;
grant select on warehouse.warehouse_tasks to authenticated, service_role;
