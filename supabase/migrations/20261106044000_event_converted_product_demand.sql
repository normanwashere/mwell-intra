-- Include converted products and bind availability validation to each requested ID.
-- Authority, approvals and stock calculations remain unchanged.
begin;

select pg_catalog.set_config('lock_timeout',
  (case when setting::bigint=0 then 5000 else least(setting::bigint,5000) end)::text || 'ms',true)
from pg_catalog.pg_settings where name='lock_timeout';
select pg_catalog.set_config('statement_timeout',
  (case when setting::bigint=0 then 60000 else least(setting::bigint,60000) end)::text || 'ms',true)
from pg_catalog.pg_settings where name='statement_timeout';

do $$
declare
  target record;
  target_oid oid;
  original_body text;
  expected_body text;
  original_metadata jsonb;
  definition text;
begin
  for target in select * from (values
    ('warehouse.request_event_fulfillment_uncertified_impl(jsonb)',
     'ecbd995f23517b33abc4076a2b07755e',
     'v_product.item_class not in (''sellable_sku'', ''merchandise'', ''event_material'')',
     'v_product.item_class not in (''sellable_sku'', ''re_kitted_item'', ''merchandise'', ''event_material'')'),
    ('warehouse.event_demand_availability(jsonb)',
     '45ee5d3ce5f39f36d289991392efa7b9',
     'select 1 from unnest(ids) id where not exists(select 1 from warehouse.products p where p.id=id and p.item_class in (''sellable_sku'',''merchandise'',''event_material''))',
     'select 1 from unnest(ids) requested(product_id) where not exists(select 1 from warehouse.products p where p.id=requested.product_id and p.item_class in (''sellable_sku'',''re_kitted_item'',''merchandise'',''event_material''))')
  ) as targets(signature,predecessor_md5,old_guard,new_guard) loop
    target_oid:=to_regprocedure(target.signature);
    select prosrc,to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid)
      into original_body,original_metadata,definition from pg_proc p where p.oid=target_oid;
    if md5(replace(original_body,chr(13),'')) is distinct from target.predecessor_md5 then
      raise exception 'Event product eligibility predecessor drift for %; review before migrating',target.signature;
    end if;
    if (length(original_body)-length(replace(original_body,target.old_guard,'')))/length(target.old_guard)<>1 then
      raise exception 'Event product eligibility guard must occur exactly once for %',target.signature;
    end if;
    expected_body:=replace(original_body,target.old_guard,target.new_guard);
    definition:=replace(definition,target.old_guard,target.new_guard);
    if target.signature='warehouse.request_event_fulfillment_uncertified_impl(jsonb)' then
      expected_body:=replace(expected_body,
        'Event requests may include only sellable SKU, merchandise, and event material items',
        'Choose a sellable product, converted product, merchandise, or event material');
      definition:=replace(definition,
        'Event requests may include only sellable SKU, merchandise, and event material items',
        'Choose a sellable product, converted product, merchandise, or event material');
    end if;
    execute definition;
    if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target_oid) is distinct from original_metadata
      or (select prosrc from pg_proc where oid=target_oid) is distinct from expected_body
      or to_regprocedure(target.signature)::oid is distinct from target_oid then
      raise exception 'Event eligibility replacement changed unreviewed function metadata or logic for %',target.signature;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
