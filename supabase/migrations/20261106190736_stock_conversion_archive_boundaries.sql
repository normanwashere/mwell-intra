-- Retain conversion history and cached results; only fresh actions require active references.
set local lock_timeout='3s';
set local statement_timeout='30s';

create function private.stock_conversion_kit_archived(p_id uuid) returns boolean
language sql stable set search_path='' as $$
  select private.is_uat_warehouse_archived('kit_definitions',p_id::text)
    or exists(select 1 from warehouse.kit_definitions k where k.id=p_id and (
      private.is_uat_warehouse_archived('products',k.product_id)
      or exists(select 1 from jsonb_array_elements(k.components) c
        where private.is_uat_warehouse_archived('products',c->>'productId'))))
$$;

-- The same predicate serves new approval payloads and persisted recipe rows.
create function private.stock_conversion_recipe_archived(p_recipe jsonb) returns boolean
language sql stable set search_path='' as $$
  select private.stock_conversion_kit_archived((p_recipe->>'kit_definition_id')::uuid)
    or private.is_uat_warehouse_archived('events',p_recipe->>'event_id')
    or private.is_uat_warehouse_archived('products',p_recipe->>'source_product_id')
    or private.is_uat_warehouse_archived('products',p_recipe->>'output_product_id')
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_recipe->'packaging')='array'
      then p_recipe->'packaging' else '[]'::jsonb end) p
      where private.is_uat_warehouse_archived('products',p->>'product_id'))
$$;

create function private.stock_conversion_units_archived(p_units jsonb) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_units)='array' then p_units else '[]'::jsonb end) line
    where private.is_uat_warehouse_archived('quality_inspections',(line->>'inspection_id')::uuid::text)
      or private.is_uat_warehouse_archived('returns',line->>'return_id')
      or private.is_uat_warehouse_archived('allocations',line->>'allocation_id')
      or exists(select 1 from warehouse.inventory_units u where upper(btrim(u.serial_number))=upper(btrim(line->>'serial_number'))
        and (private.is_uat_warehouse_archived('inventory_units',u.id)
          or private.is_uat_warehouse_archived('products',u.product_id)
          or private.is_uat_warehouse_archived('lots',u.lot_id)
          or private.is_uat_warehouse_archived('storage_areas',u.bin_id)))
      or exists(select 1 from warehouse.quality_inspections q where q.id=(line->>'inspection_id')::uuid
        and (private.is_uat_warehouse_archived('products',q.product_id)
          or private.is_uat_warehouse_archived('lots',q.lot_id)
          or private.is_uat_warehouse_archived(case q.source_type when 'receipt' then 'receipts' when 'return' then 'returns' end,q.source_id))))
$$;

create function private.stock_conversion_batch_archived(p_batch private.stock_conversion_batches,p_check_origin boolean default true) returns boolean
language plpgsql stable set search_path='' as $$
begin
  return private.is_uat_warehouse_archived('events',p_batch.event_id)
    or private.is_uat_warehouse_archived('storage_areas',p_batch.source_bin_id)
    or private.is_uat_warehouse_archived('storage_areas',p_batch.destination_bin_id)
    or exists(select 1 from private.stock_conversion_recipes r where r.id=p_batch.recipe_id
      and private.stock_conversion_recipe_archived(to_jsonb(r)))
    or private.stock_conversion_units_archived(p_batch.units)
    or exists(select 1 from private.stock_conversion_claims c join warehouse.inventory_units u on u.id=c.unit_id
      where c.batch_id=p_batch.id and (private.is_uat_warehouse_archived('inventory_units',u.id)
        or private.is_uat_warehouse_archived('products',u.product_id)))
    or exists(select 1 from private.stock_conversion_parts p where p.batch_id=p_batch.id
      and (private.is_uat_warehouse_archived('products',p.product_id) or private.is_uat_warehouse_archived('lots',p.lot_id)
        or exists(select 1 from warehouse.stock_levels s where s.product_id=p.product_id and s.location_id=p.location_id
          and s.bin_id is not distinct from p.bin_id and s.lot_id is not distinct from p.lot_id
          and private.is_uat_warehouse_archived('stock_levels',s.id::text))))
    -- Recovery has exactly one original forward batch. Never follow an unbounded history chain.
    or (p_check_origin and exists(select 1 from jsonb_array_elements(coalesce(p_batch.units,'[]'::jsonb)) line
      join private.stock_conversion_batches origin on origin.id=(line->>'original_conversion_id')::uuid
      where private.stock_conversion_batch_archived(origin,false)));
end
$$;

