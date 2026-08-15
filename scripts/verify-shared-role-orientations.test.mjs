import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260816110000_sync_shared_role_orientations.sql",
  import.meta.url,
);

test("shared role orientation is propagated by audience, kind, and normalized title", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /source_version\.requirement_kind = 'orientation'/i);
  assert.match(sql, /target_version\.requirement_kind = 'orientation'/i);
  assert.match(sql, /target_requirement\.audience = v_audience/i);
  assert.match(sql, /pg_catalog\.regexp_replace[\s\S]*?'\\s\+'/i);
  assert.match(sql, /= v_source\.completion_key/i);
  assert.match(sql, /shared_completion_kind', 'role_orientation'/i);
});

test("orientation propagation preserves immutable evidence and assignment completion checks", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /insert into learning\.attempt_events/i);
  assert.match(sql, /shared_role_orientation_superseded_attempt/i);
  assert.match(sql, /update learning\.attempts[\s\S]*status = 'abandoned'/i);
  assert.match(sql, /source_assignment\.source_type not in \('retraining', 'corrective'\)/i);
  assert.match(sql, /target_assignment\.source_type not in \('retraining', 'corrective'\)/i);
  assert.match(sql, /not exists \([\s\S]*learning\.curriculum_requirements/i);
  assert.match(sql, /return learning\.my_learning_snapshot\(\)/i);
});
