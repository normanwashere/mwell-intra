import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ORIENTATION_CATALOG } from "./learning-orientation-catalog.mjs";

const root = new URL("../", import.meta.url);

test("orientation catalog and live schema require the same terminal checkpoint", async () => {
  const [catalog, personas, migration, publisher, appliedVerifier] = await Promise.all([
    readFile(new URL("modules/learning/src/catalog.ts", root), "utf8"),
    readFile(new URL("modules/learning/src/personas.ts", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20260812210000_learning_orientation_runtime.sql",
        root,
      ),
      "utf8",
    ),
    readFile(new URL("scripts/publish-learning-orientations.mjs", root), "utf8"),
    readFile(new URL("scripts/verify-learning-orientations-applied.mjs", root), "utf8"),
  ]);

  assert.match(
    catalog,
    /kind:\s*"orientation"[\s\S]*?simulationId:\s*id/,
  );
  assert.match(catalog, /checkpointIds:[\s\S]{0,180}\["complete"\]/);
  assert.match(
    migration,
    /requirement_versions_orientation_runtime_check[\s\S]*?requirement_kind <> 'orientation'[\s\S]*?simulation_id[\s\S]*?required_checkpoints[\s\S]*?\? 'complete'/,
  );
  assert.match(
    migration,
    /validate constraint requirement_versions_orientation_runtime_check/,
  );
  for (const expected of ORIENTATION_CATALOG) {
    assert.match(personas, new RegExp(`id:\\s*"${expected.personaId}"`));
    for (const role of expected.roles) {
      assert.match(
        catalog,
        new RegExp(
          `"${role.module}:${role.role}":\\s*"${expected.personaId}"`,
        ),
      );
    }
  }
  assert.equal(ORIENTATION_CATALOG.length, 11);
  assert.match(publisher, /status = 'in_review'/);
  assert.match(publisher, /status = 'approved'/);
  assert.match(publisher, /status = 'published'/);
  assert.match(publisher, /reviewer_id = \$2/);
  assert.match(appliedVerifier, /from learning\.requirements/);
  assert.match(appliedVerifier, /requirement_status, "published"/);
});
