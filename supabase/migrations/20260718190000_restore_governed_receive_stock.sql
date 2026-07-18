-- Some already-versioned environments retained the pre-RBAC Warehouse
-- receive_stock body. Restore the current capability gate and authoritative
-- actor stamping without trusting caller-supplied audit identities.
create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt warehouse.receipts;
  v_actor text;
begin
  if not core.has_cap('warehouse','receive_stock') then
    raise exception 'Not authorized: receive_stock';
  end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'receipt' then
    payload := jsonb_set(
      payload,
      '{receipt}',
      warehouse.force_actor_on_object(payload->'receipt', v_actor)
    );
    payload := jsonb_set(payload,'{receipt,created_at}',to_jsonb(now()),true);
    payload := jsonb_set(
      payload,
      '{receipt,quality_status}',
      to_jsonb('pending'::text),
      true
    );
  end if;
  if payload ? 'movements' then
    payload := jsonb_set(
      payload,
      '{movements}',
      warehouse.force_actor_on_array(payload->'movements', v_actor)
    );
  end if;
  if coalesce(jsonb_array_length(payload->'lots'), 0) > 0 then
    insert into warehouse.lots
    select * from jsonb_populate_recordset(null::warehouse.lots, payload->'lots');
  end if;
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units
    select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity)
    select product_id,location_id,bin_id,lot_id,greatest(0,quantity)
    from jsonb_populate_recordset(
      null::warehouse.stock_levels,
      (
        select jsonb_agg(jsonb_build_object(
          'product_id',delta->>'product_id',
          'location_id',delta->>'location_id',
          'bin_id',delta->>'bin_id',
          'lot_id',delta->>'lot_id',
          'quantity',(delta->>'delta')::integer
        ))
        from jsonb_array_elements(payload->'stock_deltas') delta
      )
    )
    on conflict(product_id,location_id,bin_id,lot_id)
    do update set quantity=greatest(
      0,
      warehouse.stock_levels.quantity+excluded.quantity
    );
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements
    select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.receipts
  select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt')
  returning * into v_receipt;
  perform warehouse.register_evidence_docs(
    'receipt',
    v_receipt.id,
    v_receipt.evidence_urls
  );
  return to_jsonb(v_receipt);
end;
$$;
