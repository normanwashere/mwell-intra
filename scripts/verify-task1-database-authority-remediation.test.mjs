import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(ROOT, "supabase", "migrations");
const MIGRATION_SUFFIX = "_task_1_database_authority_remediation.sql";
const LEGAL_DOCUMENT_ROUTE = resolve(
  ROOT,
  "apps",
  "shell",
  "app",
  "api",
  "legal",
  "documents",
  "access",
  "route.ts",
);

function remediationMigration() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(MIGRATION_SUFFIX))
    .sort();

  assert.equal(files.length, 1, "Task 1 must add exactly one forward migration");
  return {
    file: files[0],
    sql: readFileSync(resolve(MIGRATIONS, files[0]), "utf8"),
  };
}

function functionBody(sql, qualifiedName) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

function expectLiveCapability(sql, qualifiedName, module, capability) {
  const body = functionBody(sql, qualifiedName);
  assert.match(
    body,
    new RegExp(
      `core\\.has_live_cap\\('${module}',\\s*'${capability}'\\)`,
      "i",
    ),
    `${qualifiedName} must require live ${module}:${capability} authority`,
  );
  assert.doesNotMatch(
    body,
    new RegExp(`core\\.has_cap\\('${module}',\\s*'${capability}'\\)`, "i"),
    `${qualifiedName} must not fall back to raw ${module}:${capability}`,
  );
}

test("Task 1 is a single forward authority remediation migration", () => {
  const { file, sql } = remediationMigration();
  assert.match(file, /^20\d{12}_task_1_database_authority_remediation\.sql$/);
  assert.match(sql, /forward-only/i);
  assert.doesNotMatch(sql, /alter\s+table\s+supabase_migrations/i);
});

