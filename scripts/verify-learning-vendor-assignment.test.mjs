import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260816103000_restore_vendor_learning_assignments.sql",
  import.meta.url,
);

test("vendor learning is governed by Legal without granting internal department membership", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /v_profile\.kind <> 'vendor'/i);
  assert.match(sql, /department\.code = 'legal_compliance'/i);
  assert.match(sql, /role_curriculum\.audience = 'vendor'/i);
  assert.match(sql, /role_assignment\.effective_at <= pg_catalog\.statement_timestamp\(\)/i);
  assert.match(sql, /role_assignment\.expires_at > pg_catalog\.statement_timestamp\(\)/i);
  assert.match(sql, /insert into learning\.assignment_requirements/i);
  assert.doesNotMatch(sql, /insert into core\.profile_department_scopes/i);
});

test("assignment resolution cancels ineffective roles before adding vendor curricula", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const base = sql.indexOf("perform private.resolve_assignments_base()");
  const cancel = sql.indexOf(
    "perform private.cancel_ineffective_learning_role_assignments()",
  );
  const vendor = sql.indexOf("perform private.resolve_vendor_learning_assignments()");
  const snapshot = sql.indexOf("return learning.my_learning_snapshot()");

  assert.ok(base > 0 && cancel > base && vendor > cancel && snapshot > vendor);
  assert.match(sql, /assignment\.status in \('assigned', 'in_progress', 'blocked'\)/i);
  assert.match(sql, /existing_assignment\.source_id = role_assignment\.id/i);
  assert.match(sql, /revoke all on function private\.resolve_vendor_learning_assignments\(\)/i);
});
