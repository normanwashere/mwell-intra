import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertDisposableLocalDatabaseUrl } from "./verify-learning-catalog.mjs";

const IDS = Object.freeze({
  owner: "10000000-0000-4000-8000-000000000001",
  reviewer: "10000000-0000-4000-8000-000000000002",
  department: "20000000-0000-4000-8000-000000000001",
  curriculum: "30000000-0000-4000-8000-000000000001",
  curriculumVersion: "30000000-0000-4000-8000-000000000002",
  requirement: "40000000-0000-4000-8000-000000000001",
  requirementVersion: "40000000-0000-4000-8000-000000000002",
  curriculumRequirement: "50000000-0000-4000-8000-000000000001",
  outcome: "50000000-0000-4000-8000-000000000002",
  roleCurriculum: "50000000-0000-4000-8000-000000000003",
});

const SCENARIOS = Object.freeze({
  assignmentIssuanceFirst: scenario(1),
  assignmentLossFirst: scenario(2),
  roleIssuanceFirst: scenario(3),
  roleLossFirst: scenario(4),
  capabilityIssuanceFirst: scenario(5),
  capabilityLossFirst: scenario(6),
  privilege: scenario(7),
});

function scenario(number) {
  const suffix = String(number).padStart(12, "0");
  return {
    user: `60000000-0000-4000-8000-${suffix}`,
    assignment: `70000000-0000-4000-8000-${suffix}`,
    assignmentRequirement: `71000000-0000-4000-8000-${suffix}`,
    roleAssignment: `80000000-0000-4000-8000-${suffix}`,
    certification: `90000000-0000-4000-8000-${suffix}`,
  };
}

