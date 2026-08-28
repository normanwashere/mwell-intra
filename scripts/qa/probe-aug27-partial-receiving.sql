-- UAT fixtures only. This probe must always remain inside this rolled-back transaction.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9933d59-6993-4d2f-b8c3-824aa9186f14',true);
do $probe$
declare
  v_line record;
  v_payload jsonb;
  v_result jsonb;
  v_index int := 0;
begin
  if (select count(*) from procurement.purchase_order_lines
      where purchase_order_id='UAT-AUG24-PO-0001' and quantity=100 and received_quantity=0) <> 4 then
    raise exception 'The shared UAT fixture has progressed. Do not reset it for this probe.';
  end if;
  for v_line in select * from procurement.purchase_order_lines
      where purchase_order_id='UAT-AUG24-PO-0001' order by id loop
    v_index := v_index + 1;
    perform set_config('request.jwt.claim.sub',case when v_index % 2 = 0
      then '60bdca8a-14dd-4297-b9a8-be64e9e7a1cc'
      else 'c9933d59-6993-4d2f-b8c3-824aa9186f14' end,true);
    v_payload := jsonb_build_object(
      'idempotency_key','aug27-rollback-receipt-line-'||v_index,
      'po_id','UAT-AUG24-PO-0001','location_id','uat-aug24-pasig-main',
      'bin_id','uat-aug24-bin-q0101',
      'evidence_urls',jsonb_build_array('https://example.com/aug27-rollback-delivery-evidence'),
      'lines',jsonb_build_array(jsonb_build_object(
        'line_id',v_line.id,'product_id',v_line.warehouse_product_id,
        'expected_quantity',(v_line.quantity-v_line.received_quantity)::integer,
        'outcomes',jsonb_build_object(
          'clean',jsonb_build_object('quantity',100,'serial_numbers',
            (select jsonb_agg('AUG27-ROLLBACK-'||v_index||'-'||n) from generate_series(1,100) n)),
          'damaged',jsonb_build_object('quantity',0),
          'unidentified',jsonb_build_object('quantity',0),
          'short',jsonb_build_object('quantity',0),
          'excess',jsonb_build_object('quantity',0)))));
    v_result := warehouse.receive_procurement_po(v_payload);
    if v_result is distinct from warehouse.receive_procurement_po(v_payload) then
      raise exception 'Replay returned a different response';
    end if;
    if (select count(*) from warehouse.inventory_units
        where serial_number like 'AUG27-ROLLBACK-'||v_index||'-%') <> 100 then
      raise exception 'Serial readback failed';
    end if;
    if not exists(select 1 from warehouse.quality_inspections q
      join warehouse.inventory_holds h on h.inspection_id=q.id
      where q.source_id=v_result#>>'{receipt,id}' and q.disposition='pending' and h.status='active') then
      raise exception 'Quality hold missing';
    end if;
    if not exists(select 1 from procurement.purchase_order_lines
      where id=v_line.id and received_quantity=100) then
      raise exception 'Selected line did not persist';
    end if;
    if (select count(*) from procurement.purchase_order_lines
      where purchase_order_id='UAT-AUG24-PO-0001' and received_quantity=0) <> 4-v_index then
      raise exception 'Unselected line changed';
    end if;
  end loop;
  perform set_config('qa.aug27_receiving_probe',
    'PASS: four independent SKU receipts, two actors, serial readback, Quality hold, exact replay',true);
end;
$probe$;
select current_setting('qa.aug27_receiving_probe') as result;
rollback;
