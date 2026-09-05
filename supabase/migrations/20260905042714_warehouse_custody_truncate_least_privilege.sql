-- UAT catalog audit confirmed inherited whole-table privileges on these custody
-- tables. TRUNCATE bypasses RLS; retain every other grant and the existing RPCs.
-- PUBLIC has no such grant in inspected UAT, but revoke it explicitly so an
-- inherited PUBLIC grant cannot defeat the anon/authenticated boundary.
revoke truncate on table
  warehouse.returns,
  warehouse.movements,
  warehouse.allocations,
  warehouse.event_reconciliations
from public, anon, authenticated;