async function seedFixture(client) {
  const evidenceScenarios = Object.entries(SCENARIOS)
    .filter(([name]) => name !== "privilege")
    .map(([, entry]) => entry);
  await client.query("set session_replication_role = replica");
  try {
    const profiles = [
      [IDS.owner, "learning-ci-owner@example.invalid", "CI Owner"],
      [IDS.reviewer, "learning-ci-reviewer@example.invalid", "CI Reviewer"],
      ...Object.entries(SCENARIOS).map(([name, entry]) => [
        entry.user,
        `learning-ci-${name.toLowerCase()}@example.invalid`,
        `CI ${name}`,
      ]),
    ];
    const profileValues = profiles
      .map(
        (_, index) =>
          `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}, 'employee', 'active', '2020-01-01')`,
      )
      .join(",\n");
    await client.query(
      `
        insert into core.profiles(id, email, full_name, kind, status, created_at)
        values ${profileValues}
      `,
      profiles.flat(),
    );
    await client.query(
      `insert into core.departments(id, code, name, created_at)
       values ($1, 'learningci', 'Learning CI', '2020-01-01')`,
      [IDS.department],
    );
    await client.query(
      `insert into core.capabilities(module, cap) values ('learning_ci', 'operate')`,
    );
    await client.query(
      `insert into core.roles(module, role, label, is_active)
       values ('learning_ci', 'operator', 'Learning CI Operator', true)`,
    );
    await client.query(
      `insert into core.role_capabilities(module, role, cap)
       values ('learning_ci', 'operator', 'operate')`,
    );
    for (const entry of Object.values(SCENARIOS)) {
      await client.query(
        `insert into core.user_roles(id, user_id, module, role)
         values ($1, $2, 'learning_ci', 'operator')`,
        [entry.roleAssignment, entry.user],
      );
    }
    await client.query(
      `
        insert into learning.curricula(
          id, catalog_key, audience, governance_owner, status, created_by, created_at
        ) values ($1, 'learning.ci', 'internal', 'platform', 'active', $2, '2020-01-01')
      `,
      [IDS.curriculum, IDS.owner],
    );
    await client.query(
      `
        insert into learning.curriculum_versions(
          id, curriculum_id, audience, version, status, effective_at,
          change_reason, materiality, owner_id, reviewer_id, approved_at,
          published_at, created_at
        ) values (
          $1, $2, 'internal', 1, 'published', '2020-01-04',
          'CI verification', 'material', $3, $4, '2020-01-02',
          '2020-01-03', '2020-01-01'
        )
      `,
      [IDS.curriculumVersion, IDS.curriculum, IDS.owner, IDS.reviewer],
    );
    await client.query(
      `
        insert into learning.requirements(
          id, requirement_key, audience, requirement_kind, governance_owner,
          status, created_by, created_at
        ) values (
          $1, 'learning.ci.orientation', 'internal', 'orientation', 'platform',
          'active', $2, '2020-01-01'
        )
      `,
      [IDS.requirement, IDS.owner],
    );
    await client.query(
      `
        insert into learning.requirement_versions(
          id, requirement_id, audience, requirement_kind, governance_owner,
          version, status, title, estimated_minutes, effective_at,
          change_reason, materiality, owner_id, reviewer_id, approved_at,
          published_at, created_at
        ) values (
          $1, $2, 'internal', 'orientation', 'platform', 1, 'published',
          'Learning CI orientation', 1, '2020-01-04', 'CI verification',
          'material', $3, $4, '2020-01-02', '2020-01-03', '2020-01-01'
        )
      `,
      [IDS.requirementVersion, IDS.requirement, IDS.owner, IDS.reviewer],
    );
    await client.query(
      `
        insert into learning.curriculum_requirements(
          id, curriculum_version_id, requirement_version_id, audience,
          sort_order, mandatory, created_by, created_at
        ) values ($1, $2, $3, 'internal', 0, true, $4, '2020-01-01')
      `,
      [
        IDS.curriculumRequirement,
        IDS.curriculumVersion,
        IDS.requirementVersion,
        IDS.owner,
      ],
    );
    await client.query(
      `
        insert into learning.curriculum_capability_outcomes(
          id, curriculum_requirement_id, curriculum_version_id,
          requirement_version_id, audience, module, capability, created_by,
          created_at
        ) values (
          $1, $2, $3, $4, 'internal', 'learning_ci', 'operate', $5, '2020-01-01'
        )
      `,
      [
        IDS.outcome,
        IDS.curriculumRequirement,
        IDS.curriculumVersion,
        IDS.requirementVersion,
        IDS.owner,
      ],
    );
    await client.query(
      `
        insert into learning.role_curricula(
          id, module, role, curriculum_version_id, audience, effective_at,
          created_by, created_at
        ) values (
          $1, 'learning_ci', 'operator', $2, 'internal', '2020-01-04', $3, '2020-01-01'
        )
      `,
      [IDS.roleCurriculum, IDS.curriculumVersion, IDS.owner],
    );
    for (const entry of evidenceScenarios) {
      await client.query(
        `
          insert into learning.assignments(
            id, user_id, profile_kind, department_id, curriculum_version_id,
            audience, source_type, source_id, status, assigned_at, started_at,
            completed_at, assigned_by, created_at
          ) values (
            $1, $2, 'employee', $3, $4, 'internal', 'role', $5, 'completed',
            '2020-01-05', '2020-01-05', '2020-01-06', $6, '2020-01-05'
          )
        `,
        [
          entry.assignment,
          entry.user,
          IDS.department,
          IDS.curriculumVersion,
          entry.roleAssignment,
          IDS.owner,
        ],
      );
      await client.query(
        `
          insert into learning.assignment_requirements(
            id, assignment_id, user_id, department_id, audience,
            requirement_version_id, status, started_at, completed_at, created_at
          ) values (
            $1, $2, $3, $4, 'internal', $5, 'passed',
            '2020-01-05', '2020-01-06', '2020-01-05'
          )
        `,
        [
          entry.assignmentRequirement,
          entry.assignment,
          entry.user,
          IDS.department,
          IDS.requirementVersion,
        ],
      );
    }
  } finally {
    await client.query("set session_replication_role = origin");
  }
}

async function cleanupFixture(client) {
  await client.query("rollback").catch(() => undefined);
  await client.query("set session_replication_role = replica");
  try {
    const certificationIds = Object.values(SCENARIOS).map(
      (entry) => entry.certification,
    );
    const assignmentRequirementIds = Object.values(SCENARIOS).map(
      (entry) => entry.assignmentRequirement,
    );
    const assignmentIds = Object.values(SCENARIOS).map(
      (entry) => entry.assignment,
    );
    const roleAssignmentIds = Object.values(SCENARIOS).map(
      (entry) => entry.roleAssignment,
    );
    const profileIds = [
      IDS.owner,
      IDS.reviewer,
      ...Object.values(SCENARIOS).map((entry) => entry.user),
    ];

    await client.query(
      "delete from learning.certifications where id = any($1::uuid[]) or module = 'learning_ci'",
      [certificationIds],
    );
    await client.query(
      "delete from learning.assignment_requirements where id = any($1::uuid[])",
      [assignmentRequirementIds],
    );
    await client.query(
      "delete from learning.assignments where id = any($1::uuid[])",
      [assignmentIds],
    );
    await client.query("delete from learning.role_curricula where id = $1", [
      IDS.roleCurriculum,
    ]);
    await client.query(
      "delete from learning.curriculum_capability_outcomes where id = $1",
      [IDS.outcome],
    );
    await client.query(
      "delete from learning.curriculum_requirements where id = $1",
      [IDS.curriculumRequirement],
    );
    await client.query(
      "delete from learning.requirement_versions where id = $1",
      [IDS.requirementVersion],
    );
    await client.query("delete from learning.requirements where id = $1", [
      IDS.requirement,
    ]);
    await client.query(
      "delete from learning.curriculum_versions where id = $1",
      [IDS.curriculumVersion],
    );
    await client.query("delete from learning.curricula where id = $1", [
      IDS.curriculum,
    ]);
    await client.query(
      "delete from core.user_roles where id = any($1::uuid[]) or module = 'learning_ci'",
      [roleAssignmentIds],
    );
    await client.query(
      "delete from core.role_capabilities where module = 'learning_ci'",
    );
    await client.query("delete from core.roles where module = 'learning_ci'");
    await client.query(
      "delete from core.capabilities where module = 'learning_ci'",
    );
    await client.query("delete from core.departments where id = $1", [
      IDS.department,
    ]);
    await client.query("delete from core.profiles where id = any($1::uuid[])", [
      profileIds,
    ]);
  } finally {
    await client.query("set session_replication_role = origin");
  }
}

