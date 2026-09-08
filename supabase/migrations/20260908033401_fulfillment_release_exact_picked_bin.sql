-- Honor the confirmed per-line bin without changing legacy absent-bin behavior.
-- Patch only the bulk order-line release selector; retain locks, hold subtraction,
-- order source constraints, packaging selection and the public authority chain.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.warehouse_advance_fulfillment_order(jsonb)'::pg_catalog.regprocedure
  );
  old_text text := $old$where level.product_id = v_product.id and level.quantity > 0
            and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
            and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id)$old$;
  new_text text := $new$where level.product_id = v_product.id and level.quantity > 0
            and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
            and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id)
            and (nullif(v_line->>'pickBinId', '') is null or (
              level.bin_id = v_line->>'pickBinId'
              and exists (
                select 1 from warehouse.storage_areas picked_bin
                where picked_bin.id = level.bin_id
                  and picked_bin.location_id = level.location_id
                  and picked_bin.active
              )
            ))$new$;
begin
  if strpos(definition, new_text) > 0 then
    raise exception 'Exact picked-bin release selector is already installed';
  end if;
  if (length(definition) - length(replace(definition, old_text, '')))
       / length(old_text) <> 1 then
    raise exception 'Expected exactly one bulk fulfillment release selector; review installed definition before migrating';
  end if;
  execute replace(definition, old_text, new_text);
end;
$migration$;
