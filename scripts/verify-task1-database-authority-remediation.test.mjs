import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(ROOT, "supabase", "migrations");
const MIGRATION_SUFFIX = "_task_1_database_authority_remediation.sql";

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
    ["core.manage_finance_close_entry", "warehouse", "manage_finance_close"],
    ["product.submit_readiness_package", "product", "prepare_readiness"],
    ["product.decide_readiness_package", "product", "decide_go_live"],
    ["product.acknowledge_operations_handoff", "product", "acknowledge_operations_handoff"],
    ["product.submit_price_proposal", "product", "propose_pricing"],
    ["product.decide_price_proposal", "product", "approve_pricing"],
  ]) {
    expectLiveCapability(sql, name, module, capability);
  }
});

test("replenishment, payment, and export writes use dedicated live capabilities", () => {
  const { sql } = remediationMigration();

  for (const [module, capability] of [
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
  assert.doesNotMatch(
    sql.match(/create policy documents_auth_read[\s\S]*?(?=;)/i)?.[0] ?? "",
    /has_any_cap\('view_documents'\)/i,
  );
});

test("vendor submissions are server-validated and correction transitions are versioned", () => {
  const { sql } = remediationMigration();
  const submit = functionBody(sql, "private.policy_submit_vendor_application");
  const correct = functionBody(sql, "legal.request_vendor_application_correction");

  assert.match(submit, /v_case\.status\s+not\s+in\s*\(\s*'draft'\s*,\s*'correction_requested'\s*\)/i);
  assert.match(submit, /legal_name/i);
  assert.match(submit, /registration_number/i);
  assert.match(submit, /primary_contact/i);
  assert.match(submit, /documents/i);
  assert.match(submit, /signerName/i);
  assert.match(submit, /signerTitle/i);
  assert.match(correct, /core\.has_live_cap\('legal',\s*'review_accreditation'\)/i);
  assert.match(correct, /v_case\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i);
  assert.match(correct, /correction_requested/i);
  assert.match(correct, /latest submitted vendor application/i);
  assert.match(correct, /insert into core\.activity_log/i);
});
