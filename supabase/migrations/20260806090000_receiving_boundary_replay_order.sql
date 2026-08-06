-- Keep the goods-only receiving boundary while preserving authorization and
-- completed idempotent replays.

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;

  if exists (
    select 1
    from warehouse.command_log command
    where command.actor_id = auth.uid()
      and command.command_name = 'receive_procurement_po'
      and command.idempotency_key = payload ->> 'idempotency_key'
  ) then
    return private.warehouse_receive_procurement_po(payload);
  end if;

  perform private.assert_goods_procurement_po(payload ->> 'po_id');
  return private.warehouse_receive_procurement_po(payload);
end;
$$;

create or replace function warehouse.receive_procurement_po_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;

  if exists (
    select 1
    from warehouse.command_log command
    where command.actor_id = auth.uid()
      and command.command_name = 'receive_procurement_po_exception'
      and command.idempotency_key = payload ->> 'idempotency_key'
  ) then
    return private.warehouse_receive_procurement_po_exception(payload);
  end if;

  perform private.assert_goods_procurement_po(payload ->> 'po_id');
  return private.warehouse_receive_procurement_po_exception(payload);
end;
$$;

revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
revoke all on function warehouse.receive_procurement_po_exception(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb) to authenticated, service_role;
grant execute on function warehouse.receive_procurement_po_exception(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
