import { readFile } from "node:fs/promises";
import path from "node:path";

const requiredDocs = [
  "docs/REQUIREMENTS_TRACEABILITY_MATRIX.md",
  "docs/UAT_AND_ISSUE_MANAGEMENT.md",
  "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md",
  "docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md",
  "docs/import-templates/README.md",
  "docs/manual/MWELL_INTRA_USER_MANUAL.md",
];

const csvHeaders = new Map([
  [
    "docs/import-templates/users-v1.csv",
    "template_version,email,full_name,status,module,role",
  ],
  [
    "docs/import-templates/warehouse-locations-bins-v1.csv",
    "template_version,location_external_id,location_name,location_type,bin_code,bin_label,zone,active",
  ],
  [
    "docs/import-templates/warehouse-products-opening-stock-v1.csv",
    "template_version,sku,product_name,category,serialized,unit_cost,reorder_point,location_external_id,bin_code,quantity,serial_number",
  ],
  [
    "docs/import-templates/vendors-v1.csv",
    "template_version,vendor_external_id,company_name,contact_email,category,jurisdiction,risk_tier,status",
  ],
]);

const failures = [];
for (const file of requiredDocs) {
  try {
    const content = await readFile(path.resolve(file), "utf8");
    if (content.trim().length < 200)
      failures.push(`${file}: content is incomplete`);
  } catch {
    failures.push(`${file}: missing`);
  }
}
for (const [file, expected] of csvHeaders) {
  try {
    const content = await readFile(path.resolve(file), "utf8");
    const actual = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
    if (actual !== expected)
      failures.push(`${file}: header does not match v1 contract`);
  } catch {
    failures.push(`${file}: missing`);
  }
}

const crawlerPath = path.resolve("scripts/qa/full-intra-live-e2e.mjs");
try {
  const crawler = await readFile(crawlerPath, "utf8");
  if (!crawler.includes("AUDIT_PASSWORD is required")) {
    failures.push("live crawler must require an externally supplied password");
  }
  if (/mWell-Demo-\d{4}!/.test(crawler)) {
    failures.push("live crawler contains an embedded demo password");
  }
} catch {
  failures.push("scripts/qa/full-intra-live-e2e.mjs: missing");
}

try {
  const providers = await readFile(
    path.resolve("apps/shell/app/providers.tsx"),
    "utf8",
  );
  if (
    !providers.includes("NEXT_PUBLIC_DATA_SOURCE === 'memory' &&") ||
    !providers.includes("NEXT_PUBLIC_ALLOW_DEMO_IN_PROD === 'true'")
  ) {
    failures.push(
      "production demo mode must require both explicit escape-hatch flags",
    );
  }
} catch {
  failures.push("apps/shell/app/providers.tsx: missing");
}

for (const file of [
  "apps/shell/app/knowledge/page.tsx",
  "apps/shell/lib/knowledge/content.ts",
  "apps/shell/lib/knowledge/workflows.ts",
  "docs/manual/index.html",
]) {
  try {
    const content = await readFile(path.resolve(file), "utf8");
    if (content.trim().length < 100)
      failures.push(`${file}: Knowledge Base artifact is incomplete`);
  } catch {
    failures.push(`${file}: missing Knowledge Base artifact`);
  }
}

try {
  const manual = await readFile(
    path.resolve("docs/manual/MWELL_INTRA_USER_MANUAL.md"),
    "utf8",
  );
  for (const required of [
    "Comprehensive Launch Flow",
    "User Types and Responsibilities",
    "Future Recommended Features",
    "https://mwell-intra.vercel.app/knowledge",
  ]) {
    if (!manual.includes(required))
      failures.push(`manual missing section/link: ${required}`);
  }
} catch {
  failures.push("docs/manual/MWELL_INTRA_USER_MANUAL.md: missing");
}

try {
  const exportMigration = await readFile(
    path.resolve(
      "supabase/migrations/20260710043410_govern_warehouse_csv_exports.sql",
    ),
    "utf8",
  );
  if (!exportMigration.includes("and created_by <> auth.uid()")) {
    failures.push(
      "warehouse export review must enforce creator/reviewer separation",
    );
  }
  if (
    !exportMigration.includes("j.status = 'correction_required'") ||
    !exportMigration.includes("j.export_type = v_kind")
  ) {
    failures.push(
      "warehouse export corrections must validate source status and type",
    );
  }
} catch {
  failures.push("governed warehouse export migration: missing");
}

if (failures.length > 0) {
  console.error(
    `Launch artifact verification failed:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  "PASS launch governance documents, import headers, and live crawler contract.",
);
