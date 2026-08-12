import assert from "node:assert/strict";
import pg from "pg";

import {
  CI_ORIENTATION_OWNER,
  CI_ORIENTATION_REVIEWER,
} from "./learning-orientation-catalog.mjs";
import {
  CI_WAREHOUSE_DEPARTMENT_ID,
  CI_WAREHOUSE_OPERATOR,
  WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION as CATALOG,
  validateWarehouseOperatorReceivingCatalog,
} from "./warehouse-operator-receiving-certification-catalog.mjs";

const databaseUrl =
  process.env.MWELL_LOCAL_DATABASE_URL ?? process.env.SUPABASE_DB_URL;
const bootstrapCi = process.argv.includes("--ci-bootstrap");
if (!databaseUrl) {
  throw new Error("MWELL_LOCAL_DATABASE_URL or SUPABASE_DB_URL is required.");
}
validateWarehouseOperatorReceivingCatalog(CATALOG);

const client = new pg.Client({ connectionString: databaseUrl });
let reviewerId;

function assertLocalBootstrapTarget() {
  const host = new URL(databaseUrl.replace(/^postgresql:/, "http:")).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error("--ci-bootstrap is restricted to a local database.");
  }
}

async function bootstrapProfile(profile) {
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at, raw_app_meta_data,
       raw_user_meta_data, confirmation_token, recovery_token,
       email_change_token_new, email_change, is_sso_user, is_anonymous
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated',
       'authenticated', $2, '', clock_timestamp(), clock_timestamp(),
       clock_timestamp(), '{"provider":"email","providers":["email"],"kind":"employee"}'::jsonb,
       '{}'::jsonb, '', '', '', '', false, false
     ) on conflict (id) do nothing`,
    [profile.id, profile.email],
  );
  await client.query(
    `insert into core.profiles (id, email, full_name, kind, status)
     values ($1, $2, $3, 'employee', 'active')
     on conflict (id) do update set status = 'active'`,
    [profile.id, profile.email, profile.email.split("@")[0]],
  );
}

async function bootstrapCiActors() {
  assertLocalBootstrapTarget();
  for (const profile of [
    CI_ORIENTATION_OWNER,
    CI_ORIENTATION_REVIEWER,
    CI_WAREHOUSE_OPERATOR,
  ]) {
    await bootstrapProfile(profile);
  }
  await client.query(
    `insert into core.departments (id, code, name, is_active)
     values ($1, 'warehouse-certification-ci', 'Warehouse Certification CI', true)
     on conflict (id) do update set is_active = true`,
    [CI_WAREHOUSE_DEPARTMENT_ID],
  );
  await client.query(
    `insert into core.profile_department_scopes (
       profile_id, department_id, scope_type, effective_from, created_by
     ) values ($1, $2, 'primary', current_date, $1)
     on conflict (profile_id, department_id, scope_type, effective_from) do nothing`,
    [CI_WAREHOUSE_OPERATOR.id, CI_WAREHOUSE_DEPARTMENT_ID],
  );
  await client.query(
    `insert into core.user_roles (user_id, module, role)
     values ($1, 'warehouse', 'warehouse_operator')
     on conflict (user_id, module, role) do nothing`,
    [CI_WAREHOUSE_OPERATOR.id],
  );
}

async function profileId(email, label) {
  const { rows } = await client.query(
    `select id from core.profiles
      where lower(email) = lower($1) and kind = 'employee' and status = 'active'`,
    [email],
  );
  if (rows.length !== 1) {
    throw new Error(
      `${label} must resolve to exactly one active employee profile.`,
    );
  }
  return rows[0].id;
}

async function advanceVersion(table, id) {
  const allowed = new Set([
    "learning.requirement_versions",
    "learning.curriculum_versions",
  ]);
  if (!allowed.has(table))
    throw new Error("Unexpected learning version table.");
  let {
    rows: [row],
  } = await client.query(
    `select status from ${table} where id = $1 for update`,
    [id],
  );
  if (row.status === "draft") {
    await client.query(
      `update ${table} set status = 'in_review' where id = $1`,
      [id],
    );
    row = { status: "in_review" };
  }
  if (row.status === "in_review") {
    await client.query(
      `update ${table}
          set status = 'approved', reviewer_id = $2,
              approved_at = statement_timestamp(), effective_at = statement_timestamp()
        where id = $1`,
      [id, reviewerId],
    );
    row = { status: "approved" };
  }
  if (row.status === "approved") {
    await client.query(
      `update ${table} set status = 'published', published_at = effective_at where id = $1`,
      [id],
    );
    row = { status: "published" };
  }
  if (row.status !== "published") {
    throw new Error(
      `${table} ${id} is ${row.status}; governed publication cannot continue.`,
    );
  }
}

async function requireExistingOrientation(item) {
  const { rows } = await client.query(
    `select rv.id, rv.status, rv.effective_at, rv.expires_at,
            r.audience, r.requirement_kind
       from learning.requirements r
       join learning.requirement_versions rv on rv.requirement_id = r.id
      where r.requirement_key = $1 and rv.version = $2
      for share of rv`,
    [item.requirementKey, item.version],
  );
  if (rows.length !== 1) {
    throw new Error(
      `Existing prerequisite ${item.requirementKey} v${item.version} is not published; run publish:learning-orientations first.`,
    );
  }
  const row = rows[0];
  assert.equal(row.audience, CATALOG.audience);
  assert.equal(row.requirement_kind, item.kind);
  assert.equal(row.status, "published");
  assert.ok(row.effective_at && new Date(row.effective_at) <= new Date());
  assert.ok(!row.expires_at || new Date(row.expires_at) > new Date());
  return row.id;
}

async function publishRequirement(item, ownerId) {
  await client.query(
    `insert into learning.requirements (
       requirement_key, audience, requirement_kind, governance_owner, status, created_by
     ) values ($1, $2, $3, $4, 'active', $5)
     on conflict (requirement_key) do nothing`,
    [
      item.requirementKey,
      CATALOG.audience,
      item.kind,
      item.governanceOwner,
      ownerId,
    ],
  );
  const root = await client.query(
    `select id, audience, requirement_kind, governance_owner, status
       from learning.requirements where requirement_key = $1 for share`,
    [item.requirementKey],
  );
  assert.equal(root.rows.length, 1);
  assert.deepEqual(
    {
      audience: root.rows[0].audience,
      requirementKind: root.rows[0].requirement_kind,
      governanceOwner: root.rows[0].governance_owner,
      status: root.rows[0].status,
    },
    {
      audience: CATALOG.audience,
      requirementKind: item.kind,
      governanceOwner: item.governanceOwner,
      status: "active",
    },
    `Requirement root ${item.requirementKey} conflicts with the governed catalog.`,
  );

  await client.query(
    `insert into learning.requirement_versions (
       requirement_id, audience, requirement_kind, governance_owner, version,
       status, title, content_reference, simulation_id, assessment_settings,
       pass_rules, passing_score, max_attempts, estimated_minutes, waivable,
       change_reason, materiality, source_references, owner_id
     ) values (
       $1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9::jsonb, $10::jsonb,
       $11, $12, $13, $14, 'Initial Warehouse Operator receiving certification',
       'material', $15::jsonb, $16
     ) on conflict (requirement_id, version) do nothing`,
    [
      root.rows[0].id,
      CATALOG.audience,
      item.kind,
      item.governanceOwner,
      item.version,
      item.title,
      item.contentReference ?? null,
      item.simulationId ?? null,
      JSON.stringify(item.assessmentSettings),
      JSON.stringify(item.passRules),
      item.passingScore ?? null,
      item.maxAttempts ?? null,
      item.estimatedMinutes,
      item.waivable,
      JSON.stringify(item.sourceReferences),
      ownerId,
    ],
  );
  const version = await client.query(
    `select id, audience, requirement_kind, governance_owner, version, status,
            title, content_reference, simulation_id, assessment_settings,
            pass_rules, passing_score, max_attempts, estimated_minutes,
            waivable, source_references, owner_id, reviewer_id
       from learning.requirement_versions
      where requirement_id = $1 and version = $2 for update`,
    [root.rows[0].id, item.version],
  );
  assert.equal(version.rows.length, 1);
  const row = version.rows[0];
  assert.equal(row.audience, CATALOG.audience);
  assert.equal(row.requirement_kind, item.kind);
  assert.equal(row.governance_owner, item.governanceOwner);
  assert.equal(row.title, item.title);
  assert.equal(row.content_reference, item.contentReference ?? null);
  assert.equal(row.simulation_id, item.simulationId ?? null);
  assert.deepEqual(row.assessment_settings, item.assessmentSettings);
  assert.deepEqual(row.pass_rules, item.passRules);
  assert.equal(
    row.passing_score === null ? null : Number(row.passing_score),
    item.passingScore ?? null,
  );
  assert.equal(row.max_attempts, item.maxAttempts ?? null);
  assert.equal(row.estimated_minutes, item.estimatedMinutes);
  assert.equal(row.waivable, item.waivable);
  assert.deepEqual(row.source_references, item.sourceReferences);
  assert.equal(row.owner_id, ownerId);
  if (!["draft", "in_review", "approved", "published"].includes(row.status)) {
    throw new Error(
      `Requirement ${item.requirementKey} is ${row.status}; publication refused.`,
    );
  }

  if (item.privateAnswerKey) {
    await client.query(
      `insert into private.learning_assessment_answer_keys (
         requirement_version_id, answer_key, created_by, updated_by
       ) values ($1, $2::jsonb, $3, $3)
       on conflict (requirement_version_id) do nothing`,
      [row.id, JSON.stringify(item.privateAnswerKey), ownerId],
    );
    const answerKey = await client.query(
      `select answer_key from private.learning_assessment_answer_keys
        where requirement_version_id = $1 for share`,
      [row.id],
    );
    assert.equal(answerKey.rows.length, 1);
    assert.deepEqual(
      answerKey.rows[0].answer_key,
      item.privateAnswerKey,
      "A published assessment answer key cannot be replaced; publish a new version.",
    );
  }
  await advanceVersion("learning.requirement_versions", row.id);
  return row.id;
}

async function publishCurriculum(requirementVersionIds, ownerId) {
  await client.query(
    `insert into learning.curricula (
       catalog_key, audience, governance_owner, status, created_by
     ) values ($1, $2, $3, 'active', $4)
     on conflict (catalog_key) do nothing`,
    [CATALOG.catalogKey, CATALOG.audience, CATALOG.governanceOwner, ownerId],
  );
  const curriculum = await client.query(
    `select id, audience, governance_owner, status
       from learning.curricula where catalog_key = $1 for share`,
    [CATALOG.catalogKey],
  );
  assert.equal(curriculum.rows.length, 1);
  assert.equal(curriculum.rows[0].audience, CATALOG.audience);
  assert.equal(curriculum.rows[0].governance_owner, CATALOG.governanceOwner);
  assert.equal(curriculum.rows[0].status, "active");

  const sourceReferences = [
    { type: "governed_catalog", id: CATALOG.catalogKey, version: 1 },
  ];
  await client.query(
    `insert into learning.curriculum_versions (
       curriculum_id, audience, version, status, change_reason, materiality,
       source_references, owner_id
     ) values ($1, $2, $3, 'draft',
       'Initial Warehouse Operator receiving certification', 'material',
       $4::jsonb, $5)
     on conflict (curriculum_id, version) do nothing`,
    [
      curriculum.rows[0].id,
      CATALOG.audience,
      CATALOG.version,
      JSON.stringify(sourceReferences),
      ownerId,
    ],
  );
  const version = await client.query(
    `select id, status, audience, source_references, owner_id
       from learning.curriculum_versions
      where curriculum_id = $1 and version = $2 for update`,
    [curriculum.rows[0].id, CATALOG.version],
  );
  assert.equal(version.rows.length, 1);
  const curriculumVersion = version.rows[0];
  assert.equal(curriculumVersion.audience, CATALOG.audience);
  assert.equal(curriculumVersion.owner_id, ownerId);
  assert.deepEqual(curriculumVersion.source_references, sourceReferences);
  if (
    !["draft", "in_review", "approved", "published"].includes(
      curriculumVersion.status,
    )
  ) {
    throw new Error(
      `Curriculum ${CATALOG.catalogKey} is ${curriculumVersion.status}; publication refused.`,
    );
  }

  if (["draft", "in_review"].includes(curriculumVersion.status)) {
    for (const item of CATALOG.requirements) {
      await client.query(
        `insert into learning.curriculum_requirements (
           curriculum_version_id, requirement_version_id, audience,
           sort_order, mandatory, created_by
         ) values ($1, $2, $3, $4, true, $5)
         on conflict (curriculum_version_id, requirement_version_id) do nothing`,
        [
          curriculumVersion.id,
          requirementVersionIds.get(item.requirementKey),
          CATALOG.audience,
          item.sortOrder,
          ownerId,
        ],
      );
    }
    const composition = await client.query(
      `select id, requirement_version_id
         from learning.curriculum_requirements
        where curriculum_version_id = $1`,
      [curriculumVersion.id],
    );
    const compositionByRequirement = new Map(
      composition.rows.map((row) => [row.requirement_version_id, row.id]),
    );
    for (const edge of CATALOG.prerequisites) {
      const requirementVersionId = requirementVersionIds.get(
        edge.requirementKey,
      );
      await client.query(
        `insert into learning.curriculum_requirement_prerequisites (
           curriculum_requirement_id, curriculum_version_id,
           requirement_version_id, prerequisite_requirement_version_id,
           audience, created_by
         ) values ($1, $2, $3, $4, $5, $6)
         on conflict (curriculum_requirement_id, prerequisite_requirement_version_id) do nothing`,
        [
          compositionByRequirement.get(requirementVersionId),
          curriculumVersion.id,
          requirementVersionId,
          requirementVersionIds.get(edge.prerequisiteRequirementKey),
          CATALOG.audience,
          ownerId,
        ],
      );
    }
    const scenario = CATALOG.requirements.find(
      (item) => item.capabilityOutcome,
    );
    const scenarioVersionId = requirementVersionIds.get(
      scenario.requirementKey,
    );
    await client.query(
      `insert into learning.curriculum_capability_outcomes (
         curriculum_requirement_id, curriculum_version_id,
         requirement_version_id, audience, module, capability, created_by
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (curriculum_requirement_id, module, capability) do nothing`,
      [
        compositionByRequirement.get(scenarioVersionId),
        curriculumVersion.id,
        scenarioVersionId,
        CATALOG.audience,
        scenario.capabilityOutcome.module,
        scenario.capabilityOutcome.capability,
        ownerId,
      ],
    );
  }

  await assertAppliedComposition(curriculumVersion.id, requirementVersionIds);
  await assertAppliedGraph(curriculumVersion.id);
  await advanceVersion("learning.curriculum_versions", curriculumVersion.id);
  const effective = await client.query(
    `select effective_at from learning.curriculum_versions where id = $1`,
    [curriculumVersion.id],
  );
  await client.query(
    `insert into learning.role_curricula (
       module, role, curriculum_version_id, audience, department_id,
       effective_at, created_by
     ) select $1, $2, $3, $4, null, $5, $6
     where not exists (
       select 1 from learning.role_curricula
        where module = $1 and role = $2 and curriculum_version_id = $3
          and department_id is null
     )`,
    [
      CATALOG.role.module,
      CATALOG.role.role,
      curriculumVersion.id,
      CATALOG.audience,
      effective.rows[0].effective_at,
      ownerId,
    ],
  );
  return curriculumVersion.id;
}

async function assertAppliedComposition(
  curriculumVersionId,
  requirementVersionIds,
) {
  const rows = await client.query(
    `select cr.sort_order, cr.mandatory, r.requirement_key
       from learning.curriculum_requirements cr
       join learning.requirement_versions rv on rv.id = cr.requirement_version_id
       join learning.requirements r on r.id = rv.requirement_id
      where cr.curriculum_version_id = $1
      order by cr.sort_order`,
    [curriculumVersionId],
  );
  assert.deepEqual(
    rows.rows.map((row) => ({
      requirementKey: row.requirement_key,
      sortOrder: row.sort_order,
      mandatory: row.mandatory,
    })),
    CATALOG.requirements.map((item) => ({
      requirementKey: item.requirementKey,
      sortOrder: item.sortOrder,
      mandatory: true,
    })),
    "Existing curriculum composition conflicts with the immutable catalog.",
  );
  assert.equal(requirementVersionIds.size, CATALOG.requirements.length);
}

async function assertAppliedGraph(curriculumVersionId) {
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
    [curriculumVersionId],
  );
  const actualEdges = prerequisites.rows.map((row) => ({
    requirementKey: row.requirement_key,
    prerequisiteRequirementKey: row.prerequisite_requirement_key,
  }));
  const expectedEdges = [...CATALOG.prerequisites].sort((left, right) =>
    left.requirementKey.localeCompare(right.requirementKey),
  );
  assert.deepEqual(
    actualEdges,
    expectedEdges,
    "Existing prerequisite graph conflicts with the immutable catalog.",
  );

  const outcomes = await client.query(
    `select outcome.module, outcome.capability
       from learning.curriculum_capability_outcomes outcome
      where outcome.curriculum_version_id = $1
      order by outcome.module, outcome.capability`,
    [curriculumVersionId],
  );
  assert.deepEqual(
    outcomes.rows,
    [CATALOG.requirements[3].capabilityOutcome],
    "Existing capability outcomes conflict with the immutable catalog.",
  );
}

let ownerId;
try {
  await client.connect();
  await client.query("begin isolation level read committed");
  await client.query(
    "select pg_advisory_xact_lock(hashtext('mwell.learning.warehouse-operator-receiving.publisher'))",
  );
  if (bootstrapCi) await bootstrapCiActors();

  const ownerEmail = bootstrapCi
    ? CI_ORIENTATION_OWNER.email
    : process.env.MWELL_LEARNING_OWNER_EMAIL;
  const reviewerEmail = bootstrapCi
    ? CI_ORIENTATION_REVIEWER.email
    : process.env.MWELL_LEARNING_REVIEWER_EMAIL;
  if (
    !ownerEmail ||
    !reviewerEmail ||
    ownerEmail.toLowerCase() === reviewerEmail.toLowerCase()
  ) {
    throw new Error(
      "Distinct MWELL_LEARNING_OWNER_EMAIL and MWELL_LEARNING_REVIEWER_EMAIL values are required.",
    );
  }
  ownerId = await profileId(ownerEmail, "Learning owner");
  reviewerId = await profileId(reviewerEmail, "Learning reviewer");
  assert.notEqual(
    ownerId,
    reviewerId,
    "Learning owner and independent reviewer must differ.",
  );

  const requirementVersionIds = new Map();
  for (const item of CATALOG.requirements) {
    const id = item.existing
      ? await requireExistingOrientation(item)
      : await publishRequirement(item, ownerId);
    requirementVersionIds.set(item.requirementKey, id);
  }
  await publishCurriculum(requirementVersionIds, ownerId);
  await client.query("commit");
  console.log(
    `Published governed curriculum ${CATALOG.catalogKey} v${CATALOG.version}.`,
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
