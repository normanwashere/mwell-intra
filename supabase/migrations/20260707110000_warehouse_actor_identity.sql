-- Mwell Intra — warehouse RPC actor identity hardening (anti-forgery)
--
-- The warehouse transactional RPCs in 20260706092400_warehouse_rpcs.sql
-- insert the `actor` column straight from the client payload
-- (jsonb_populate_record over receipt/return/cycle_count/movement/
-- purchase_order objects), so any authenticated caller with the capability
-- could stamp another user's name on the ledger. This migration
-- CREATE OR REPLACEs each affected RPC with a body IDENTICAL to the v1→v8
-- original except that the actor field is FORCED to the authoritative
-- identity before the payload is populated into rows:
--
--   actor := core.profiles.email for auth.uid()  (human-readable ledger)
--            falling back to auth.uid()::text     (profile row missing/blank)
--
-- Affected RPCs + stamped fields:
--   receive_stock        — receipt.actor, movements[].actor
--   issue                — movement.actor
--   transfer             — movement.actor
--   record_return        — return.actor, movements[].actor
--   record_cycle_count   — cycle_count.actor, movements[].actor
--   receive_against_po   — movements[].actor
--   adjust_stock         — movement.actor
--   create_purchase_order — purchase_order.actor (same forgery class; added
--                           beyond the audit list for completeness)
--
-- NOT changed: warehouse.receive_against_procurement_po (cross-module wiring)
-- already stamps procurement.receipts.actor_id = auth.uid() server-side and
-- takes no client actor field — nothing to override. reserve()/
-- cancel_allocation() insert no actor column (warehouse.allocations has none).
--
-- Re-runnable: create-or-replace + idempotent grant loop.

-- ===========================================================================
-- 0) Identity + stamping helpers. INTERNAL — never granted to API roles; only
--    the definer RPCs below call them (register_evidence_docs pattern).
-- ===========================================================================
create or replace function warehouse.authoritative_actor()
returns text language sql stable security definer set search_path = warehouse, public as $$
  select coalesce(
    nullif((select p.email from core.profiles p where p.id = auth.uid()), ''),
    auth.uid()::text
  );
$$;
revoke all on function warehouse.authoritative_actor() from public, anon, authenticated;

-- Overwrite `actor` on every element of a jsonb array (movements etc.).
-- Non-arrays pass through untouched so callers can stamp unconditionally.
create or replace function warehouse.force_actor_on_array(p_arr jsonb, p_actor text)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(p_arr) = 'array' then
      coalesce(
        (select jsonb_agg(e || jsonb_build_object('actor', p_actor))
           from jsonb_array_elements(p_arr) e),
        '[]'::jsonb
      )
    else p_arr
  end;
$$;
revoke all on function warehouse.force_actor_on_array(jsonb, text) from public, anon, authenticated;

-- Overwrite `actor` on a jsonb object; non-objects pass through untouched.
create or replace function warehouse.force_actor_on_object(p_obj jsonb, p_actor text)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(p_obj) = 'object' then p_obj || jsonb_build_object('actor', p_actor)
    else p_obj
  end;
