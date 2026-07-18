-- Converge governed manual stock changes on the exception catalogue and keep
-- private approval implementation details unreachable from browser roles.
alter table warehouse.exceptions
  drop constraint if exists warehouse_exception_type_check;

alter table warehouse.exceptions
  add constraint warehouse_exception_type_check check (
    exception_type in (
      'quality',
      'count_variance',
      'stock_variance',
      'po_receipt',
      'scan_mismatch',
      'import'
    )
  );

create or replace function warehouse.decide_stock_change(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.warehouse_decide_stock_change(payload)
$$;

revoke all on function private.warehouse_decide_stock_change(jsonb)
  from public, anon, authenticated;
revoke all on function warehouse.decide_stock_change(jsonb)
  from public, anon;
grant execute on function private.warehouse_decide_stock_change(jsonb)
  to service_role;
grant execute on function warehouse.decide_stock_change(jsonb)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
