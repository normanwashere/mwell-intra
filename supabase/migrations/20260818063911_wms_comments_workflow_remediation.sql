-- Restore the shipment-tracking RPC to signed-in operators. Anonymous access
-- remains revoked; the function performs its own role and transition checks.
revoke all on function warehouse.update_shipment_tracking(jsonb) from public, anon;
grant usage on schema warehouse to authenticated, service_role;
grant execute on function warehouse.update_shipment_tracking(jsonb) to authenticated, service_role;
