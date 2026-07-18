-- Quality holds and reservations both consume available-to-promise stock. Put
-- them in the same product-scoped transaction lock before either can commit.
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
begin
  if not core.has_cap('warehouse','inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if v_product_id is null then
    raise exception 'Quality inspection product is required';
  end if;

  perform private.lock_warehouse_products(array[v_product_id]);

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
