import assert from "node:assert/strict";
import pg from "pg";

import {
  WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION as CATALOG,
  validateWarehouseOperatorReceivingCatalog,
} from "./warehouse-operator-receiving-certification-catalog.mjs";

const databaseUrl =
  process.env.MWELL_LOCAL_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("MWELL_LOCAL_DATABASE_URL or SUPABASE_DB_URL is required.");
}
validateWarehouseOperatorReceivingCatalog(CATALOG);

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const versionResult = await client.query(
    `select cv.id, cv.status, cv.version, cv.effective_at, cv.expires_at,
            cv.owner_id, cv.reviewer_id, cv.approved_at, cv.published_at
       from learning.curricula c
       join learning.curriculum_versions cv on cv.curriculum_id = c.id
      where c.catalog_key = $1 and cv.version = $2`,
    [CATALOG.catalogKey, CATALOG.version],
  );
  assert.equal(
    versionResult.rows.length,
    1,
    "Expected one governed curriculum version.",
  );
  const curriculumVersion = versionResult.rows[0];
  assert.equal(curriculumVersion.status, "published");
  assert.notEqual(curriculumVersion.owner_id, curriculumVersion.reviewer_id);
  assert.ok(curriculumVersion.approved_at);
  assert.ok(curriculumVersion.published_at);
  assert.ok(new Date(curriculumVersion.effective_at) <= new Date());
  assert.ok(
    !curriculumVersion.expires_at ||
      new Date(curriculumVersion.expires_at) > new Date(),
  );

  const composition = await client.query(
    `select cr.id as curriculum_requirement_id, cr.sort_order, cr.mandatory,
            r.requirement_key, rv.id as requirement_version_id,
            rv.version, rv.status, rv.requirement_kind, rv.title,
            rv.content_reference, rv.simulation_id, rv.assessment_settings,
            rv.pass_rules, rv.passing_score, rv.max_attempts,
            rv.source_references, rv.owner_id, rv.reviewer_id,
            rv.effective_at, rv.expires_at
       from learning.curriculum_requirements cr
       join learning.requirement_versions rv on rv.id = cr.requirement_version_id
       join learning.requirements r on r.id = rv.requirement_id
      where cr.curriculum_version_id = $1
      order by cr.sort_order`,
    [curriculumVersion.id],
  );
  assert.deepEqual(
    composition.rows.map((row) => row.requirement_key),
    CATALOG.requirements.map((item) => item.requirementKey),
  );
  assert.deepEqual(
    composition.rows.map((row) => row.sort_order),
    [0, 1, 2, 3],
  );
  for (const [index, row] of composition.rows.entries()) {
    const expected = CATALOG.requirements[index];
    assert.equal(row.mandatory, true);
    assert.equal(row.version, expected.version);
    assert.equal(row.status, "published");
    assert.equal(row.requirement_kind, expected.kind);
    assert.notEqual(row.owner_id, row.reviewer_id);
    assert.ok(new Date(row.effective_at) <= new Date());
    assert.ok(!row.expires_at || new Date(row.expires_at) > new Date());
  }

  const policy = composition.rows[1];
  assert.equal(policy.content_reference, "OPS-WH-RCV-001@4.2");
  assert.deepEqual(
    policy.source_references,
    CATALOG.requirements[1].sourceReferences,
  );

  const assessment = composition.rows[2];
  assert.equal(Number(assessment.passing_score), 80);
  assert.equal(assessment.max_attempts, 3);
  assert.deepEqual(
    assessment.assessment_settings,
    CATALOG.requirements[2].assessmentSettings,
  );
  assert.equal(
    JSON.stringify(assessment.assessment_settings).includes(
      "capture-identifiers",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(assessment.assessment_settings).includes(
      "controlled-quality",
    ),
    false,
  );
  const answerKey = await client.query(
    `select answer_key from private.learning_assessment_answer_keys
      where requirement_version_id = $1`,
    [assessment.requirement_version_id],
  );
  assert.equal(answerKey.rows.length, 1);
  assert.deepEqual(
    answerKey.rows[0].answer_key,
    CATALOG.requirements[2].privateAnswerKey,
  );

  const scenario = composition.rows[3];
  assert.equal(scenario.simulation_id, "warehouse-receiving-v1");
  assert.deepEqual(scenario.pass_rules, CATALOG.requirements[3].passRules);

  const prerequisites = await client.query(
    `select requirement.requirement_key,
            prerequisite_requirement.requirement_key as prerequisite_requirement_key
       from learning.curriculum_requirement_prerequisites edge
       join learning.requirement_versions requirement_version
         on requirement_version.id = edge.requirement_version_id
       join learning.requirements requirement
         on requirement.id = requirement_version.requirement_id
       join learning.requirement_versions prerequisite_version
         on prerequisite_version.id = edge.prerequisite_requirement_version_id
       join learning.requirements prerequisite_requirement
         on prerequisite_requirement.id = prerequisite_version.requirement_id
      where edge.curriculum_version_id = $1
      order by requirement.requirement_key`,
    [curriculumVersion.id],
  );
  const actualEdges = prerequisites.rows
    .map((row) => ({
      requirementKey: row.requirement_key,
      prerequisiteRequirementKey: row.prerequisite_requirement_key,
    }))
    .sort((left, right) =>
      left.requirementKey.localeCompare(right.requirementKey),
    );
  const expectedEdges = [...CATALOG.prerequisites].sort((left, right) =>
    left.requirementKey.localeCompare(right.requirementKey),
  );
  assert.deepEqual(actualEdges, expectedEdges);

  const outcomes = await client.query(
    `select outcome.module, outcome.capability
       from learning.curriculum_capability_outcomes outcome
      where outcome.curriculum_version_id = $1`,
    [curriculumVersion.id],
  );
  assert.deepEqual(outcomes.rows, [CATALOG.requirements[3].capabilityOutcome]);

  const mappings = await client.query(
    `select module, role, audience, department_id, effective_at, expires_at
       from learning.role_curricula
      where curriculum_version_id = $1`,
    [curriculumVersion.id],
  );
  assert.equal(mappings.rows.length, 1);
  assert.equal(mappings.rows[0].module, CATALOG.role.module);
  assert.equal(mappings.rows[0].role, CATALOG.role.role);
  assert.equal(mappings.rows[0].audience, CATALOG.audience);
  assert.equal(mappings.rows[0].department_id, null);
  assert.ok(new Date(mappings.rows[0].effective_at) <= new Date());
  assert.ok(
    !mappings.rows[0].expires_at ||
      new Date(mappings.rows[0].expires_at) > new Date(),
  );

  const representative = await client.query(
    `select role_assignment.user_id
       from core.user_roles role_assignment
       join core.profiles profile on profile.id = role_assignment.user_id
       join core.profile_department_scopes scope on scope.profile_id = profile.id
       join core.departments department on department.id = scope.department_id
      where role_assignment.module = $1 and role_assignment.role = $2
        and profile.kind = 'employee' and profile.status = 'active'
        and department.is_active
        and scope.effective_from <= current_date
        and (scope.effective_to is null or scope.effective_to >= current_date)
      order by (scope.scope_type = 'primary') desc, role_assignment.user_id
      limit 1`,
    [CATALOG.role.module, CATALOG.role.role],
  );
  assert.equal(
    representative.rows.length,
    1,
    "An active Warehouse Operator with department scope is required to verify assignment resolution.",
  );

  await client.query("begin isolation level read committed");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: representative.rows[0].user_id,
      role: "authenticated",
    }),
  ]);
  const resolved = await client.query(
    "select learning.resolve_assignments() as snapshot",
  );
  const assignment = resolved.rows[0].snapshot.curricula.find(
    (item) => item.curriculum.id === CATALOG.catalogKey,
  );
  assert.ok(
    assignment,
    "Warehouse Operator did not resolve the governed live assignment.",
  );
  assert.deepEqual(
    assignment.curriculum.requirementIds,
    CATALOG.requirements.map((item) => item.requirementKey),
  );
  await client.query("rollback");

  await client.query("begin isolation level read committed");
  await client.query("savepoint immutable_composition");
  let rejectedMutation = false;
  try {
    await client.query(
      `update learning.curriculum_requirements
          set sort_order = sort_order
        where curriculum_version_id = $1`,
      [curriculumVersion.id],
    );
  } catch (error) {
    rejectedMutation = /immutable|approved or published/i.test(error.message);
    await client.query("rollback to savepoint immutable_composition");
  }
  assert.equal(
    rejectedMutation,
    true,
    "Published curriculum composition accepted a mutation.",
  );
  await client.query("rollback");

  console.log(
    `Verified applied governed curriculum ${CATALOG.catalogKey} v${CATALOG.version}.`,
  );
} finally {
  await client.end();
}
