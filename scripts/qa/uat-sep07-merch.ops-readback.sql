-- Main: run AFTER apply on verified UAT kkoitlvydytdhlpxhuah only.
-- Read-only transaction; SQL-context simulation of existing Ops associate,
-- not a real browser login or a claim of human activity. No business writes.
begin read only;
do $actor$ begin
 if (select count(*) from core.profiles where lower(email)='intra.test.operations.associate@mwell.com.ph') <> 1 then
   raise exception 'Exactly one existing Ops associate required';
 end if;
end $actor$;
select set_config('request.jwt.claims', jsonb_build_object('sub',id::text,'role','authenticated')::text,true),
       set_config('request.jwt.claim.sub',id::text,true),
       set_config('request.jwt.claim.role','authenticated',true)
from core.profiles where lower(email)='intra.test.operations.associate@mwell.com.ph';
set local role authenticated;
select auth.uid() as tested_ops_actor,
       core.has_live_cap('warehouse','receive_stock') as can_receive_stock,
       (select count(*) from warehouse.procurement_po_handoff where id in ('UAT-SEP07-PO-0005','UAT-SEP07-PO-0006')) as visible_po_count;
select id,po_number,vendor_name,status,expected_date,total,lines
from warehouse.procurement_po_handoff
where id in ('UAT-SEP07-PO-0005','UAT-SEP07-PO-0006')
order by id;
rollback;
-- Required result: can_receive_stock=true, visible_po_count=2; both issued,
-- Company D/E; expected_date 2026-09-08; jacket 3x100, tumbler 300;
-- exact normalized product/line IDs, receivedQuantity=0 before tester receipt.
-- Do not declare Ops readiness if any condition fails. Never fix with grants.
