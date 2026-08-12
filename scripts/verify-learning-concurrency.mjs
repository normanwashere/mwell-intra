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
  assignment: scenario(1),
  role: scenario(2),
  capability: scenario(3),
  privilege: scenario(4),
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
  const users = Object.values(SCENARIOS).map((entry) => entry.user);
  const evidenceScenarios = [
    SCENARIOS.assignment,
    SCENARIOS.role,
    SCENARIOS.capability,
  ];
  await client.query("set session_replication_role = replica");
  try {
    await client.query(
      `
        insert into core.profiles(id, email, full_name, kind, status, created_at)
        values
          ($1, 'learning-ci-owner@example.invalid', 'CI Owner', 'employee', 'active', '2020-01-01'),
          ($2, 'learning-ci-reviewer@example.invalid', 'CI Reviewer', 'employee', 'active', '2020-01-01'),
          ($3, 'learning-ci-assignment@example.invalid', 'CI Assignment', 'employee', 'active', '2020-01-01'),
          ($4, 'learning-ci-role@example.invalid', 'CI Role', 'employee', 'active', '2020-01-01'),
          ($5, 'learning-ci-capability@example.invalid', 'CI Capability', 'employee', 'active', '2020-01-01'),
          ($6, 'learning-ci-privilege@example.invalid', 'CI Privilege', 'employee', 'active', '2020-01-01')
      `,
      [IDS.owner, IDS.reviewer, ...users],
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

async function verifyIssuanceRace({
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
      clients.map((client) => client.query("set lock_timeout = '10s'")),
    );
    const isolation = await checkClient.query(
      "select current_setting('transaction_isolation') as isolation",
    );
    assert.equal(isolation.rows[0].isolation, "read committed");
    await seedFixture(checkClient);
    await verifyRoleAssignmentUpdatePrivileges(checkClient);

    await verifyIssuanceRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.assignment,
      lossSql: "delete from core.user_roles where id = $1",
      lossParameters: [SCENARIOS.assignment.roleAssignment],
      expectedReason: "system:source_role_assignment_removed",
      label: "assignment deletion",
    });
    await verifyIssuanceRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.role,
      lossSql:
        "update core.roles set is_active = false where module = 'learning_ci' and role = 'operator'",
      expectedReason: "system:source_role_inactive",
      label: "role deactivation",
    });
    await checkClient.query(
      "update core.roles set is_active = true where module = 'learning_ci' and role = 'operator'",
    );
    await verifyIssuanceRace({
      issueClient,
      lossClient,
      checkClient,
      entry: SCENARIOS.capability,
      lossSql:
        "delete from core.role_capabilities where module = 'learning_ci' and role = 'operator' and cap = 'operate'",
      expectedReason: "system:source_role_capability_missing",
      label: "capability removal",
    });
    console.log(
      "Applied PostgreSQL learning concurrency passed (service_role updates and 3 READ COMMITTED races).",
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await run();
}
