import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migration = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260804200000_operational_flow_completion.sql",
  ),
  "utf8",
);
const replenishmentFix = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260804201000_fix_replenishment_procurement_handoff.sql",
  ),
  "utf8",
);
const read = (path) => readFileSync(resolve(path), "utf8");

test("governs ecommerce delivery and customer return closure", () => {
  assert.match(
    migration,
    /function warehouse\.update_shipment_tracking\(payload jsonb\)/i,
  );
  assert.match(
    migration,
    /proof-of-delivery reference and evidence are required/i,
  );
  assert.match(migration, /delivery_failed/i);
  assert.match(migration, /returned_to_sender/i);
  assert.match(
    migration,
    /function warehouse\.close_customer_return_case\(payload jsonb\)/i,
  );
  assert.match(
    migration,
    /Finance evidence is required for refunds and write-offs/i,
  );
  assert.match(
    migration,
    /customer resolution reference and closure evidence are required/i,
  );
});

test("blocks event closure until custody and Finance settlement reconcile", () => {
  assert.match(
    migration,
    /create table if not exists warehouse\.event_reconciliations/i,
  );
  assert.match(migration, /outcomes must account for all issued units/i);
  assert.match(
    migration,
    /approved event reconciliation is required before closure/i,
  );
  assert.match(
    migration,
    /Complete or cancel every event fulfillment order before closure/i,
  );
  assert.match(migration, /approved event reconciliation cannot be edited/i);
});

test("provides governed P1 control registers and strict state transitions", () => {
  for (const table of [
    "warehouse.inventory_integrity_cases",
    "procurement.replenishment_recommendations",
    "core.finance_close_entries",
    "legal.vendor_lifecycle_reviews",
  ]) {
    assert.match(
      migration,
      new RegExp(
        "create table if not exists " + table.replace(".", "\\."),
        "i",
      ),
    );
  }
  assert.match(migration, /Contain the case before approval/i);
  assert.match(migration, /insert into procurement\.requests/i);
  assert.match(
    replenishmentFix,
    /needed_by,\s*justification,\s*compliance,\s*lines/i,
  );
  assert.doesNotMatch(replenishmentFix, /need_description/i);
  assert.doesNotMatch(replenishmentFix, /vendor_accreditation_required/i);
  assert.match(
    migration,
    /A second Finance user must post the prepared entry/i,
  );
  assert.match(migration, /Start the review before a decision/i);
  assert.match(migration, /'suspended', 'offboarded'/i);
});

test("surfaces every new control in its owning module", () => {
  assert.match(
    read("modules/warehouse/src/pages/FulfillmentPage.tsx"),
    /Update delivery/i,
  );
  assert.match(
    read("modules/warehouse/src/pages/FulfillmentPage.tsx"),
    /Close with customer/i,
  );
  assert.match(
    read("packages/data-kit/src/supabase/SupabaseRepository.ts"),
    /shipment_status,dispatched_at,last_tracking_at/,
  );
  assert.match(
    read("packages/data-kit/src/supabase/SupabaseRepository.ts"),
    /finance_evidence_url,customer_resolution_reference/,
  );
  assert.match(
    read("modules/warehouse/src/pages/InventoryPage.tsx"),
    /InventoryIntegrityPanel/,
  );
  assert.match(
    read("modules/warehouse/src/pages/ProcurementPage.tsx"),
    /ReplenishmentControlPanel/,
  );
  assert.match(
    read("modules/events/src/EventsApp.tsx"),
    /Event reconciliation/i,
  );
  assert.match(read("modules/finance/src/FinanceApp.tsx"), /FinanceClosePanel/);
  assert.match(
    read("modules/legal/src/pages/AccreditationCasesPage.tsx"),
    /VendorLifecyclePanel/,
  );
});