async function issueCertification(client, entry) {
  await client.query(
    `
      insert into learning.certifications(
        id, user_id, department_id, audience, assignment_id,
        source_role_assignment_id, source_role, module, capability,
        curriculum_version_id, requirement_version_ids, status, issued_at,
        effective_at, issued_by, evidence_references
      ) values (
        $1, $2, $3, 'internal', $4, $5, 'operator', 'learning_ci', 'operate',
        $6, array[$7]::uuid[], 'active', transaction_timestamp(),
        transaction_timestamp(), 'ci:applied-postgres', '[{"source":"ci"}]'::jsonb
      )
    `,
    [
      entry.certification,
      entry.user,
      IDS.department,
      entry.assignment,
      entry.roleAssignment,
      IDS.curriculumVersion,
      IDS.requirementVersion,
    ],
  );
}

async function assertStillBlocked(promise, label) {
  const state = await Promise.race([
    promise.then(() => "settled"),
    new Promise((resolvePromise) =>
      setTimeout(() => resolvePromise("blocked"), 250),
    ),
  ]);
  assert.equal(state, "blocked", `${label} did not wait on issuance locks`);
}

async function verifyIssuanceFirstRace({
  issueClient,
  lossClient,
  checkClient,
  entry,
  lossSql,
  lossParameters = [],
  expectedReason,
  label,
}) {
  await issueClient.query("begin isolation level read committed");
  await lossClient.query("begin isolation level read committed");
  try {
    await issueCertification(issueClient, entry);
    const loss = lossClient.query(lossSql, lossParameters);
    await assertStillBlocked(loss, label);
    await issueClient.query("commit");
    await loss;
    await lossClient.query("commit");
  } catch (error) {
    await Promise.allSettled([
      issueClient.query("rollback"),
      lossClient.query("rollback"),
    ]);
    throw error;
  }

  const result = await checkClient.query(
    `select status, revocation_reason, revoked_at is not null as revoked
     from learning.certifications where id = $1`,
    [entry.certification],
  );
  assert.deepEqual(result.rows, [
    { status: "revoked", revocation_reason: expectedReason, revoked: true },
  ]);
}

async function verifyAuthorityLossFirstRace({
  issueClient,
  lossClient,
  checkClient,
  entry,
  lossSql,
  lossParameters = [],
  label,
}) {
  await lossClient.query("begin isolation level read committed");
  await issueClient.query("begin isolation level read committed");
  let issuance;
  try {
    await lossClient.query(lossSql, lossParameters);
    issuance = issueCertification(issueClient, entry);
    await assertStillBlocked(issuance, label);
    await lossClient.query("commit");
    await assert.rejects(
      issuance,
      /certification|source role|role assignment|role authority|capability|inactive/i,
    );
    await issueClient.query("rollback");
  } catch (error) {
    await Promise.allSettled([
      issueClient.query("rollback"),
      lossClient.query("rollback"),
    ]);
    throw error;
  }

  const result = await checkClient.query(
    `select count(*)::integer as "activeCount"
     from learning.certifications
     where id = $1 and status = 'active'`,
    [entry.certification],
  );
  assert.deepEqual(
    result.rows,
    [{ activeCount: 0 }],
    `${label}: expected no active certification after authority loss`,
  );
}

