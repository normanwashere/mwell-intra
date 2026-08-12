import assert from "node:assert/strict";
import pg from "pg";
import {
  CI_ORIENTATION_OWNER,
  ORIENTATION_CATALOG,
} from "./learning-orientation-catalog.mjs";

const databaseUrl = process.env.MWELL_LOCAL_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!databaseUrl) throw new Error("MWELL_LOCAL_DATABASE_URL or SUPABASE_DB_URL is required.");
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const { rows } = await client.query(`
    select
      r.requirement_key,
      rv.version as requirement_version,
      rv.status as requirement_status,
      rv.title,
      rv.simulation_id,
      rv.pass_rules,
      rv.effective_at,
      (rv.effective_at <= statement_timestamp() and
        (rv.expires_at is null or rv.expires_at > statement_timestamp())) as requirement_effective,
      c.catalog_key,
      cv.version as curriculum_version,
      cv.status as curriculum_status,
      cv.effective_at as curriculum_effective_at,
      (cv.effective_at <= statement_timestamp() and
        (cv.expires_at is null or cv.expires_at > statement_timestamp())) as curriculum_effective,
      cr.mandatory
    from learning.requirements r
    join learning.requirement_versions rv on rv.requirement_id = r.id
    join learning.curriculum_requirements cr on cr.requirement_version_id = rv.id
    join learning.curriculum_versions cv on cv.id = cr.curriculum_version_id
    join learning.curricula c on c.id = cv.curriculum_id
    where r.requirement_kind = 'orientation'
      and rv.version = 1 and cv.version = 1
  `);
  assert.equal(rows.length, ORIENTATION_CATALOG.length, "Expected one composition per orientation.");
  const byKey = new Map(rows.map((row) => [row.requirement_key, row]));
  for (const expected of ORIENTATION_CATALOG) {
    const actual = byKey.get(expected.requirementKey);
    assert.ok(actual, `Missing ${expected.requirementKey}.`);
    assert.equal(actual.requirement_version, expected.version);
    assert.equal(actual.requirement_status, "published");
    assert.equal(actual.title, expected.title);
    assert.equal(actual.simulation_id, expected.simulationId);
    assert.deepEqual(actual.pass_rules.required_checkpoints, expected.checkpointIds);
    assert.ok(actual.effective_at);
    assert.equal(actual.requirement_effective, true);
    assert.equal(actual.catalog_key, expected.curriculumKey);
    assert.equal(actual.curriculum_version, expected.version);
    assert.equal(actual.curriculum_status, "published");
    assert.ok(actual.curriculum_effective_at);
    assert.equal(actual.curriculum_effective, true);
    assert.equal(actual.mandatory, true);
  }

  const roleRows = await client.query(`
    select rc.module, rc.role, c.catalog_key,
      (rc.effective_at <= statement_timestamp() and
       (rc.expires_at is null or rc.expires_at > statement_timestamp())) as effective
    from learning.role_curricula rc
    join learning.curriculum_versions cv on cv.id = rc.curriculum_version_id
    join learning.curricula c on c.id = cv.curriculum_id
    where c.catalog_key = any($1::text[]) and rc.department_id is null
  `, [ORIENTATION_CATALOG.map((item) => item.curriculumKey)]);
  const expectedRoles = ORIENTATION_CATALOG.flatMap((item) =>
    item.roles.map((role) => `${role.module}:${role.role}:${item.curriculumKey}`),
  ).sort();
  const actualRoles = roleRows.rows
    .map((row) => {
      assert.equal(row.effective, true);
      return `${row.module}:${row.role}:${row.catalog_key}`;
    })
    .sort();
  assert.deepEqual(actualRoles, expectedRoles, "Applied role-to-orientation mappings drifted.");

  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: CI_ORIENTATION_OWNER.id, role: "authenticated" }),
  ]);
  const resolved = await client.query("select learning.resolve_assignments() as snapshot");
  const assignments = resolved.rows[0].snapshot.assignments;
  assert.ok(
    assignments.some((assignment) =>
      assignment.requirements.some(
        (requirement) => requirement.simulation_id === "internal.platform_administrator.orientation.v1",
      ),
    ),
    "Representative platform administrator did not resolve its orientation assignment.",
  );
  await client.query("rollback");
  console.log(`Verified ${ORIENTATION_CATALOG.length} applied orientation curricula.`);
} finally {
  await client.end();
}
