-- v3 records acceptance before releasing provisional custody in the same transaction.
-- Authorize from that evidence, never from a caller-controlled bypass flag.
create or replace function private.protect_provisional_quality_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.reason = 'Awaiting independent quality inspection'
     and old.status = 'active'
     and new.status is distinct from 'active' then
    if new.status = 'released'
       and auth.uid() is not null
       and new.released_by = auth.uid()
       and new.released_at is not null
       and new.release_reason = 'Accepted by independent quality inspection'
       and (pg_catalog.to_jsonb(new) - array[
         'status','released_by','released_at','release_reason','release_evidence_urls'
       ]) = (pg_catalog.to_jsonb(old) - array[
         'status','released_by','released_at','release_reason','release_evidence_urls'
       ])
       and exists (
         select 1
           from warehouse.quality_inspections inspection
           join warehouse.receipts receipt on receipt.id = inspection.source_id
          where inspection.id = old.inspection_id
            and inspection.source_type = 'receipt'
            and inspection.disposition = 'accepted'
            and inspection.reason = 'Accepted by independent quality inspection'
            and inspection.inspected_by = auth.uid()
            and receipt.received_by is not null
            and receipt.received_by <> inspection.inspected_by
            and old.created_by is not null
            and old.created_by <> inspection.inspected_by
            and receipt.procurement_po_id is not null
            and inspection.procurement_po_line_id is not null
            and inspection.location_id = receipt.location_id
            and inspection.product_id = old.product_id
            and inspection.location_id = old.location_id
            and inspection.bin_id is not distinct from old.bin_id
            and inspection.lot_id is not distinct from old.lot_id
            and inspection.serial_number is not distinct from old.serial_number
            and inspection.quantity = old.quantity
            and inspection.quantity > 0
            and inspection.inspected_at = new.released_at
            and inspection.evidence_urls = new.release_evidence_urls
       ) then
      return new;
    end if;
    raise exception 'Pending independent inspection holds cannot be released directly';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_provisional_quality_hold() from public, anon, authenticated;
