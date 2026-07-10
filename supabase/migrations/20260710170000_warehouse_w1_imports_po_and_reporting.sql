-- Normalize the procurement PO handoff and expose only governed receivable POs.

alter table procurement.purchase_orders add column if not exists po_number text;
alter table procurement.purchase_orders add column if not exists vendor_name text;
alter table procurement.purchase_orders add column if not exists actor_email text;
alter table procurement.purchase_orders add column if not exists lines jsonb not null default '[]'::jsonb;
alter table procurement.purchase_orders add column if not exists total numeric(14, 2) not null default 0;
alter table procurement.purchase_orders add column if not exists approved_at timestamptz;
alter table procurement.purchase_orders add column if not exists approved_by_email text;
alter table procurement.purchase_orders add column if not exists approval_signature jsonb;

update procurement.purchase_orders po
   set po_number = coalesce(po.po_number, 'PO-' || upper(substr(replace(po.id::text, '-', ''), 1, 12))),
       vendor_name = coalesce(po.vendor_name, vendor.legal_name, 'Unknown vendor')
  from core.vendors vendor
 where vendor.id = po.core_vendor_id
   and (po.po_number is null or po.vendor_name is null);

create unique index if not exists procurement_purchase_orders_number_uq
  on procurement.purchase_orders(po_number) where po_number is not null;

alter table procurement.purchase_order_lines add column if not exists uom text;
alter table procurement.purchase_order_lines
  add column if not exists received_quantity numeric(14, 4) not null default 0;
alter table procurement.purchase_order_lines
  add column if not exists warehouse_product_id text
  references warehouse.products(id) on delete restrict;

create unique index if not exists warehouse_products_sku_ci_uq
  on warehouse.products(lower(sku));
create unique index if not exists warehouse_inventory_units_serial_uq
  on warehouse.inventory_units(serial_number);

drop policy if exists warehouse_receivable_pos_read on procurement.purchase_orders;
create policy warehouse_receivable_pos_read on procurement.purchase_orders
  for select to authenticated
  using (
    core.has_cap('warehouse', 'receive_stock')
    and status in ('approved', 'issued')
  );

drop policy if exists warehouse_receivable_po_lines_read on procurement.purchase_order_lines;
create policy warehouse_receivable_po_lines_read on procurement.purchase_order_lines
  for select to authenticated
  using (
    core.has_cap('warehouse', 'receive_stock')
    and exists (
      select 1 from procurement.purchase_orders po
       where po.id = purchase_order_id and po.status in ('approved', 'issued')
    )
  );

create or replace view warehouse.procurement_po_handoff
with (security_invoker = true)
as
select
  po.id::text as id,
  coalesce(po.po_number, po.id::text) as po_number,
  coalesce(po.vendor_name, 'Unknown vendor') as vendor_name,
  po.status,
  po.expected_date,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'id', line.id::text,
      'productId', line.warehouse_product_id,
      'description', line.description,
      'quantity', line.quantity,
      'receivedQuantity', line.received_quantity,
      'uom', line.uom
    ) order by line.line_no, line.id
  ) filter (where line.id is not null), '[]'::jsonb) as lines
from procurement.purchase_orders po
left join procurement.purchase_order_lines line on line.purchase_order_id = po.id
where po.status in ('approved', 'issued')
group by po.id, po.po_number, po.vendor_name, po.status, po.expected_date;

revoke all on warehouse.procurement_po_handoff from public, anon;
grant select on warehouse.procurement_po_handoff to authenticated, service_role;

