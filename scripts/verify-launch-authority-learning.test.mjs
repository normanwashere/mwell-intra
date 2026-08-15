import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260816183000_reconcile_launch_authority_and_learning.sql",
  import.meta.url,
);
const retirementMigrationUrl = new URL(
  "../supabase/migrations/20260816184500_retire_context_only_learning_assignments.sql",
  import.meta.url,
);
const simulationKeyFixMigrationUrl = new URL(
  "../supabase/migrations/20260816190000_fix_equivalent_role_practice_simulation_key.sql",
  import.meta.url,
);

test("launch read RPCs remain capability-checked and executable by authenticated users", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /grant execute on function core\.list_departments\(\)/i);
  assert.match(sql, /grant execute on function core\.list_rbac_catalog\(\)/i);
  assert.match(
    sql,
    /grant execute on function procurement\.purchase_order_amendment_work_items\(jsonb\)/i,
  );
  assert.match(
    sql,
    /grant execute on function procurement\.payment_readiness_staleness_work_items\(jsonb\)/i,
  );
  assert.match(
    sql,
    /purchase_order_receipt_status[\s\S]*?auth\.uid\(\) is null[\s\S]*?core\.has_cap/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function private\.procurement_po_receipt_status\(\)/i,
  );
});

test("context-only Events visibility does not assign Leadership onboarding", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const retirementSql = await readFile(retirementMigrationUrl, "utf8");

  assert.match(sql, /learning\.role_curricula[\s\S]*?module = 'events'/i);
  assert.match(sql, /role = 'viewer'/i);
  assert.match(sql, /learning\.assignments[\s\S]*?status = 'cancelled'/i);
  assert.match(
    retirementSql,
    /rename to my_learning_snapshot_base/i,
  );
  assert.match(
    retirementSql,
    /role_curriculum\.expires_at > pg_catalog\.statement_timestamp\(\)/i,
  );
  assert.match(
    retirementSql,
    /curriculum\.catalog_key\s*=\s*item\.value#>>'\{curriculum,id\}'/i,
  );
  assert.doesNotMatch(retirementSql, /update learning\.assignments/i);
});

test("equivalent role practice propagation is simulation-scoped and evidence preserving", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const simulationKeyFixSql = await readFile(
    simulationKeyFixMigrationUrl,
    "utf8",
  );

  assert.match(sql, /source_version\.requirement_kind = 'scenario'/i);
  assert.match(sql, /target_version\.requirement_kind = 'scenario'/i);
  assert.match(
    sql,
    /target_version\.simulation_version_id\s*=\s*v_source\.simulation_version_id/i,
  );
  assert.match(sql, /equivalent_role_practice_superseded_attempt/i);
  assert.match(sql, /update learning\.attempts[\s\S]*?status = 'abandoned'/i);
  assert.match(sql, /shared_completion_kind', 'equivalent_role_practice'/i);
  assert.match(sql, /source_assignment\.source_type not in \('retraining', 'corrective'\)/i);
  assert.match(sql, /target_assignment\.source_type not in \('retraining', 'corrective'\)/i);
  assert.match(sql, /learning\.sync_exact_completions\(\)/i);
  assert.match(
    simulationKeyFixSql,
    /pg_catalog\.replace\([\s\S]*?'simulation_version_id'[\s\S]*?'simulation_id'/i,
  );
});
