import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260722150000_advisor_intent_and_private_function_hardening.sql",
  import.meta.url,
);
const governanceIndexMigrationUrl = new URL(
  "../supabase/migrations/20260722151000_index_new_governance_foreign_keys.sql",
  import.meta.url,
);

test("RPC-only tables carry explicit fail-closed policies", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const relation of [
    "core.approval_groups",
    "procurement.acceptance_reviewer_assignments",
    "procurement.payment_readiness_staleness_events",
    "procurement.purchase_order_amendment_steps",
    "procurement.purchase_order_amendments",
    "procurement.receipt_reconciliations",
    "warehouse.procurement_receipt_exception_decisions",
    "warehouse.procurement_receipt_exception_lines",
    "warehouse.procurement_receipt_excess_custody",
    "warehouse.unidentified_receipt_custody",
  ]) {
    assert.match(sql, new RegExp(relation.replace(".", "\\.")));
  }
  assert.match(sql, /using \(false\)/i);
});

test("internal private functions are not directly executable by application roles", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke execute on all functions in schema private/i);
  assert.match(sql, /grant execute on function private\.current_app_role\(\) to authenticated/i);
  assert.match(sql, /guard_po_amendment_snapshot/i);
});

test("new Legal and Product foreign keys have covering indexes", async () => {
  const sql = await readFile(governanceIndexMigrationUrl, "utf8");
  for (const column of [
    "proposed_by",
    "confirmed_by",
    "prepared_by",
    "submitted_by",
    "decided_by",
    "operations_acknowledged_by",
    "readiness_id",
    "actor",
    "proposal_id",
  ]) {
    assert.match(sql, new RegExp(`\\(${column}\\)`, "i"));
  }
});
