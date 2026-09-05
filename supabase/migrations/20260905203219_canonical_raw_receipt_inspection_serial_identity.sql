-- Preserve recorded receipt JSON. Canonicalize only identity comparisons and new
-- QC serials in the raw-receipt fallback; v3 PO-line custody and return routing
-- remain unchanged. Completed raw QC uses in_stock plus active holds for
-- quarantine, matching availability and the existing governed release handler.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.warehouse_inspect_quality(jsonb)'::pg_catalog.regprocedure
  );
  old_text text;
  new_text text;
begin
  for old_text, new_text in
    select * from (values
      ($old$and status in ('in_stock', 'returned')$old$,
       $new$and (status in ('in_stock', 'returned')
         or (v_source_type = 'receipt' and status = 'pending_inspection'))$new$),
      ($old$if v_requested_bin_id is not null and v_requested_bin_id is distinct from v_unit_bin_id then$old$,
       $new$if v_source_type = 'receipt' and v_bin_id is distinct from v_unit_bin_id then
      raise exception 'Serialized unit bin does not match the receipt bin';
    end if;
    if v_requested_bin_id is not null and v_requested_bin_id is distinct from v_unit_bin_id then$new$),
      ($old$) returning * into v_inspection;$old$,
       $new$) returning * into v_inspection;

  -- The INSERT above must pass the real independent-inspector trigger first.
  -- Existing holds remain active; non-accepted QC creates its hold below in this
  -- same transaction. ATP subtracts active holds; release does not change units.
  if v_source_type = 'receipt' and v_serial is not null then
    update warehouse.inventory_units u
       set status = 'in_stock'
     where u.product_id = v_product_id and u.serial_number = v_serial
       and u.location_id = v_location_id
       and u.bin_id is not distinct from v_bin_id
       and u.lot_id is not distinct from v_lot_id
       and u.status = 'pending_inspection';
  end if;$new$),
      ($old$v_serial text := nullif(payload->>'serial_number', '');$old$,
       $new$v_serial text := case when payload->>'source_type' = 'receipt'
    then nullif(pg_catalog.upper(pg_catalog.btrim(payload->>'serial_number')), '')
    else nullif(payload->>'serial_number', '') end;$new$),
      ($old$if v_serial is not null and v_quantity <> 1 then$old$,
       $new$if v_source_type = 'receipt' and payload->>'serial_number' <> ''
     and pg_catalog.btrim(payload->>'serial_number') = '' then
    raise exception 'Serial identity cannot be blank';
  end if;
  if v_serial is not null and v_quantity <> 1 then$new$),
      ($old$and serial = v_serial$old$,
       $new$and pg_catalog.upper(pg_catalog.btrim(serial)) = v_serial$new$),
      ($old$select count(*), max(nullif(line->>'binId', ''))$old$,
       $new$-- A serial is one custody identity, even if legacy evidence repeats its casing.
      if (select count(*) from jsonb_array_elements(v_receipt.lines) receipt_line
          cross join lateral jsonb_array_elements_text(
            coalesce(receipt_line->'serialNumbers', '[]'::jsonb)
          ) receipt_serial
          where receipt_line->>'productId' = v_product_id
            and pg_catalog.upper(pg_catalog.btrim(receipt_serial)) = v_serial) > 1 then
        raise exception 'Duplicate canonical serial identity in receipt';
      end if;
      select count(*), max(nullif(line->>'binId', ''))$new$),
      ($old$and disposition = 'pending';$old$,
       $new$and disposition = 'pending'
     and (v_source_type <> 'receipt' or v_serial is null
       or pg_catalog.upper(pg_catalog.btrim(serial_number)) = v_serial);$new$),
      ($old$and coalesce(serial_number, '') = coalesce(v_serial, '');$old$,
       $new$and coalesce(case when v_source_type = 'receipt'
       then pg_catalog.upper(pg_catalog.btrim(serial_number)) else serial_number end, '')
       = coalesce(v_serial, '');$new$)
    ) replacements(old_text, new_text)
  loop
    if (length(definition) - length(replace(definition, old_text, '')))
       / length(old_text) <> 1 then
      raise exception 'Unexpected raw receipt QC definition: canonical identity anchor missing or repeated';
    end if;
    definition := replace(definition, old_text, new_text);
  end loop;
  execute definition;
end;
$migration$;

-- CREATE OR REPLACE retains ownership and ACLs. Keep the fallback private.
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon, authenticated;
grant execute on function private.warehouse_inspect_quality(jsonb) to service_role;
