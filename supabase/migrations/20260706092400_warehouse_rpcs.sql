-- Mwell Intra — warehouse transactional RPCs (SECURITY DEFINER, v1->v8 behavior)
--
-- Ports every warehouse mutation RPC into its FINAL, fully-hardened shape
-- (source: transactional_rpcs v1/v2/v3 -> security_hardening v4 -> bin_reconcile
-- v5 -> po_lots_lockdown v6 -> rpc_integrity v7 -> receive_po_location_guard v8),
-- rewired onto the monorepo's authoritative RBAC.
--
-- SECURITY MODEL (unchanged from v4+): every stock/PO/allocation write is a
-- SECURITY DEFINER function that (a) opens with an explicit capability gate and
-- (b) is the ONLY path that can touch the locked-down tables (direct PostgREST
-- INSERT/UPDATE/DELETE on stock/audit/PO/lots was revoked in the RLS migration).
-- Bodies keep the concurrency-safe server-side logic: additive stock deltas
-- (`greatest(0, qty + delta)`), guarded status transitions, per-product advisory
-- lock in reserve(), bin-aware upserts (product,location,bin,lot), PO receipt
-- capping at ordered qty + server-derived status, etc.
--
-- RBAC REWIRE: the source `warehouse.has_cap('<cap>')` gate becomes
-- `core.has_cap('warehouse','<cap>')`, which reads core.user_roles +
-- core.role_capabilities for auth.uid() (spec §4.2). No warehouse-local RBAC
-- table is created. The gated caps are seeded in core.role_capabilities
-- (module='warehouse') by 20260706091000_core_seed_rbac.sql.
--
-- ADR-002 #1 (evidence -> core.documents): the receipt/return RPCs register each
-- evidence object in core.documents via the warehouse.register_evidence_docs()
-- helper below (files stay in the `evidence` bucket; only metadata is
-- registered). ADR-002 #2 (PO origin): create_purchase_order() stamps
-- origin='warehouse' server-side.
--
-- Re-runnable: create-or-replace + idempotent grant loop.

-- ===========================================================================
-- 0) Evidence -> core.documents registration helper (ADR-002 #1)
--    Runs as its definer-owner so it can write core.documents WITHOUT the caller
--    needing core's manage_documents/submit_documents cap (warehouse capture
--    roles legitimately produce evidence but hold no core document caps). It is
--    kept INTERNAL — never granted to API roles — and is only invoked from the
--    definer RPCs below.
--
--    core.documents.entity_id is uuid but warehouse ids are text, so we derive a
--    STABLE synthetic uuid from the warehouse entity id (md5(type:id)::uuid).
--    Recomputable, so the core.documents row is always joinable back to its
--    warehouse receipt/return. One row per storage path; de-duped on re-entry.
-- ===========================================================================
create or replace function warehouse.register_evidence_docs(
  p_entity_type text,
  p_entity_id   text,
  p_paths       jsonb
)
returns void language plpgsql security definer set search_path = warehouse, public as $$
declare v_path text; v_eid uuid;
begin
  if p_entity_id is null or jsonb_typeof(p_paths) <> 'array' then
    return;
  end if;
  v_eid := md5(p_entity_type || ':' || p_entity_id)::uuid;
  for v_path in select jsonb_array_elements_text(p_paths) loop
    if v_path is null or length(btrim(v_path)) = 0 then continue; end if;
    insert into core.documents (entity_type, entity_id, doc_type, storage_path, version, status, uploaded_by)
    select p_entity_type, v_eid, 'evidence', v_path, 1, 'submitted', auth.uid()
    where not exists (
      select 1 from core.documents d
      where d.entity_type = p_entity_type
        and d.entity_id = v_eid
        and d.storage_path = v_path
    );
  end loop;