create or replace function private.warehouse_receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_po procurement.purchase_orders;
  v_line procurement.purchase_order_lines;
  v_product warehouse.products;
  v_route_id uuid;
  v_route_requires_evidence boolean;
  v_supplier_id text;
  v_receipt_id text := 'rcpt-' || replace(gen_random_uuid()::text, '-', '');
  v_movement_id text;
  v_unit_id text;
  v_lot_id text;
  v_payload_line jsonb;
  v_receipt_lines jsonb := '[]'::jsonb;
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_serials jsonb;
  v_serial text;
  v_quantity numeric;
  v_closed boolean;
  v_receipt warehouse.receipts;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'receive_procurement_po', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one procurement PO line is required';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'lines') item
     group by item->>'line_id' having count(*) > 1
  ) then
    raise exception 'A procurement PO line cannot be received twice in one command';
  end if;

  select * into v_po
    from procurement.purchase_orders
   where id::text = payload->>'po_id'
   for update;
  if not found then raise exception 'Procurement purchase order not found'; end if;
  if v_po.status not in ('approved', 'issued') then
    raise exception 'Only approved or issued procurement POs can be received';
  end if;
  v_supplier_id := 'proc-' || v_po.core_vendor_id::text;
  insert into warehouse.suppliers(id, name, lead_time_days)
  values (v_supplier_id, coalesce(v_po.vendor_name, 'Procurement vendor'), 0)
  on conflict (id) do update set name = excluded.name;
  if not exists (
    select 1 from warehouse.locations
     where id = payload->>'location_id' and type = 'warehouse'
  ) then
    raise exception 'Receiving destination must be a warehouse';
  end if;
  if nullif(payload->>'bin_id', '') is not null and not exists (
    select 1 from warehouse.storage_areas
     where id = payload->>'bin_id'
       and location_id = payload->>'location_id'
       and active
  ) then
    raise exception 'Receiving bin is invalid or inactive';
  end if;

  select route.id, route.requires_evidence into v_route_id, v_route_requires_evidence
    from warehouse.operation_routes route
    join warehouse.operation_types operation on operation.id = route.operation_type_id
   where operation.code = 'receipt' and operation.active and route.active
     and 'vendor' = any(route.source_location_types)
     and 'warehouse' = any(route.destination_location_types)
   order by route.created_at, route.id
   limit 1;
  if v_route_id is null then raise exception 'No active vendor-to-warehouse receipt route'; end if;
  if v_route_requires_evidence and jsonb_array_length(v_evidence) = 0 then
    raise exception 'Delivery evidence is required by the active receipt route';
  end if;

  for v_payload_line in select value from jsonb_array_elements(payload->'lines')
  loop
    select * into v_line
      from procurement.purchase_order_lines
     where id::text = v_payload_line->>'line_id'
       and purchase_order_id = v_po.id
     for update;
    if not found then raise exception 'Procurement PO line not found'; end if;

    v_quantity := (v_payload_line->>'quantity')::numeric;
    if v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Warehouse receipt quantity must be a positive whole number';
    end if;
    if v_line.received_quantity + v_quantity > v_line.quantity then
      raise exception 'Receipt quantity exceeds the procurement PO line balance';
    end if;

    select * into v_product from warehouse.products
     where id = v_payload_line->>'product_id';
    if not found then raise exception 'Warehouse product mapping not found'; end if;
    if v_line.warehouse_product_id is not null
       and v_line.warehouse_product_id <> v_product.id then
      raise exception 'Procurement PO line is mapped to a different Warehouse product';
    end if;
    update procurement.purchase_order_lines
       set warehouse_product_id = v_product.id
     where id = v_line.id and warehouse_product_id is null;

    v_serials := coalesce(v_payload_line->'serial_numbers', '[]'::jsonb);
    if jsonb_typeof(v_serials) <> 'array' then raise exception 'Serial numbers must be an array'; end if;
    if v_product.serialized and jsonb_array_length(v_serials) <> v_quantity then
      raise exception 'Serialized receipt quantity must match its serial count';
    end if;
    if not v_product.serialized and jsonb_array_length(v_serials) > 0 then
      raise exception 'Bulk products cannot include serial numbers';
    end if;
    if jsonb_array_length(v_serials) <> (
      select count(distinct serial_number)
        from jsonb_array_elements_text(v_serials) as scanned(serial_number)
    ) then
      raise exception 'Duplicate serial number in procurement receipt';
    end if;

    v_lot_id := null;
    if nullif(v_payload_line->>'lot_code', '') is not null
       or nullif(v_payload_line->>'expiry_date', '') is not null
       or v_product.expiry_tracked then
      if v_product.expiry_tracked and nullif(v_payload_line->>'expiry_date', '') is null then
        raise exception 'Expiry date is required for expiry-tracked stock';
      end if;
      v_lot_id := 'lot-' || replace(gen_random_uuid()::text, '-', '');
      insert into warehouse.lots(
        id, product_id, lot_code, supplier_id, unit_cost, received_at, expiry_date
      ) values (
        v_lot_id, v_product.id,
        coalesce(nullif(v_payload_line->>'lot_code', ''), 'PO-' || v_po.id::text),
        v_supplier_id, v_product.unit_cost, now(), nullif(v_payload_line->>'expiry_date', '')::date
      );
    end if;

    if v_product.serialized then
      for v_serial in select value from jsonb_array_elements_text(v_serials)
      loop
        if exists (
          select 1 from warehouse.inventory_units
           where product_id = v_product.id and serial_number = v_serial
        ) then
          raise exception 'Serial number already exists: %', v_serial;
        end if;
        v_unit_id := 'unit-' || replace(gen_random_uuid()::text, '-', '');
        insert into warehouse.inventory_units(
          id, product_id, serial_number, lot_id, location_id, bin_id, status
        ) values (
          v_unit_id, v_product.id, v_serial, v_lot_id,
          payload->>'location_id', nullif(payload->>'bin_id', ''), 'in_stock'
        );
      end loop;
    else
      insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
      values (
        v_product.id, payload->>'location_id', nullif(payload->>'bin_id', ''),
        v_lot_id, v_quantity::integer
      )
      on conflict (product_id, location_id, bin_id, lot_id)
      do update set quantity = warehouse.stock_levels.quantity + excluded.quantity;
    end if;

    v_movement_id := 'mv-' || replace(gen_random_uuid()::text, '-', '');
    insert into warehouse.movements(
      id, type, product_id, quantity, to_location_id, to_bin_id, lot_id,
      reference, evidence_urls, actor, created_at
    ) values (
      v_movement_id, 'receipt', v_product.id, v_quantity::integer,
      payload->>'location_id', nullif(payload->>'bin_id', ''), v_lot_id,
      v_receipt_id, v_evidence, coalesce(auth.jwt()->>'email', auth.uid()::text), now()
    );

    v_receipt_lines := v_receipt_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'quantity', v_quantity::integer,
      'binId', nullif(payload->>'bin_id', ''),
      'lotCode', nullif(v_payload_line->>'lot_code', ''),
      'expiryDate', nullif(v_payload_line->>'expiry_date', ''),
      'serialNumbers', v_serials,
      'procurementLineId', v_line.id::text
    ));

    insert into warehouse.quality_inspections(
      source_type, source_id, product_id, lot_id, location_id, bin_id,
      quantity, disposition, evidence_urls, inspected_by, inspected_by_email
    ) values (
      'receipt', v_receipt_id, v_product.id, v_lot_id,
      payload->>'location_id', nullif(payload->>'bin_id', ''),
      v_quantity::integer, 'pending', v_evidence, auth.uid(),
      coalesce(auth.jwt()->>'email', '')
    );

    update procurement.purchase_order_lines
       set received_quantity = received_quantity + v_quantity
     where id = v_line.id;
  end loop;

  select not exists (
    select 1 from procurement.purchase_order_lines
     where purchase_order_id = v_po.id and received_quantity < quantity
  ) into v_closed;
  if v_closed then
    update procurement.purchase_orders set status = 'closed', updated_at = now()
     where id = v_po.id returning * into v_po;
  else
    update procurement.purchase_orders set updated_at = now()
     where id = v_po.id returning * into v_po;
  end if;

  insert into warehouse.receipts(
    id, supplier_id, location_id, lines, evidence_urls, actor, created_at,
    operation_route_id, procurement_po_id, quality_status
  ) values (
    v_receipt_id, v_supplier_id, payload->>'location_id', v_receipt_lines, v_evidence,
    coalesce(auth.jwt()->>'email', auth.uid()::text), now(),
    v_route_id, v_po.id::text, 'pending'
  ) returning * into v_receipt;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'procurement_purchase_order', v_po.id::text,
    'received', auth.uid(),
    jsonb_build_object(
      'procurement_po_id', v_po.id::text,
      'warehouse_receipt_id', v_receipt.id,
      'closed', v_closed,
      'lines', v_receipt_lines
    )
  );

  v_response := jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'purchase_order', to_jsonb(v_po)
  );
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_receive_procurement_po(payload) $$;

