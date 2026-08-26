begin;

lock table warehouse.fulfillment_orders in share row exclusive mode;
lock table warehouse.receipts in share row exclusive mode;
lock table warehouse.quality_inspections in share row exclusive mode;

-- Imported UAT tracker samples used malformed or insecure placeholder links.
-- They are not valid courier destinations and must not remain clickable.
update warehouse.fulfillment_orders
set delivery_link = null,
    updated_at = pg_catalog.now()
where delivery_link ~* '^http://';

alter table warehouse.fulfillment_orders
  drop constraint if exists warehouse_fulfillment_delivery_link_check;

alter table warehouse.fulfillment_orders
  add constraint warehouse_fulfillment_delivery_link_check
  check (
    delivery_link is null
    or delivery_link ~* '^https://[^/[:space:]@]+(/|$)'
  ) not valid;

alter table warehouse.fulfillment_orders
  validate constraint warehouse_fulfillment_delivery_link_check;

-- Replace unreachable example.com placeholders with bundled, clearly marked
-- UAT evidence assets. Relative app paths stay valid on local, preview, and UAT.
update warehouse.receipts
set evidence_urls = '["/uat-evidence/aug24-qc-pending.svg"]'::jsonb
where id = 'UAT-AUG24-RECEIPT-QC-PENDING'
  and evidence_urls @> '["https://example.com/uat/receipts/UAT-AUG24-QC-PENDING"]'::jsonb;

update warehouse.quality_inspections
set evidence_urls = case serial_number
  when 'UAT-A24-QC-POWER-0001'
    then '["/uat-evidence/aug24-qc-functional-test.svg"]'::jsonb
  when 'UAT-A24-QC-POWER-0002'
    then '["/uat-evidence/aug24-qc-screen-defect.svg"]'::jsonb
  else evidence_urls
end
where source_id = 'UAT-AUG24-RECEIPT-QC-PENDING'
and serial_number in ('UAT-A24-QC-POWER-0001', 'UAT-A24-QC-POWER-0002')
and evidence_urls::text like '%https://example.com/uat/quality/%';

commit;