end; $$;
revoke all on function warehouse.register_evidence_docs(text, text, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- ATP for a product = physical on-hand (stock rows + in-stock serialized units)
-- minus reserved/allocated qty. SECURITY DEFINER so reserve() can re-check
-- inside its transaction against a fresh, authoritative snapshot.
-- ===========================================================================
create or replace function warehouse.available_to_promise(p_product_id text)
returns integer
language sql
stable
security definer
set search_path = warehouse, public
as $$
  select greatest(
    0,
    (
      coalesce((select sum(quantity) from warehouse.stock_levels
                 where product_id = p_product_id), 0)
      + coalesce((select count(*) from warehouse.inventory_units
                   where product_id = p_product_id and status = 'in_stock'), 0)
    )
    - coalesce(
        (select sum(quantity) from warehouse.allocations
          where product_id = p_product_id
            and status in ('reserved','allocated')),
        0
      )
  );
$$;
revoke all on function warehouse.available_to_promise(text) from public, anon;
grant execute on function warehouse.available_to_promise(text) to authenticated, service_role;

-- ===========================================================================
-- receive_stock — lots + units + additive bin-aware stock deltas + movements +
-- receipt; registers receipt evidence in core.documents (ADR-002 #1).
-- ===========================================================================
create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_receipt warehouse.receipts;
begin
  if not core.has_cap('warehouse','receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
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
-- issue — product-bound serialized units OR multi-bin, sum-checked non-
-- serialized draw-down; guarded allocation transition reserved->issued (v7).
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
begin
  if not core.has_cap('warehouse','issue_items') then raise exception 'Not authorized: issue_items'; end if;
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
-- transfer — move serialized units OR shift non-serialized stock between bins;
-- source must cover the move and from/to magnitudes must match (v7).
-- ===========================================================================
create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int; v_from int; v_to int;
begin
  if not core.has_cap('warehouse','transfer_stock') then raise exception 'Not authorized: transfer_stock'; end if;
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
-- record_return — serialized dispositions (restocked units return to their
-- location/bin, v5) + restock deltas + movements + return doc; registers return
-- evidence in core.documents (ADR-002 #1).
-- ===========================================================================
create or replace function warehouse.record_return(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_ret warehouse.returns; v_unit jsonb;
begin
  if not core.has_cap('warehouse','manage_returns') then raise exception 'Not authorized: manage_returns'; end if;
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
-- record_cycle_count — set counted stock (create rows for counted bins that
-- don't exist yet, v3/v4) + movements + count doc.
-- ===========================================================================
create or replace function warehouse.record_cycle_count(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_cc warehouse.cycle_counts;
begin
  if not core.has_cap('warehouse','cycle_count') then raise exception 'Not authorized: cycle_count'; end if;
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
-- receive_against_po — cap at ordered qty, reject unknown/cancelled, server-
-- derived status (v8). Feeds BOTH warehouse- and procurement-origin POs.
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
begin
  if not core.has_cap('warehouse','receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
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
-- adjust_stock — serialized write-off OR additive stock delta + movement.
-- Gated on cycle_count (least privilege, v7 — NOT the ubiquitous manage_inventory).
-- ===========================================================================
create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if not core.has_cap('warehouse','cycle_count') then raise exception 'Not authorized: adjust_stock'; end if;
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
-- reserve — per-product advisory lock closes the ATP TOCTOU race; server-
-- authoritative status='reserved'; alloc must match the ATP-checked product/qty (v5).
-- ===========================================================================
create or replace function warehouse.reserve(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_atp int; v_pid text; v_qty int;
begin
  if not core.has_cap('warehouse','reserve_allocate') then raise exception 'Not authorized: reserve_allocate'; end if;
  v_pid := payload->>'product_id';
  v_qty := (payload->>'quantity')::int;
  if (payload->'allocation'->>'product_id') is distinct from v_pid then
    raise exception 'Allocation product does not match the checked product.';
  end if;
  if (payload->'allocation'->>'quantity')::int is distinct from v_qty then
    raise exception 'Allocation quantity does not match the checked quantity.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('warehouse.reserve:' || v_pid, 0));
  v_atp := warehouse.available_to_promise(v_pid);
  if v_qty <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
  if v_qty > v_atp then raise exception 'Cannot reserve % — only % available.', v_qty, v_atp; end if;
  insert into warehouse.allocations select * from jsonb_populate_record(null::warehouse.allocations, payload->'allocation') returning * into v_alloc;
  update warehouse.allocations set status = 'reserved' where id = v_alloc.id returning * into v_alloc;
  return to_jsonb(v_alloc);
end; $$;

-- ===========================================================================
-- cancel_allocation — atomic capability-checked cancel (v4).
-- ===========================================================================
create or replace function warehouse.cancel_allocation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations;
begin
  if not core.has_cap('warehouse','reserve_allocate') then raise exception 'Not authorized: reserve_allocate'; end if;
  update warehouse.allocations set status = 'cancelled'
  where id = payload->>'allocation_id' and status <> 'issued'
  returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found or already issued.'; end if;
  return to_jsonb(v_alloc);
end; $$;

-- ===========================================================================
-- set_product_price — price-only update (column-scoped, v4).
-- ===========================================================================
create or replace function warehouse.set_product_price(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_prod warehouse.products;
begin
  if not (core.has_cap('warehouse','set_pricing') or core.has_cap('warehouse','manage_products')) then
    raise exception 'Not authorized: set_pricing';
  end if;
  if (payload->>'price')::numeric < 0 then raise exception 'Price must be zero or more.'; end if;
  update warehouse.products set price = (payload->>'price')::numeric
  where id = payload->>'product_id' returning * into v_prod;
  if v_prod.id is null then raise exception 'Product not found.'; end if;
  return to_jsonb(v_prod);
end; $$;

-- ===========================================================================
-- delete_storage_area — atomic capability-checked delete (v4). The bin FK
-- (on delete set null) clears bin_id on units/stock.
-- ===========================================================================
create or replace function warehouse.delete_storage_area(payload jsonb)
returns void language plpgsql security definer set search_path = warehouse, public as $$
begin
  if not core.has_cap('warehouse','manage_locations') then raise exception 'Not authorized: manage_locations'; end if;
  delete from warehouse.storage_areas where id = payload->>'storage_area_id';
end; $$;

-- ===========================================================================
-- create_purchase_order — PO authoring (v6). Status AND origin are stamped
-- server-side: origin='warehouse' (ADR-002 #2 — this is the internal reorder /
-- replenishment path; procurement-origin POs arrive in Step 3). Never trust a
-- client-sent status/origin.
-- ===========================================================================
create or replace function warehouse.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders;
begin
  if not core.has_cap('warehouse','view_procurement') then raise exception 'Not authorized: view_procurement'; end if;
  insert into warehouse.purchase_orders
    select * from jsonb_populate_record(null::warehouse.purchase_orders, payload->'purchase_order')
    returning * into v_po;
  update warehouse.purchase_orders set status = 'ordered', origin = 'warehouse' where id = v_po.id returning * into v_po;
  return to_jsonb(v_po);
end; $$;

-- ===========================================================================
-- cancel_purchase_order — capability-checked, status server-authoritative (v6).
-- ===========================================================================
create or replace function warehouse.cancel_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders;
begin
  if not core.has_cap('warehouse','view_procurement') then raise exception 'Not authorized: view_procurement'; end if;
  update warehouse.purchase_orders set status = 'cancelled'
  where id = payload->>'po_id' and status not in ('received','cancelled')
  returning * into v_po;
  if v_po.id is null then raise exception 'Purchase order not found, already cancelled, or fully received.'; end if;
  return to_jsonb(v_po);
end; $$;

-- ===========================================================================
-- Grants — only authenticated + service_role may call these (never anon). The
-- internal warehouse.register_evidence_docs() helper is intentionally omitted
-- (it is called only from the definer RPCs above and stays unreachable via API).
-- ===========================================================================
do $$ declare fn text;
begin
  foreach fn in array array[
    'receive_stock','issue','transfer','record_return','record_cycle_count',
    'receive_against_po','adjust_stock','reserve','cancel_allocation',
    'set_product_price','delete_storage_area','create_purchase_order','cancel_purchase_order'
  ]
  loop
    execute format('revoke all on function warehouse.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function warehouse.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