create function private.assert_stock_conversion_not_archived(p_payload jsonb) returns void
language plpgsql volatile set search_path='' as $$
declare b private.stock_conversion_batches; blocked boolean;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Please retry this Warehouse change in a new session.';
  end if;
  -- Acquire before any business-row locks; the next statement sees archives committed while waiting.
  perform pg_advisory_xact_lock_shared(hashtextextended('uat-warehouse-fixture-archive',0));
  if p_payload->>'action'='approve_recipe' then
    blocked:=private.stock_conversion_recipe_archived(p_payload);
  elsif p_payload->>'action'='create' then
    b:=jsonb_populate_record(null::private.stock_conversion_batches,p_payload);
    blocked:=private.stock_conversion_batch_archived(b);
  else
    select * into b from private.stock_conversion_batches where id=(p_payload->>'batch_id')::uuid;
    blocked:=private.stock_conversion_batch_archived(b);
  end if;
  if blocked then
    raise exception 'This conversion references an archived UAT test record. Choose active stock and an active recipe to continue.';
  end if;
end $$;

alter function private.stock_conversion_kit_archived(uuid) owner to postgres;
alter function private.stock_conversion_recipe_archived(jsonb) owner to postgres;
alter function private.stock_conversion_units_archived(jsonb) owner to postgres;
alter function private.stock_conversion_batch_archived(private.stock_conversion_batches,boolean) owner to postgres;
alter function private.assert_stock_conversion_not_archived(jsonb) owner to postgres;
revoke all on function private.stock_conversion_kit_archived(uuid),private.stock_conversion_recipe_archived(jsonb),
  private.stock_conversion_units_archived(jsonb),private.stock_conversion_batch_archived(private.stock_conversion_batches,boolean),
  private.assert_stock_conversion_not_archived(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare spec record; edit record; definition text; metadata jsonb; after_metadata jsonb;
begin
  for spec in select * from (values
    ('warehouse.execute_stock_conversion(jsonb)','04aa5f5feba6975d61d7eddfef78f9da'),
    ('warehouse.stock_conversion_workspace(jsonb)','c7ed752e49d3d7471187b0ff66b2b4e8'),
    ('warehouse.stock_conversion_recipe_workspace(jsonb)','fbaeabc5a4d7f29e5e948d9c927fef4f')
  ) functions(signature,expected_hash) loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure(spec.signature)) is distinct from spec.expected_hash then
      raise exception 'Conversion archive predecessor drift: %',spec.signature;
    end if;
    select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata
      from pg_proc p where p.oid=spec.signature::regprocedure;
    for edit in select * from (values
      ('warehouse.execute_stock_conversion(jsonb)',
        $old$command_id:=(started->>'command_id')::uuid;$old$,
        $new$command_id:=(started->>'command_id')::uuid;
  perform private.assert_stock_conversion_not_archived(payload);$new$),
      ('warehouse.execute_stock_conversion(jsonb)',
        $old$for part in select * from warehouse.stock_levels where product_id=component->>'product_id'$old$,
        $new$for part in select * from warehouse.stock_levels where not private.is_uat_warehouse_archived('stock_levels',stock_levels.id::text)
            and not private.is_uat_warehouse_archived('lots',stock_levels.lot_id) and product_id=component->>'product_id'$new$),
      ('warehouse.stock_conversion_workspace(jsonb)',
        'select * from private.stock_conversion_recipes order by approved_at desc limit 200',
        'select * from private.stock_conversion_recipes recipe where not private.stock_conversion_recipe_archived(to_jsonb(recipe)) order by approved_at desc limit 200'),
      ('warehouse.stock_conversion_workspace(jsonb)',
        'select * from private.stock_conversion_batches order by created_at desc limit 200',
        'select batch.*,private.stock_conversion_batch_archived(batch) archived from private.stock_conversion_batches batch order by created_at desc limit 200'),
      ('warehouse.stock_conversion_workspace(jsonb)',
        'private.stock_conversion_qc_matches(u,q,null,true)',
        'private.stock_conversion_qc_matches(jsonb_populate_record(null::warehouse.inventory_units,to_jsonb(u)),jsonb_populate_record(null::warehouse.quality_inspections,to_jsonb(q)),null,true)'),
      ('warehouse.stock_conversion_recipe_workspace(jsonb)',
        $old$where kit.status='active'$old$,
        $new$where not private.stock_conversion_kit_archived(kit.id) and kit.status='active'$new$),
      ('warehouse.stock_conversion_recipe_workspace(jsonb)',
        $old$from warehouse.events where status<>'cancelled'$old$,
        $new$from warehouse.events where not private.is_uat_warehouse_archived('events',id) and status<>'cancelled'$new$),
      ('warehouse.stock_conversion_recipe_workspace(jsonb)',
        'select r.*,kit.name kit_name',
        'select r.*,private.stock_conversion_recipe_archived(to_jsonb(r)) archived,kit.name kit_name')
    ) edits(signature,old_text,new_text) where signature=spec.signature loop
      if (length(definition)-length(replace(definition,edit.old_text,'')))/length(edit.old_text)<>1 then
        raise exception 'Conversion archive anchor drift: %',spec.signature;
      end if;
      definition:=replace(definition,edit.old_text,edit.new_text);
    end loop;
    execute definition;
    select to_jsonb(p)-'prosrc' into after_metadata from pg_proc p where p.oid=spec.signature::regprocedure;
    if metadata is distinct from after_metadata then raise exception 'Conversion archive metadata changed: %',spec.signature; end if;
  end loop;
end $patch$;