async function verifyRoleAssignmentUpdatePrivileges(client) {
  const functionPrivileges = await client.query(`
    select
      has_function_privilege('service_role', 'private.assert_learning_read_committed()', 'EXECUTE') as service_assert,
      has_function_privilege('service_role', 'private.guard_role_assignment_identity()', 'EXECUTE') as service_guard,
      has_function_privilege('authenticated', 'private.assert_learning_read_committed()', 'EXECUTE') as authenticated_assert,
      has_function_privilege('authenticated', 'private.guard_role_assignment_identity()', 'EXECUTE') as authenticated_guard
  `);
  assert.deepEqual(functionPrivileges.rows, [
    {
      service_assert: true,
      service_guard: false,
      authenticated_assert: false,
      authenticated_guard: false,
    },
  ]);

  await client.query(
    "alter table core.user_roles add column learning_ci_unrelated text",
  );
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const noOp = await client.query(
      "update core.user_roles set module = module where id = $1 returning id",
      [SCENARIOS.privilege.roleAssignment],
    );
    assert.equal(noOp.rowCount, 1);
    const unrelated = await client.query(
      "update core.user_roles set learning_ci_unrelated = 'verified' where id = $1 returning learning_ci_unrelated",
      [SCENARIOS.privilege.roleAssignment],
    );
    assert.deepEqual(unrelated.rows, [{ learning_ci_unrelated: "verified" }]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.query(
      "alter table core.user_roles drop column learning_ci_unrelated",
    );
  }
}

async function run() {
  const connectionString = assertDisposableLocalDatabaseUrl(
    process.env.MWELL_LOCAL_DATABASE_URL ?? "",
  );
  const { Client } = await import("pg");
  const clients = Array.from(
    { length: 3 },
    () => new Client({ connectionString }),
  );
  await Promise.all(clients.map((client) => client.connect()));
  const [issueClient, lossClient, checkClient] = clients;
  try {
    await Promise.all(
      clients.flatMap((client) => [
        client.query("set lock_timeout = '10s'"),
        client.query("set statement_timeout = '20s'"),
        client.query("set deadlock_timeout = '1s'"),
      ]),
    );
    const isolation = await checkClient.query(
      "select current_setting('transaction_isolation') as isolation",
    );
    assert.equal(isolation.rows[0].isolation, "read committed");
    await cleanupFixture(checkClient);
    await seedFixture(checkClient);
    await verifyRoleAssignmentUpdatePrivileges(checkClient);

    await verifyIssuanceFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.assignmentIssuanceFirst,
      lossSql: "delete from core.user_roles where id = $1",
      lossParameters: [SCENARIOS.assignmentIssuanceFirst.roleAssignment],
      expectedReason: "system:source_role_assignment_removed",
      label: "assignment deletion issuance-first",
    });
    await verifyAuthorityLossFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.assignmentLossFirst,
      lossSql: "delete from core.user_roles where id = $1",
      lossParameters: [SCENARIOS.assignmentLossFirst.roleAssignment],
      label: "assignment deletion loss-first",
    });
    await verifyIssuanceFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.roleIssuanceFirst,
      lossSql:
        "update core.roles set is_active = false where module = 'learning_ci' and role = 'operator'",
      expectedReason: "system:source_role_inactive",
      label: "role deactivation issuance-first",
    });
    await checkClient.query(
      "update core.roles set is_active = true where module = 'learning_ci' and role = 'operator'",
    );
    await verifyAuthorityLossFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.roleLossFirst,
      lossSql:
        "update core.roles set is_active = false where module = 'learning_ci' and role = 'operator'",
      label: "role deactivation loss-first",
    });
    await checkClient.query(
      "update core.roles set is_active = true where module = 'learning_ci' and role = 'operator'",
    );
    await verifyIssuanceFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.capabilityIssuanceFirst,
      lossSql:
        "delete from core.role_capabilities where module = 'learning_ci' and role = 'operator' and cap = 'operate'",
      expectedReason: "system:source_role_capability_missing",
      label: "capability removal issuance-first",
    });
    await checkClient.query(
      "insert into core.role_capabilities(module, role, cap) values ('learning_ci', 'operator', 'operate')",
    );
    await verifyAuthorityLossFirstRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.capabilityLossFirst,
      lossSql:
        "delete from core.role_capabilities where module = 'learning_ci' and role = 'operator' and cap = 'operate'",
      label: "capability removal loss-first",
    });
    console.log(
      "Applied PostgreSQL learning concurrency passed (service_role updates and 6 READ COMMITTED races).",
    );
  } finally {
    await Promise.allSettled([
      issueClient.query("rollback"),
      lossClient.query("rollback"),
      checkClient.query("rollback"),
    ]);
    try {
      await cleanupFixture(checkClient);
    } finally {
      await Promise.allSettled(clients.map((client) => client.end()));
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await run();
}
