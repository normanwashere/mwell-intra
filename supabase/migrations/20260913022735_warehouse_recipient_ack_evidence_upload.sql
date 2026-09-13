-- Recipient acknowledgment uploads only. Keep evidence_auth_write and all
-- registered/owner read policies unchanged, including operational role access.
begin;

create or replace function private.can_upload_warehouse_ack_evidence(object_name text)
returns boolean
language plpgsql stable security invoker set search_path = ''
as $$
declare
  path_parts text[];
begin
  if not private.warehouse_evidence_employee() then return false; end if;

  -- EvidenceCapture uses maxPhotos=1 and uploadEvidence generates a UUID file.
  -- Validate the whole object key before casting; no encoded or extra segments.
  path_parts := pg_catalog.regexp_match(object_name,
    '^acknowledgment-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/0/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg|webp|gif)$');
  if path_parts is null then return false; end if;

  -- Match the installed private.warehouse_advance_fulfillment_order_v2 ack
  -- authority (including the handover guard), retaining source SELECT RLS.
  return exists (
    select 1 from warehouse.fulfillment_orders fulfillment
    where fulfillment.id = path_parts[1]::uuid
      and fulfillment.status = 'released'
      and fulfillment.delivery_method in ('internal_handover', 'event_handover', 'third_party_transfer')
      and fulfillment.released_by is distinct from auth.uid()
      and (
        fulfillment.created_by = auth.uid()
        or core.has_cap('warehouse', 'request_fulfillment')
        or core.has_cap('warehouse', 'issue_items')
        or exists (
          select 1 from warehouse.department_stock_requests request
          where request.fulfillment_order_id = fulfillment.id
            and request.requested_by = auth.uid()
        )
      )
  );
end;
$$;

revoke all on function private.can_upload_warehouse_ack_evidence(text) from public, anon;
grant execute on function private.can_upload_warehouse_ack_evidence(text) to authenticated, service_role;

-- Additive INSERT exception: request_stock is never general upload authority.
create policy evidence_recipient_ack_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'evidence'
  and owner_id = auth.uid()::text
  and (owner is null or owner = auth.uid())
  and private.can_upload_warehouse_ack_evidence(name)
);

commit;