$$;
revoke all on function warehouse.force_actor_on_object(jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- receive_stock — v1→v8 body unchanged; actor forced on receipt + movements.
-- ===========================================================================
create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_receipt warehouse.receipts; v_actor text;
begin
  if not core.has_cap('warehouse','receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'receipt' then payload := jsonb_set(payload, '{receipt}', warehouse.force_actor_on_object(payload->'receipt', v_actor)); end if;
  if payload ? 'movements' then payload := jsonb_set(payload, '{movements}', warehouse.force_actor_on_array(payload->'movements', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'lots'), 0) > 0 then
    insert into warehouse.lots select * from jsonb_populate_recordset(null::warehouse.lots, payload->'lots');
  end if;
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.receipts select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt') returning * into v_receipt;
  perform warehouse.register_evidence_docs('receipt', v_receipt.id, v_receipt.evidence_urls);
  return to_jsonb(v_receipt);
end; $$;

-- ===========================================================================
-- issue — v1→v8 body unchanged; actor forced on the movement record.
-- ===========================================================================
create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare
  v_alloc warehouse.allocations;
  v_unit_ids text[];
  v_expected int;
  v_updated int;
  v_serialized boolean;
  v_d jsonb;
  v_sum int := 0;
  v_actor text;
begin
  if not core.has_cap('warehouse','issue_items') then raise exception 'Not authorized: issue_items'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'movement' then payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(payload->'movement', v_actor)); end if;
  select serialized into v_serialized from warehouse.products
    where id = (select product_id from warehouse.allocations where id = payload->>'allocation_id');
  update warehouse.allocations set status = 'issued' where id = payload->>'allocation_id' and status = 'reserved' returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found or not reservable: %', payload->>'allocation_id'; end if;
  if v_serialized then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    if v_expected <> v_alloc.quantity then
      raise exception 'Must issue exactly % serialized unit(s), got %.', v_alloc.quantity, v_expected;
    end if;
    update warehouse.inventory_units set status = 'issued', assigned_to = payload->>'assigned_to', event_id = payload->>'event_id'
    where id = any(v_unit_ids) and status = 'in_stock' and product_id = v_alloc.product_id;
    get diagnostics v_updated = row_count;
    if v_updated <> v_expected then
      raise exception 'Serialized units must all belong to the allocation product and be in stock (% of %).', v_updated, v_expected;
    end if;
  else
    if jsonb_typeof(payload->'stock_deltas') <> 'array' or jsonb_array_length(payload->'stock_deltas') = 0 then
      raise exception 'Missing stock movement for non-serialized issue.';
    end if;
    for v_d in select * from jsonb_array_elements(payload->'stock_deltas') loop
      if (v_d->>'product_id') is distinct from v_alloc.product_id then
        raise exception 'Issue stock delta product does not match the allocation.';
      end if;
      v_sum := v_sum + abs((v_d->>'delta')::int);
      update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (v_d->>'delta')::int)
      where s.product_id = v_d->>'product_id' and s.location_id = v_d->>'location_id'
        and s.bin_id is not distinct from (v_d->>'bin_id');
      get diagnostics v_updated = row_count;
      if v_updated = 0 then raise exception 'Issue stock row not found for the requested bin.'; end if;
    end loop;
    if v_sum <> v_alloc.quantity then
      raise exception 'Issue deltas must sum to the allocation quantity (% vs %).', v_sum, v_alloc.quantity;
    end if;
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;

-- ===========================================================================
-- transfer — v1→v8 body unchanged; actor forced on the movement record.
-- ===========================================================================
create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int; v_from int; v_to int; v_actor text;
begin
  if not core.has_cap('warehouse','transfer_stock') then raise exception 'Not authorized: transfer_stock'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'movement' then payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(payload->'movement', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units
    set location_id = payload->>'to_location_id', bin_id = payload->>'to_bin_id'
    where id = any(v_unit_ids) and status = 'in_stock' and location_id = payload->>'from_location_id';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock at the source (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'from_stock_delta') = 'object' then
    v_from := abs((payload->'from_stock_delta'->>'delta')::int);
    if jsonb_typeof(payload->'to_stock_delta') = 'object' then
      v_to := abs((payload->'to_stock_delta'->>'delta')::int);
      if v_from <> v_to then raise exception 'Transfer source/destination quantities must match.'; end if;
    end if;
    if not exists (
      select 1 from warehouse.stock_levels s
      where s.product_id = payload->'from_stock_delta'->>'product_id'
        and s.location_id = payload->'from_stock_delta'->>'location_id'
        and s.bin_id is not distinct from (payload->'from_stock_delta'->>'bin_id')
        and s.quantity >= v_from
    ) then
      raise exception 'Insufficient stock in the source bin for this transfer.';
    end if;
    update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (payload->'from_stock_delta'->>'delta')::int)
    where s.product_id = payload->'from_stock_delta'->>'product_id' and s.location_id = payload->'from_stock_delta'->>'location_id'
      and s.bin_id is not distinct from (payload->'from_stock_delta'->>'bin_id');
  end if;
  if jsonb_typeof(payload->'to_stock_delta') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    values (payload->'to_stock_delta'->>'product_id', payload->'to_stock_delta'->>'location_id', payload->'to_stock_delta'->>'bin_id', null, greatest(0, (payload->'to_stock_delta'->>'delta')::int))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end; $$;

