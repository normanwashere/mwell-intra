const ARCHIVE_SCOPED_TABLES = new Set([
  "products", "inventory_units", "stock_levels", "lots", "allocations",
  "fulfillment_orders", "fulfillment_reservations", "department_stock_requests",
  "customer_return_cases", "receipts", "returns", "cycle_counts", "quality_inspections",
  "inventory_holds", "vendor_returns", "stock_change_requests", "exceptions",
  "kit_definitions", "rekit_work_orders", "storage_areas", "events", "movements",
]);

// Only aggregate/list reads use archive views; detail, replay, and writes stay raw.
export function activeReadRelation(table: string): string {
  return ARCHIVE_SCOPED_TABLES.has(table) ? `active_${table}` : table;
}