test("certification-governed public mutation boundaries use live capabilities", () => {
  const { sql } = remediationMigration();

  for (const [name, module, capability] of [
    ["warehouse.issue", "warehouse", "issue_items"],
    ["warehouse.reserve", "warehouse", "reserve_allocate"],
    ["warehouse.transfer", "warehouse", "transfer_stock"],
    ["warehouse.record_return", "warehouse", "manage_returns"],
    ["warehouse.record_cycle_count", "warehouse", "cycle_count"],
    ["warehouse.receive_against_po", "warehouse", "receive_stock"],
    ["warehouse.adjust_stock", "warehouse", "cycle_count"],
    ["warehouse.inspect_quality", "warehouse", "inspect_quality"],
    ["warehouse.release_quality_hold", "warehouse", "release_quality_hold"],
    ["warehouse.create_vendor_return", "warehouse", "manage_returns"],
    ["warehouse.submit_cycle_count", "warehouse", "cycle_count"],
    ["warehouse.resolve_exception", "warehouse", "resolve_exceptions"],
    ["procurement.decide_request_step", "procurement", "approve_request"],
    ["legal.approve_accreditation_case", "legal", "approve_accreditation"],
    ["warehouse.create_event", "events", "create_event"],
    ["warehouse.request_event_fulfillment", "events", "request_fulfillment"],
    ["core.manage_finance_close_entry", "warehouse", "manage_finance_close"],
    ["product.submit_readiness_package", "product", "prepare_readiness"],
    ["product.decide_readiness_package", "product", "decide_go_live"],
    ["product.acknowledge_operations_handoff", "product", "acknowledge_operations_handoff"],
    ["product.submit_price_proposal", "product", "propose_pricing"],
    ["product.decide_price_proposal", "product", "approve_pricing"],
  ]) {
    expectLiveCapability(sql, name, module, capability);
  }

  const reconciliation = functionBody(sql, "warehouse.save_event_reconciliation");
  assert.match(reconciliation, /core\.has_live_cap\('events',\s*'manage_events'\)/i);
  assert.match(reconciliation, /core\.has_live_cap\('events',\s*'approve_settlement'\)/i);
  assert.doesNotMatch(reconciliation, /core\.has_cap\('events'/i);
});

test("replenishment, payment, and export writes use dedicated live capabilities", () => {
  const { sql } = remediationMigration();

  for (const [module, capability] of [
    ["warehouse", "recommend_replenishment"],
    ["procurement", "manage_replenishment"],
    ["procurement", "release_payment"],
    ["procurement", "review_payment_readiness"],
    ["warehouse", "register_exports"],
    ["warehouse", "review_exports"],
  ]) {
    assert.match(
      sql,
      new RegExp(`\\('${module}',\\s*'${capability}'\\)`, "i"),
      `missing dedicated ${module}:${capability} capability`,
    );
  }

  assert.match(
    functionBody(sql, "procurement.manage_replenishment_recommendation"),
    /v_action\s*=\s*'recommend'[\s\S]*?core\.has_live_cap\('warehouse',\s*'recommend_replenishment'\)/i,
  );
  assert.match(
    functionBody(sql, "procurement.manage_replenishment_recommendation"),
    /core\.has_live_cap\('procurement',\s*'manage_replenishment'\)/i,
  );
  assert.match(
    functionBody(sql, "warehouse.register_export_job"),
    /core\.has_live_cap\('insights',\s*'prepare_exports'\)/i,
  );

  for (const [name, module, capability] of [
    ["procurement.manage_replenishment_recommendation", "procurement", "manage_replenishment"],
    ["procurement.release_payment", "procurement", "release_payment"],
    ["procurement.review_payment_readiness", "procurement", "review_payment_readiness"],
    ["warehouse.register_export_job", "warehouse", "register_exports"],
    ["warehouse.review_export_job", "warehouse", "review_exports"],
  ]) {
    expectLiveCapability(sql, name, module, capability);
  }

  assert.doesNotMatch(
    functionBody(sql, "procurement.manage_replenishment_recommendation"),
    /view_procurement/,
  );
  assert.doesNotMatch(functionBody(sql, "procurement.release_payment"), /view_finance/);
  assert.doesNotMatch(functionBody(sql, "warehouse.register_export_job"), /view_(analytics|finance)/);
  assert.doesNotMatch(functionBody(sql, "warehouse.review_export_job"), /view_finance/);
});

test("private Warehouse implementations cannot be executed by browser roles", () => {
  const { sql } = remediationMigration();
  for (const name of [
    "warehouse_update_operation_route",
    "warehouse_inspect_quality",
    "warehouse_release_quality_hold",
    "warehouse_create_vendor_return",
    "warehouse_submit_cycle_count",
    "warehouse_decide_stock_change",
    "warehouse_resolve_exception",
    "warehouse_transfer",
    "warehouse_apply_import_job",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function private\\.${name}\\(jsonb\\)\\s+from public, anon, authenticated`,
        "i",
      ),
      `${name} must revoke browser execution`,
    );
  }
  assert.doesNotMatch(
    sql,
    /grant execute on function private\.warehouse_\w+\(jsonb\)\s+to authenticated/i,
  );

  for (const [name, capability] of [
    ["warehouse.update_operation_route", "manage_operation_routes"],
    ["warehouse.apply_import_job", "import_warehouse_data"],
  ]) {
    const body = functionBody(sql, name);
    assert.match(body, /security definer/i);
    assert.match(
      body,
      new RegExp(`core\\.has_live_cap\\('warehouse',\\s*'${capability}'\\)`, "i"),
    );
  }
});

test("every newly governed mutation capability is certification classified", () => {
  const { sql } = remediationMigration();
  const requiredRules = [
    ["core", "manage_own_accreditation_draft"],
    ["warehouse", "recommend_replenishment"],
    ["procurement", "manage_replenishment"],
    ["procurement", "release_payment"],
    ["procurement", "review_payment_readiness"],
    ["warehouse", "register_exports"],
    ["warehouse", "review_exports"],
    ["insights", "prepare_exports"],
  ];

  for (const [module, capability] of requiredRules) {
    assert.match(
      sql,
      new RegExp(
        `insert into learning\\.mutation_capability_rules[\\s\\S]*?\\('${module}',\\s*'${capability}'\\)`,
        "i",
      ),
      `missing certification rule for ${module}:${capability}`,
    );
  }
});

test("Finance close reads are restricted to certified close authority", () => {
  const { sql } = remediationMigration();
  assert.match(sql, /drop policy if exists finance_close_entries_read/i);
  assert.match(
    sql,
    /create policy finance_close_entries_read[\s\S]*?core\.has_live_cap\('warehouse',\s*'manage_finance_close'\)/i,
  );
  assert.doesNotMatch(
    sql.match(/create policy finance_close_entries_read[\s\S]*?(?=;)/i)?.[0] ?? "",
    /view_finance|procurement/i,
  );
});

test("Legal document access is live-governed, time limited, and independently audited", () => {
  const { sql } = remediationMigration();
  const body = functionBody(sql, "legal.prepare_document_signed_access");
  assert.match(sql, /create table if not exists legal\.document_access_audit/i);
  expectLiveCapability(sql, "legal.prepare_document_signed_access", "legal", "manage_documents");
  assert.match(body, /from legal\.accreditation_docs/i);
  assert.match(body, /insert into legal\.document_access_audit/i);
  assert.match(body, /expires_in.*300|300.*expires_in/i);
  assert.match(body, /storage_path/i);
  assert.match(sql, /drop policy if exists documents_auth_read on storage\.objects/i);
  const storagePolicy = sql.match(/create policy documents_auth_read[\s\S]*?(?=;)/i)?.[0] ?? "";
  assert.match(storagePolicy, /using\s*\(\s*false\s*\)/i);
  assert.doesNotMatch(storagePolicy, /owner\s*=|current_vendor_id|has_(live_)?cap/i);
  assert.match(sql, /document_id text not null references legal\.accreditation_docs\(id\)/i);
  assert.match(sql, /case_id text not null references legal\.accreditation_cases\(id\)/i);
  assert.match(sql, /actor_role text not null/i);
  assert.match(body, /auth\.uid\(\) is null[\s\S]*?auth\.role\(\)\s*<>\s*'service_role'/i);
});

test("the actual Legal document route separates user authorization from service-only signing", () => {
  const route = readFileSync(LEGAL_DOCUMENT_ROUTE, "utf8");
  assert.match(route, /createSupabaseAdminClient/);
  assert.match(route, /prepare_document_signed_access/);
  assert.match(route, /if\s*\(!adminClient\)[\s\S]*?503/);
  assert.match(route, /adminClient\.storage[\s\S]*?createSignedUrl/);
  assert.doesNotMatch(route, /userClient\.storage[\s\S]*?createSignedUrl/);
});

test("vendor submissions are server-validated and correction transitions are versioned", () => {
  const { sql } = remediationMigration();
  const submit = functionBody(sql, "private.policy_submit_vendor_application");
  const correct = functionBody(sql, "legal.request_vendor_application_correction");

  assert.match(submit, /v_case\.status\s+not\s+in\s*\(\s*'draft'\s*,\s*'correction_requested'\s*\)/i);
  assert.match(submit, /expected_version/i);
  assert.match(submit, /idempotency_key/i);
  assert.match(submit, /policyVersion/i);
  assert.match(submit, /company/i);
  assert.match(submit, /tradeName/i);
  assert.match(submit, /manpower/i);
  assert.match(submit, /technologyQualifications/i);
  assert.match(submit, /requirement_checklist_items/i);
  assert.match(submit, /accreditation_docs/i);
  assert.match(submit, /extensions\.digest/i);
  assert.match(submit, /signerName/i);
  assert.match(submit, /signerTitle/i);
  assert.match(correct, /core\.has_live_cap\('legal',\s*'review_accreditation'\)/i);
  assert.match(correct, /v_case\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i);
  assert.match(correct, /correction_requested/i);
  assert.match(correct, /latest submitted vendor application/i);
  assert.match(correct, /insert into core\.activity_log/i);
  assert.match(submit, /jsonb_build_object\('snapshot'[\s\S]*?'case'/i);
});

test("correction drafts and Legal lifecycle transitions remain governed", () => {
  const { sql } = remediationMigration();
  for (const name of [
    "private.save_vendor_application_draft",
    "private.discard_vendor_application_draft",
  ]) {
    const body = functionBody(sql, name);
    assert.match(body, /correction_requested/i);
    assert.match(body, /correction_source_version/i);
    assert.match(body, /correction_revision/i);
    assert.match(body, /expected_version/i);
  }

  const lifecycle = functionBody(sql, "legal.manage_vendor_lifecycle_review");
  assert.match(lifecycle, /core\.has_live_cap\('legal',\s*'review_accreditation'\)/i);
  assert.match(lifecycle, /core\.has_live_cap\('legal',\s*'approve_accreditation'\)/i);
  assert.match(lifecycle, /opened_by\s*=\s*auth\.uid\(\)|opened_by\s+is\s+not\s+distinct\s+from\s+auth\.uid\(\)/i);
  assert.match(lifecycle, /reinstatement/i);
  assert.match(lifecycle, /renewal/i);
  assert.match(lifecycle, /accreditation_status/i);
});

test("Finance close reconciliation preserves three certified actors", () => {
  const { sql } = remediationMigration();
  const body = functionBody(sql, "core.manage_finance_close_entry");
  assert.match(sql, /add column if not exists reconciled_by uuid/i);
  assert.match(sql, /add column if not exists reconciled_at timestamptz/i);
  assert.match(body, /core\.has_live_cap\('warehouse',\s*'manage_finance_close'\)/i);
  assert.match(body, /v_entry\.posted_by\s*=\s*auth\.uid\(\)/i);
  assert.match(body, /reconciled_by\s*=\s*auth\.uid\(\)/i);
  assert.match(body, /reconciled_at\s*=\s*now\(\)/i);
  assert.match(body, /v_entry\.prepared_by\s*=\s*auth\.uid\(\)/i);
  assert.match(body, /v_entry\.posted_by\s*=\s*auth\.uid\(\)/i);
});

test("purchase-order cancellation is stale-safe, idempotent, dependency-aware, and recoverable", () => {
  const { sql } = remediationMigration();
  const body = functionBody(sql, "procurement.cancel_purchase_order");
  expectLiveCapability(sql, "procurement.cancel_purchase_order", "procurement", "cancel_purchase_order");
  assert.match(body, /idempotency_key/i);
  assert.match(body, /expected_version/i);
  assert.match(body, /cancellation_version/i);
  assert.match(body, /reason/i);
  assert.match(body, /procurement\.receipts/i);
  assert.match(body, /warehouse\.receipts/i);
  assert.match(body, /procurement\.acceptance_packs/i);
  assert.match(body, /procurement\.payment_readiness_packs/i);
  assert.match(body, /procurement\.payment_releases/i);
  assert.match(body, /cancelled_by/i);
  assert.match(body, /insert into core\.activity_log/i);
  assert.match(sql, /\('procurement',\s*'cancel_purchase_order'\)/i);
});

test("Product readiness decisions are versioned and active kits require launch authority", () => {
  const { sql } = remediationMigration();
  const decision = functionBody(sql, "product.decide_readiness_package");
  const kit = functionBody(sql, "warehouse.create_kit_definition");
  assert.match(decision, /expected_version/i);
  assert.match(decision, /v_row\.version/i);
  assert.match(decision, /core\.has_live_cap\('product',\s*'decide_go_live'\)/i);
  assert.match(kit, /payload->>'status'\s*=\s*'active'/i);
  assert.match(kit, /product\.can_launch\(/i);
  assert.match(kit, /core\.has_live_cap\('warehouse',\s*'manage_products'\)/i);
});

test("approved Event reconciliation creates canonical Warehouse and Finance settlement handoffs", () => {
  const { sql } = remediationMigration();
  const body = functionBody(sql, "warehouse.save_event_reconciliation");
  assert.match(sql, /create table if not exists warehouse\.event_settlements/i);
  assert.match(sql, /event_id text not null/i);
  assert.match(sql, /reconciliation_event_id text not null/i);
  assert.match(sql, /finance_close_entry_id uuid not null/i);
  assert.match(body, /insert into core\.finance_close_entries/i);
  assert.match(body, /insert into warehouse\.event_settlements/i);
  assert.match(body, /'event_settlement'/i);
  assert.match(body, /v_reconciliation\.event_id/i);
});

test("Insights PR cycle projects approved submission to the first issued PO", () => {
  const { sql } = remediationMigration();
  const body = functionBody(sql, "core.insights_snapshot");
  assert.match(sql, /add column if not exists issued_at timestamptz/i);
  assert.match(body, /min\(po\.issued_at\)/i);
  assert.match(body, /r\.submitted_at/i);
  assert.match(body, /po\.request_id/i);
  assert.doesNotMatch(body, /r\.updated_at\s*-\s*r\.created_at/i);
  assert.match(
    functionBody(sql, "procurement.issue_purchase_order"),
    /issued_at\s*=\s*coalesce\(issued_at,\s*now\(\)\)/i,
  );
});
