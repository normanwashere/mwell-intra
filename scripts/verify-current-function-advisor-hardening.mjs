import { readFile } from "node:fs/promises";
import path from "node:path";

const migrationPath = path.resolve(
  "supabase/migrations/20260713170000_current_function_advisor_hardening.sql",
);
const failures = [];
let sql = "";
try {
  sql = await readFile(migrationPath, "utf8");
} catch {
  failures.push("current-function advisor migration is missing");
}

for (const [label, pattern] of [
  [
    "stock-level UUID identity",
    /alter table warehouse\.stock_levels[\s\S]*?add column if not exists id uuid default gen_random_uuid\(\)/i,
  ],
  [
    "stock-level primary key",
    /add constraint stock_levels_pkey primary key \(id\)/i,
  ],
  [
    "selected auth identity",
    /\(select auth\.uid\(\)\)/i,
  ],
  [
    "consolidated purchase-order policy",
    /create policy procurement_purchase_orders_read/i,
  ],
  [
    "consolidated purchase-order-line policy",
    /create policy procurement_purchase_order_lines_read/i,
  ],
]) {
  if (!pattern.test(sql)) failures.push(`migration missing ${label}`);
}

const indexStatements = sql.match(
  /create index if not exists [a-z0-9_]+\s+on\s+(?:core|legal|procurement|public|warehouse)\.[a-z0-9_]+\s*\([^)]+\);/gi,
) ?? [];
if (indexStatements.length !== 131) {
  failures.push(
    `migration must contain 131 advisor-derived FK indexes, found ${indexStatements.length}`,
  );
}
if (/drop\s+index/i.test(sql)) {
  failures.push("migration must not remove indexes without production telemetry");
}
if (/auth\.uid\(\)(?!\))/i.test(sql.replaceAll("(select auth.uid())", ""))) {
  failures.push("migration contains an unselected auth.uid() policy expression");
}

if (failures.length) {
  console.error(
    `Current-function advisor hardening verification failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  "PASS current-function advisor migration contains identity, policy, and 131 FK-index controls.",
);
