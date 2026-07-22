-- The receipt-status view is the governed read surface used by Procurement and
-- Finance. Its SECURITY INVOKER query calls one read-only SECURITY DEFINER
-- helper in the unexposed private schema, which still enforces capability
-- filtering from the caller's auth claims.

grant execute on function private.procurement_po_receipt_status()
  to authenticated, service_role;

comment on function private.procurement_po_receipt_status() is
  'Read-only internal implementation for procurement.v_purchase_order_receipt_status. Execute is intentionally granted because the SECURITY INVOKER view calls it; the private schema is not exposed through PostgREST.';
