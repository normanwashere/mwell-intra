-- A STABLE SQL function inherits the caller's statement snapshot. That can be
-- older than a product lock wait, so availability must use a fresh snapshot.
create or replace function warehouse.available_to_promise(p_product_id text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select greatest(0,(
    coalesce((select sum(quantity) from warehouse.stock_levels where product_id=p_product_id),0)
    + coalesce((select count(*) from warehouse.inventory_units
      where product_id=p_product_id and status='in_stock'),0)
    - coalesce((select sum(quantity) from warehouse.allocations
      where product_id=p_product_id and status in ('reserved','allocated')),0)
    - coalesce((select sum(quantity) from warehouse.inventory_holds
      where product_id=p_product_id and status='active'),0)
  ))::integer;
$$;

revoke all on function warehouse.available_to_promise(text) from public, anon;
grant execute on function warehouse.available_to_promise(text) to authenticated, service_role;

-- Enforce the availability invariant for both procurement and routine quality
-- paths. The legacy routine path previously inserted a hold without rechecking
-- reservations after acquiring the shared product lock.
create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt warehouse.receipts;
  v_line_id text := nullif(payload->>'procurement_po_line_id','');
  v_product_id text := nullif(payload->>'product_id','');
  v_quantity integer := coalesce((payload->>'quantity')::integer,0);
  v_disposition text := payload->>'disposition';
begin
  if not core.has_cap('warehouse','inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if v_product_id is null then
    raise exception 'Quality inspection product is required';
  end if;

  perform private.lock_warehouse_products(array[v_product_id]);

  if v_disposition<>'accepted'
     and v_quantity>warehouse.available_to_promise(v_product_id) then
    raise exception 'Quality hold exceeds availability after active reservations and holds';
  end if;

  if payload->>'source_type'='receipt' then
    select * into v_receipt
      from warehouse.receipts
     where id=payload->>'source_id';
    if v_receipt.procurement_po_id is not null then
      if v_line_id is null then
        raise exception 'Procurement PO-line identity is required for receipt quality disposition';
      end if;
      if not exists (
        select 1
          from jsonb_array_elements(v_receipt.lines) receipt_line
         where receipt_line->>'procurementLineId'=v_line_id
           and receipt_line->>'productId'=v_product_id
      ) then
        raise exception 'Quality disposition PO line does not belong to the receipt';
      end if;
      if exists (
        select 1
          from warehouse.procurement_receipt_exception_lines claim
          join warehouse.procurement_receipt_exception_decisions decision
            on decision.id=claim.decision_id
         where claim.active
           and (decision.receipt_id=v_receipt.id or claim.po_line_id=v_line_id)
      ) then
        raise exception 'Active controlled receipt exception must be finalized by the controlled exception resolver';
      end if;
    end if;
  end if;

  return private.warehouse_inspect_quality_v2(payload);
end;
$$;

revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