-- ===========================================================================
-- record_return — v1→v8 body unchanged; actor forced on return + movements.
-- ===========================================================================
create or replace function warehouse.record_return(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_ret warehouse.returns; v_unit jsonb; v_actor text;
begin
  if not core.has_cap('warehouse','manage_returns') then raise exception 'Not authorized: manage_returns'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'return' then payload := jsonb_set(payload, '{return}', warehouse.force_actor_on_object(payload->'return', v_actor)); end if;
  if payload ? 'movements' then payload := jsonb_set(payload, '{movements}', warehouse.force_actor_on_array(payload->'movements', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'unit_updates'), 0) > 0 then
    for v_unit in select * from jsonb_array_elements(payload->'unit_updates') loop
      update warehouse.inventory_units
      set status = v_unit->>'status',
          assigned_to = null,
          location_id = coalesce(v_unit->>'location_id', location_id),
          bin_id = case when v_unit ? 'location_id' then v_unit->>'bin_id' else bin_id end
      where serial_number = v_unit->>'serial_number';
    end loop;
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  if jsonb_typeof(payload->'allocation_id') = 'string' then
    update warehouse.allocations set status = 'returned' where id = payload->>'allocation_id' and status = 'issued';
  end if;
  insert into warehouse.returns select * from jsonb_populate_record(null::warehouse.returns, payload->'return') returning * into v_ret;
  perform warehouse.register_evidence_docs('return', v_ret.id, v_ret.evidence_urls);
  return to_jsonb(v_ret);
end; $$;

-- ===========================================================================
-- record_cycle_count — v1→v8 body unchanged; actor forced on cycle_count +
-- movements.
-- ===========================================================================
create or replace function warehouse.record_cycle_count(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_cc warehouse.cycle_counts; v_actor text;
begin
  if not core.has_cap('warehouse','cycle_count') then raise exception 'Not authorized: cycle_count'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'cycle_count' then payload := jsonb_set(payload, '{cycle_count}', warehouse.force_actor_on_object(payload->'cycle_count', v_actor)); end if;
  if payload ? 'movements' then payload := jsonb_set(payload, '{movements}', warehouse.force_actor_on_array(payload->'movements', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'stock_sets'), 0) > 0 then
    update warehouse.stock_levels s set quantity = v.quantity
    from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v
    where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id;
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select v.product_id, v.location_id, v.bin_id, null, v.quantity
    from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v
    where not exists (
      select 1 from warehouse.stock_levels s
      where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id and s.lot_id is null
    )
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  insert into warehouse.cycle_counts select * from jsonb_populate_record(null::warehouse.cycle_counts, payload->'cycle_count') returning * into v_cc;
  return to_jsonb(v_cc);
end; $$;

-- ===========================================================================
-- receive_against_po — v8 body unchanged; actor forced on movements.
-- ===========================================================================
create or replace function warehouse.receive_against_po(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare
  v_po warehouse.purchase_orders;
  v_lines jsonb;
  v_line jsonb;
  v_pid text;
  v_qty int;
  v_idx int;
  v_ordered int;
  v_current int;
  v_total_ordered int;
  v_total_received int;
  v_status text;
  v_actor text;
begin
  if not core.has_cap('warehouse','receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'movements' then payload := jsonb_set(payload, '{movements}', warehouse.force_actor_on_array(payload->'movements', v_actor)); end if;
  select * into v_po from warehouse.purchase_orders where id = payload->>'po_id';
  if v_po.id is null then raise exception 'Purchase order not found: %', payload->>'po_id'; end if;
  if v_po.status = 'cancelled' then raise exception 'Cannot receive against a cancelled purchase order.'; end if;
  v_lines := v_po.lines;

  for v_line in select * from jsonb_array_elements(payload->'line_deltas') loop
    v_pid := v_line->>'productId';
    v_qty := (v_line->>'quantityReceived')::int;
    if v_qty <= 0 then continue; end if;
    v_idx := null;
    select idx into v_idx
    from (select (row_number() over () - 1) as idx, line
          from jsonb_array_elements(v_lines) as t(line)) sub
    where line->>'productId' = v_pid
    limit 1;
    if v_idx is null then
      raise exception 'Received product % is not on purchase order %.', v_pid, v_po.id;
    end if;
    v_ordered := (v_lines->v_idx->>'quantityOrdered')::int;
    v_current := coalesce((v_lines->v_idx->>'quantityReceived')::int, 0);
    v_lines := jsonb_set(
      v_lines,
      array[v_idx::text, 'quantityReceived'],
      to_jsonb(least(v_ordered, v_current + v_qty))
    );
  end loop;

  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;

  select
    coalesce(sum((line->>'quantityOrdered')::int), 0),
    coalesce(sum((line->>'quantityReceived')::int), 0)
    into v_total_ordered, v_total_received
  from jsonb_array_elements(v_lines) as t(line);
  v_status := case
    when v_total_received <= 0 then 'ordered'
    when v_total_received >= v_total_ordered then 'received'
    else 'partially_received'
  end;

  update warehouse.purchase_orders
    set lines = v_lines, status = v_status
    where id = payload->>'po_id'
    returning * into v_po;
  return to_jsonb(v_po);
end; $$;

-- ===========================================================================
-- adjust_stock — v7 body unchanged; actor forced on the movement record.
-- ===========================================================================
create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int; v_actor text;
begin
  if not core.has_cap('warehouse','cycle_count') then raise exception 'Not authorized: adjust_stock'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'movement' then payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(payload->'movement', v_actor)); end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units set status = 'lost', assigned_to = null where id = any(v_unit_ids) and status = 'in_stock';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'stock_delta') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    values (payload->'stock_delta'->>'product_id', payload->'stock_delta'->>'location_id', payload->'stock_delta'->>'bin_id', null, greatest(0, (payload->'stock_delta'->>'delta')::int))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end; $$;

-- ===========================================================================
-- create_purchase_order — v6 body unchanged; actor forced on the PO record
-- (status + origin were already server-stamped; actor now is too).
-- ===========================================================================
create or replace function warehouse.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders; v_actor text;
begin
  if not core.has_cap('warehouse','view_procurement') then raise exception 'Not authorized: view_procurement'; end if;
  v_actor := warehouse.authoritative_actor();
  if payload ? 'purchase_order' then payload := jsonb_set(payload, '{purchase_order}', warehouse.force_actor_on_object(payload->'purchase_order', v_actor)); end if;
  insert into warehouse.purchase_orders
    select * from jsonb_populate_record(null::warehouse.purchase_orders, payload->'purchase_order')
    returning * into v_po;
  update warehouse.purchase_orders set status = 'ordered', origin = 'warehouse' where id = v_po.id returning * into v_po;
  return to_jsonb(v_po);
end; $$;

-- ===========================================================================
-- Grants — re-assert the API surface for the replaced functions (never anon).
-- The internal helpers above are intentionally NOT granted.
-- ===========================================================================
do $$ declare fn text;
begin
  foreach fn in array array[
    'receive_stock','issue','transfer','record_return','record_cycle_count',
    'receive_against_po','adjust_stock','create_purchase_order'
  ]
  loop
    execute format('revoke all on function warehouse.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function warehouse.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
