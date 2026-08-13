import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813080141_make_role_assignment_resolution_idempotent.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("does not recreate a role curriculum after terminal completion", () => {
  assert.match(
    migration,
    /insert into learning\.assignments[\s\S]*?and not exists \([\s\S]*?existing_assignment\.user_id = v_user_id[\s\S]*?existing_assignment\.curriculum_version_id =[\s\S]*?role_curriculum\.curriculum_version_id[\s\S]*?existing_assignment\.source_type = 'role'[\s\S]*?existing_assignment\.source_id = role_assignment\.id/i,
  );
  assert.doesNotMatch(
    migration,
    /existing_assignment\.status in \('assigned', 'in_progress', 'blocked'\)/i,
  );
});
