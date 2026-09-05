-- Cleanup discovers exact run-owned payment packs before removing their identities.
-- Column-scoped read access supports filtering and residue proof without exposing invoices.
grant select (current_pack_id), delete
  on table procurement.vendor_invoice_identities to service_role;
