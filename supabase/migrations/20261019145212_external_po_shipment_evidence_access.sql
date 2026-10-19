-- Draft shipment photos are not registered on receipts until posting. Share
-- only exact saved attachments with the same live readers as the PO workspace.
-- Keep existing evidence policies, buckets and Quality verifier bodies intact.
begin;

create function private.external_po_shipment_evidence_readable(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    private.warehouse_evidence_employee()
    and private.external_po_can_read()
    and object_name is not null and object_name<>''
    and exists (
      select 1 from private.external_po_shipments s
      join private.external_po_orders p on p.id=s.order_id
      where s.status in ('draft','posted')
        and private.warehouse_evidence_array_has(s.evidence_urls,object_name)
    ), false
  );
$$;
alter function private.external_po_shipment_evidence_readable(text) owner to postgres;
revoke all on function private.external_po_shipment_evidence_readable(text)
  from public,anon,authenticated,service_role;
grant execute on function private.external_po_shipment_evidence_readable(text) to authenticated;

create policy external_po_shipment_evidence_read on storage.objects
for select to authenticated
using (bucket_id='evidence' and private.external_po_shipment_evidence_readable(name));

notify pgrst,'reload schema';
commit;
