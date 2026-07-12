import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationDir = resolve("supabase", "migrations");
const sql = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationDir, name), "utf8"))
  .join("\n");

const requiredTables = [
  "operation_types",
  "operation_routes",
  "quality_inspections",
  "inventory_holds",
  "vendor_returns",
  "exceptions",
  "stock_change_requests",
  "command_log",
  "import_jobs",
  "import_errors",
];

const requiredChecks = [
  "warehouse_operation_type_code_check",
  "warehouse_quality_disposition_check",
  "warehouse_hold_status_check",
  "warehouse_vendor_return_status_check",
  "warehouse_exception_severity_check",
  "warehouse_exception_status_check",
  "warehouse_stock_change_status_check",
  "warehouse_import_kind_check",
  "warehouse_import_status_check",
];

const requiredCapabilities = [
  "manage_operation_routes",
  "inspect_quality",
  "release_quality_hold",
  "approve_stock_adjustment",
  "view_exceptions",
  "resolve_exceptions",
  "import_warehouse_data",
];

const requiredViews = [
  "inventory_position_v1",
  "bi_movements_v1",
  "bi_quality_v1",
  "bi_cycle_counts_v1",
  "warehouse_tasks",
];

const failures = [];
function requireMatch(pattern, message) {
  try {
    assert.match(sql, pattern);
  } catch {
    failures.push(message);
  }
}

for (const table of requiredTables) {
  requireMatch(
    new RegExp(`create table(?: if not exists)? warehouse\\.${table}\\b`, "i"),
    `missing warehouse.${table}`,
  );
  requireMatch(
    new RegExp(
      `alter table warehouse\\.${table} enable row level security`,
      "i",
    ),
    `warehouse.${table} does not enable RLS`,
  );
  requireMatch(
    new RegExp(
      `alter table warehouse\\.${table} force row level security`,
      "i",
    ),
    `warehouse.${table} does not force RLS`,
  );
  requireMatch(
    new RegExp(
      `revoke all on warehouse\\.${table} from public, anon, authenticated`,
      "i",
    ),
    `warehouse.${table} does not revoke direct browser writes`,
  );
}

for (const check of requiredChecks) {
  requireMatch(new RegExp(`constraint ${check}\\b`, "i"), `missing ${check}`);
}

for (const capability of requiredCapabilities) {
  requireMatch(
    new RegExp(`'warehouse'\\s*,\\s*'${capability}'`, "i"),
    `missing Warehouse capability ${capability}`,
  );
}

for (const view of requiredViews) {
  requireMatch(
    new RegExp(
      `create or replace view warehouse\\.${view}[\\s\\S]*?with \\(security_invoker = true\\)`,
      "i",
    ),
    `warehouse.${view} is missing or not security-invoker`,
  );
  requireMatch(
    new RegExp(`grant select on warehouse\\.${view} to authenticated`, "i"),
    `warehouse.${view} is not granted explicitly`,
  );
}

requireMatch(
  /unique\s*\(actor_id\s*,\s*command_name\s*,\s*idempotency_key\s*\)/i,
  "command_log lacks actor/command/idempotency uniqueness",
);
requireMatch(
  /'warehouse'\s*,\s*'warehouse_admin'\s*,\s*'Warehouse Administrator'/i,
  "warehouse_admin role is not seeded",
);
requireMatch(
  /alter table warehouse\.lots\s+add column if not exists expiry_date date/i,
  "lots.expiry_date is missing",
);
requireMatch(
  /alter table warehouse\.products\s+add column if not exists expiry_tracked boolean/i,
  "products.expiry_tracked is missing",
);
requireMatch(
  /alter table warehouse\.products\s+add column if not exists shelf_life_warning_days integer/i,
  "products.shelf_life_warning_days is missing",
);
requireMatch(
  /'inventory_position'\s*,\s*'quality'\s*,\s*'cycle_counts'/i,
  "governed W1 export types are missing",
);
requireMatch(
  /inspection\.inspected_at\s*\+\s*interval\s*'1 day'\s+as due_at/i,
  "warehouse_tasks must derive quality due dates from quality_inspections.inspected_at",
);

if (failures.length > 0) {
  console.error(
    `Warehouse W1 schema verification failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}

console.log(
  `Warehouse W1 schema verification passed (${requiredTables.length} control tables, forced RLS, capabilities, and state constraints).`,
);
