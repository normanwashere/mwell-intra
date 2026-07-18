-- Converge the legacy receipt reconciliation ledger to service-only access.
-- No client role reads or mutates this internal migration ledger directly.

alter table procurement.receipt_reconciliations enable row level security;
alter table procurement.receipt_reconciliations force row level security;
revoke all on procurement.receipt_reconciliations from public, anon, authenticated;
grant all on procurement.receipt_reconciliations to service_role;