revoke all on function private.warehouse_receive_procurement_po(jsonb) from public, anon;
revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
grant execute on function private.warehouse_receive_procurement_po(jsonb) to authenticated, service_role;
grant execute on function warehouse.receive_procurement_po(jsonb) to authenticated, service_role;

create or replace function private.warehouse_apply_import_job(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_job warehouse.import_jobs;
  v_row jsonb;
  v_product warehouse.products;
  v_location_id text;
  v_bin_id text;
  v_product_id text;
  v_movement_id text;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'apply_import_job', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'import_warehouse_data') then
    raise exception 'Not authorized: warehouse.import_warehouse_data';
  end if;
  if jsonb_typeof(payload->'normalized_rows') <> 'array' then
    raise exception 'Normalized import rows must be an array';
  end if;

  select * into v_job
    from warehouse.import_jobs
   where id = (payload->>'job_id')::uuid
   for update;
  if not found then raise exception 'Import job not found'; end if;
  if v_job.created_by = auth.uid() then
    raise exception 'Import creator cannot apply their own job';
  end if;
  if v_job.status <> 'ready' then raise exception 'Only ready imports can be applied'; end if;
  if v_job.checksum_sha256 <> payload->>'checksum_sha256' then
    raise exception 'Import checksum mismatch';
  end if;
  if v_job.schema_version <> payload->>'schema_version' then
    raise exception 'Import schema version mismatch';
  end if;
  if v_job.accepted_rows <> jsonb_array_length(payload->'normalized_rows')
     or v_job.source_rows <> v_job.accepted_rows + v_job.rejected_rows + v_job.duplicate_rows then
    raise exception 'Import row reconciliation mismatch';
  end if;

  update warehouse.import_jobs set status = 'applying' where id = v_job.id;

  if v_job.import_kind = 'locations_bins_v1' then
    for v_row in select value from jsonb_array_elements(payload->'normalized_rows')
    loop
      v_location_id := v_row->>'locationExternalId';
      insert into warehouse.locations(id, name, type)
      values (v_location_id, v_row->>'locationName', v_row->>'locationType')
      on conflict (id) do update set name = excluded.name, type = excluded.type;

      v_bin_id := 'bin-' || substr(md5(lower(v_location_id || '|' || (v_row->>'binCode'))), 1, 24);
      insert into warehouse.storage_areas(id, location_id, code, label, zone, active)
      values (
        v_bin_id, v_location_id, v_row->>'binCode', nullif(v_row->>'binLabel', ''),
        nullif(v_row->>'zone', ''), coalesce((v_row->>'active')::boolean, true)
      )
      on conflict (location_id, code) do update set
        label = excluded.label, zone = excluded.zone, active = excluded.active;
    end loop;
  elsif v_job.import_kind = 'products_opening_stock_v1' then
    for v_row in select value from jsonb_array_elements(payload->'normalized_rows')
    loop
      select * into v_product
        from warehouse.products
       where lower(sku) = lower(v_row->>'sku')
       for update;
      if found then
        if v_product.serialized <> (v_row->>'serialized')::boolean
           or v_product.category <> v_row->>'category' then
          raise exception 'Existing product contract conflicts with SKU %', v_row->>'sku';
        end if;
        v_product_id := v_product.id;
        update warehouse.products
           set name = v_row->>'productName',
               unit_cost = (v_row->>'unitCost')::numeric,
               reorder_point = (v_row->>'reorderPoint')::integer
         where id = v_product_id;
      else
        v_product_id := 'prod-' || replace(gen_random_uuid()::text, '-', '');
        insert into warehouse.products(
          id, sku, name, category, serialized, attributes, unit_cost, reorder_point
        ) values (
          v_product_id, v_row->>'sku', v_row->>'productName', v_row->>'category',
          (v_row->>'serialized')::boolean, '{}'::jsonb,
          (v_row->>'unitCost')::numeric, (v_row->>'reorderPoint')::integer
        );
      end if;

      v_location_id := v_row->>'locationExternalId';
      select id into v_bin_id from warehouse.storage_areas
       where location_id = v_location_id and code = v_row->>'binCode' and active
       for update;
      if v_bin_id is null then raise exception 'Import bin was not found or is inactive'; end if;

      if (v_row->>'quantity')::integer > 0 then
      if (v_row->>'serialized')::boolean then
        if exists (
          select 1 from warehouse.inventory_units
           where serial_number = v_row->>'serialNumber'
        ) then
          raise exception 'Imported serial already exists: %', v_row->>'serialNumber';
        end if;
        insert into warehouse.inventory_units(
          id, product_id, serial_number, location_id, bin_id, status
        ) values (
          'unit-' || replace(gen_random_uuid()::text, '-', ''),
          v_product_id, v_row->>'serialNumber', v_location_id, v_bin_id, 'in_stock'
        );
      else
        insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
        values (
          v_product_id, v_location_id, v_bin_id, null, (v_row->>'quantity')::integer
        )
        on conflict (product_id, location_id, bin_id, lot_id)
        do update set quantity = warehouse.stock_levels.quantity + excluded.quantity;
      end if;

      v_movement_id := 'mv-' || replace(gen_random_uuid()::text, '-', '');
      insert into warehouse.movements(
        id, type, product_id, quantity, to_location_id, to_bin_id,
        reason, reference, actor, created_at
      ) values (
        v_movement_id, 'adjustment', v_product_id, (v_row->>'quantity')::integer,
        v_location_id, v_bin_id, 'Governed opening balance import', v_job.id::text,
        coalesce(auth.jwt()->>'email', auth.uid()::text), now()
      );
      end if;
    end loop;
  else
    raise exception 'Unsupported import kind';
  end if;

  update warehouse.import_jobs
     set status = 'applied', reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now()
   where id = v_job.id
   returning * into v_job;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'import_job', v_job.id, 'applied', auth.uid(),
    jsonb_build_object(
      'import_kind', v_job.import_kind,
      'checksum_sha256', v_job.checksum_sha256,
      'source_rows', v_job.source_rows,
      'accepted_rows', v_job.accepted_rows,
      'rejected_rows', v_job.rejected_rows,
      'duplicate_rows', v_job.duplicate_rows
    )
  );

  v_response := to_jsonb(v_job);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function warehouse.apply_import_job(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_apply_import_job(payload) $$;

revoke all on function private.warehouse_apply_import_job(jsonb) from public, anon;
revoke all on function warehouse.apply_import_job(jsonb) from public, anon;
grant execute on function private.warehouse_apply_import_job(jsonb) to authenticated, service_role;
grant execute on function warehouse.apply_import_job(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
