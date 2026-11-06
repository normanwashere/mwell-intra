-- Retire active receiving context, never source records, serial identities or PO history.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare item record;
begin
  for item in select * from (values
    ('private.external_po_all_lines_archived(uuid)','40dee124a419079d942bf99178919f51'),
    ('private.guard_uat_archived_external_po_write()','7cbf200492eb5a43ebaa423997d2567a'),
    ('private.guard_uat_archived_warehouse_write()','1ccd0ed4bb034f13ba6734ecbd54932d'),
    ('private.uat_warehouse_references(jsonb,text)','37655d996dc4b6ade61c8147a08542a3'),
    ('private.warehouse_receipt_exception_work_items_v3(jsonb)','e32aae2615b61f68cfb02dc7223a412f'),
    ('warehouse.procurement_receipt_excess_work_items(jsonb)','72abb36a933687ec88488fd581ef6362')
  ) expected(signature,body_md5) loop
    if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature)
      and md5(replace(p.prosrc,chr(13),''))=item.body_md5) then
      raise exception 'Receiving archive predecessor drift: %',item.signature;
    end if;
  end loop;
end $preflight$;

create function private.uat_receiving_image_archived(p_image jsonb) returns boolean
language sql stable security definer set search_path='' as $function$
  -- Resolve only the typed decision parent. Traverse structured receipt/draft fields,
  -- not evidence, free text or arbitrary UUID-shaped strings.
  with recursive roots(image) as (
    select p_image
    union all
    select to_jsonb(d) from warehouse.procurement_receipt_exception_decisions d
      where d.id::text=p_image->>'decision_id'
  ), nodes(image) as (
    select image from roots
    union all
    select child.image from nodes n cross join lateral (
      select a.value image from jsonb_array_elements(
        case when jsonb_typeof(n.image)='array' then n.image else '[]'::jsonb end) a
      union all
      select o.value from jsonb_each(
        case when jsonb_typeof(n.image)='object' then n.image else '{}'::jsonb end) o
        where o.key in ('lines','facts','body')
    ) child
  )
  select private.is_uat_warehouse_archived('procurement_receipt_exception_decisions',p_image->>'decision_id')
    or exists(select 1 from nodes n where
      private.is_uat_warehouse_archived('receipts',n.image->>'receipt_id')
      or private.is_uat_warehouse_archived('receipts',n.image->>'source_receipt_id')
      or private.is_uat_warehouse_archived('exceptions',n.image->>'exception_id')
      or exists(select 1 from (values
        (n.image->>'product_id'),(n.image->>'productId'),
        (n.image->>'mapped_product_id'),(n.image->>'mappedProductId'),
        (n.image->>'identified_product_id'),(n.image->>'identifiedProductId')
      ) product(id) where private.is_uat_warehouse_archived('products',product.id)))
$function$;
alter function private.uat_receiving_image_archived(jsonb) owner to postgres;
revoke all on function private.uat_receiving_image_archived(jsonb) from public,anon,authenticated,service_role;

create function private.guard_uat_archived_receiving_write() returns trigger
language plpgsql security definer set search_path='' as $function$
declare image jsonb;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Please retry this Warehouse change in a new session.';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('uat-warehouse-fixture-archive',0));
  -- Drafts are not archive members. Preserve saved mixed progress and its existing
  -- clear/correct workflow; only newly saved bodies are checked for retired inputs.
  if tg_table_name='receiving_drafts' then
    if private.uat_receiving_image_archived(new.body) then
      raise exception 'This is archived UAT receiving context. Choose active items to continue.';
    end if;
    return new;
  end if;
  foreach image in array case when tg_op='INSERT' then array[to_jsonb(new)]
    when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end loop
    if private.uat_receiving_image_archived(image) then
      raise exception 'This is archived UAT receiving context. Choose active items to continue.';
    end if;
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $function$;
alter function private.guard_uat_archived_receiving_write() owner to postgres;
revoke all on function private.guard_uat_archived_receiving_write() from public,anon,authenticated,service_role;

do $triggers$
declare t text;
begin
  foreach t in array array['receipts','procurement_receipt_exception_decisions',
    'procurement_receipt_exception_lines','procurement_receipt_serial_claims',
    'unidentified_receipt_custody','procurement_receipt_excess_custody'] loop
    execute format('create trigger uat_archived_receiving_write_guard before insert or update or delete on warehouse.%I for each row execute function private.guard_uat_archived_receiving_write()',t);
  end loop;
end $triggers$;
create trigger uat_archived_receiving_write_guard before insert or update on warehouse.receiving_drafts
for each row execute function private.guard_uat_archived_receiving_write();

do $patch$
declare item record; definition text; changed text; metadata jsonb; after_metadata jsonb;
begin
  for item in select * from (values
    ('private.external_po_all_lines_archived(uuid)',
      'select exists(select 1 from private.external_po_lines l where l.order_id=p_order)',
      'select private.is_uat_warehouse_archived(''external_po_orders'',p_order::text) or (exists(select 1 from private.external_po_lines l where l.order_id=p_order)'),
    ('private.guard_uat_archived_external_po_write()',
      'elsif tg_table_name=''external_po_shipments'' then',
      'elsif tg_table_name=''external_po_shipments'' then blocked:=blocked or private.is_uat_warehouse_archived(''receipts'',image->>''receipt_id'');'),
    ('private.warehouse_receipt_exception_work_items_v3(jsonb)',
      'where decision.status in (''pending'',''escalated'')',
      'where decision.status in (''pending'',''escalated'') and not private.uat_receiving_image_archived(to_jsonb(decision.*))'),
    ('warehouse.procurement_receipt_excess_work_items(jsonb)',
      'where custody.status in (''pending'',''held'')',
      'where custody.status in (''pending'',''held'') and not private.uat_receiving_image_archived(to_jsonb(custody.*))')
  ) replacements(signature,anchor,replacement) loop
    select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata
      from pg_proc p where p.oid=to_regprocedure(item.signature);
    if (length(definition)-length(replace(definition,item.anchor,'')))/length(item.anchor)<>1 then
      raise exception 'Receiving archive replacement anchor drift: %',item.signature;
    end if;
    changed:=replace(definition,item.anchor,item.replacement);
    if item.signature='private.external_po_all_lines_archived(uuid)' then
      -- Parenthesize the old predicate so retirement also covers zero-line orders.
      if (length(changed)-length(replace(changed,'l.product_id))','')))/length('l.product_id))')<>1 then
        raise exception 'External PO archive closing anchor drift';
      end if;
      changed:=replace(changed,'l.product_id))','l.product_id)))');
    end if;
    execute changed;
    select to_jsonb(p)-'prosrc' into after_metadata from pg_proc p where p.oid=to_regprocedure(item.signature);
    if metadata is distinct from after_metadata then
      raise exception 'Receiving archive function metadata changed: %',item.signature;
    end if;
  end loop;
end $patch$;
