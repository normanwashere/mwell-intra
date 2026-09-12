-- UAT-only disposable fixtures for vendor-po-ack-live.mjs; no email or stock movement.
begin;
do $$
declare v_vendor uuid; v_suffix text; v_id text;
begin
  select vendor_id into strict v_vendor from core.profiles
  where email = 'intra.ci.checkpoint-v1.vendor@mwell.com.ph' and kind = 'vendor' and status = 'active';
  if v_vendor is null then raise exception 'Expected isolated UAT vendor'; end if;
  foreach v_suffix in array array['D', 'M'] loop
    v_id := 'QA-SEP12-VENDOR-ACK-175-' || v_suffix;
    if exists(select 1 from procurement.purchase_orders where id=v_id or po_number=v_id)
      or exists(select 1 from procurement.requests where id=v_id || '-REQUEST') then
      raise exception 'Fixture already exists; inspect and clean up before retrying';
    end if;
    insert into procurement.requests(id,title,description,solicitation_requirements)
    values(v_id || '-REQUEST','Synthetic vendor acknowledgment verification',
      'Disposable QA-SEP12-VENDOR-ACK-175 fixture. No real purchase, payment or delivery.',
      '{"paymentTerms":"Synthetic test only; no payment","deliveryTerms":"No physical delivery","shippingTerms":"No shipment","scopeOfWork":"Verify vendor document review and acknowledgment","acceptanceCriteria":"Acknowledgment persists once","validityPeriod":"Test session only"}'::jsonb);
    insert into procurement.purchase_orders(id,po_number,request_id,core_vendor_id,vendor_name,status,origin,lines,total,issued_at,expected_date,notes)
    values(v_id,v_id,v_id || '-REQUEST',v_vendor,'Synthetic isolated QA vendor','issued','procurement',
      '[{"description":"Synthetic acknowledgment test item","quantity":1,"uom":"unit","unitPrice":1}]'::jsonb,
      1,now(),current_date+7,'Disposable QA-SEP12-VENDOR-ACK-175 fixture. No real purchase, payment or delivery.');
    insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at)
    values(v_id,1,now(),now()+interval '3 days');
  end loop;
end $$;
commit;
