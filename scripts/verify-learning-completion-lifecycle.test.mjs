import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const completionAlignmentSql = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260812180000_learning_completion_alignment.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const completionHardeningSql = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260812190000_learning_completion_evidence_hardening.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const legacyCompletionAlignmentSql = readFileSync(
  fileURLToPath(
    new URL(
      "./fixtures/20260812180000_learning_completion_alignment.legacy.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
assert.equal(
  createHash("sha256")
    .update(legacyCompletionAlignmentSql.replace(/\r\n?/g, "\n"))
    .digest("hex"),
  "4d97c2f1f74050df76ff3f981d3047760cefaee1bae7f81ab212e6aaf9141cef",
  "The deployed completion-alignment fixture must remain immutable.",
);
const foundationMigrationSql = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260812130000_learning_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function foundationFunction(name) {
  const match = foundationMigrationSql.match(
    new RegExp(
      `create or replace function learning\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `Missing foundation function learning.${name}().`);
  return match[0];
}

const ids = Object.freeze({
  user: "00000000-0000-0000-0000-000000000001",
  department: "00000000-0000-0000-0000-000000000010",
  curriculum: "00000000-0000-0000-0000-000000000100",
  sourceAssignment: "00000000-0000-0000-0000-000000000201",
  targetAssignment: "00000000-0000-0000-0000-000000000202",
  correctiveAssignment: "00000000-0000-0000-0000-000000000203",
  retrainingSourceAssignment: "00000000-0000-0000-0000-000000000204",
  retrainingTargetAssignment: "00000000-0000-0000-0000-000000000205",
  resolveTargetAssignment: "00000000-0000-0000-0000-000000000206",
  startTargetAssignment: "00000000-0000-0000-0000-000000000207",
  policySourceAssignment: "00000000-0000-0000-0000-000000000208",
  policyTargetAssignment: "00000000-0000-0000-0000-000000000209",
  chainTargetAssignment: "00000000-0000-0000-0000-000000000210",
  policyChainTargetAssignment: "00000000-0000-0000-0000-000000000211",
  blockedAssignment: "00000000-0000-0000-0000-000000000212",
  requirementVersion: "00000000-0000-0000-0000-000000000301",
  retrainingRequirementVersion: "00000000-0000-0000-0000-000000000302",
  policyRequirementVersion: "00000000-0000-0000-0000-000000000303",
  sourceRequirement: "00000000-0000-0000-0000-000000000401",
  targetRequirement: "00000000-0000-0000-0000-000000000402",
  correctiveRequirement: "00000000-0000-0000-0000-000000000403",
  retrainingSourceRequirement: "00000000-0000-0000-0000-000000000404",
  retrainingTargetRequirement: "00000000-0000-0000-0000-000000000405",
  resolveTargetRequirement: "00000000-0000-0000-0000-000000000406",
  startTargetRequirement: "00000000-0000-0000-0000-000000000407",
  policySourceRequirement: "00000000-0000-0000-0000-000000000408",
  policyTargetRequirement: "00000000-0000-0000-0000-000000000409",
  chainTargetRequirement: "00000000-0000-0000-0000-000000000410",
  policyChainTargetRequirement: "00000000-0000-0000-0000-000000000411",
  blockedRequirement: "00000000-0000-0000-0000-000000000412",
  sourceAttempt: "00000000-0000-0000-0000-000000000501",
  targetAttempt: "00000000-0000-0000-0000-000000000502",
  certification: "00000000-0000-0000-0000-000000000601",
  policyCertification: "00000000-0000-0000-0000-000000000602",
  chainCertification: "00000000-0000-0000-0000-000000000603",
  policyChainCertification: "00000000-0000-0000-0000-000000000604",
  idempotency: "00000000-0000-0000-0000-000000000701",
  policyAcknowledgment: "00000000-0000-0000-0000-000000000801",
});

async function createCompletionDatabase({ legacyAlignment = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create schema auth;
    create schema core;
    create schema learning;
    create schema private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(
        pg_catalog.current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;

    create function public.digest(data bytea, algorithm text)
    returns bytea
    language sql
    immutable
    as $$ select data $$;

    create table core.profiles (
      id uuid primary key,
      status text not null,
      kind text not null
    );
    create table core.activity_log (
      id bigint generated always as identity primary key,
      module text not null,
      entity_type text not null,
      entity_id uuid not null,
      action text not null,
      actor uuid not null,
      detail jsonb not null
    );
    create table learning.assignments (
      id uuid primary key,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      curriculum_version_id uuid not null,
      source_type text not null,
      source_id uuid,
      status text not null,
      started_at timestamptz,
      completed_at timestamptz,
      blocked_reason text
    );
    create table learning.requirement_versions (
      id uuid primary key,
      audience text not null,
      requirement_kind text not null
    );
    create table learning.assignment_requirements (
      id uuid primary key,
      assignment_id uuid not null,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      requirement_version_id uuid not null,
      status text not null,
      attempt_count integer not null default 0,
      progress jsonb not null default '{}'::jsonb,
      waiver_evidence jsonb,
      started_at timestamptz,
      completed_at timestamptz
    );
    create table learning.attempts (
      id uuid primary key,
      assignment_requirement_id uuid not null,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      status text not null,
      integrity_result text,
      completed_at timestamptz
    );
    create table learning.attempt_events (
      id bigint generated always as identity primary key,
      attempt_id uuid not null,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      event_type text not null,
      actor_id uuid not null,
      evidence_hash text not null,
      detail jsonb not null,
      idempotency_key uuid not null,
      unique (attempt_id, idempotency_key)
    );
    create table learning.curriculum_requirements (
      curriculum_version_id uuid not null,
      audience text not null,
      requirement_version_id uuid not null,
      mandatory boolean not null
    );
    create table learning.policy_acknowledgments (
      id uuid primary key,
      assignment_requirement_id uuid not null,
      user_id uuid not null,
      audience text not null
    );
    create table learning.certifications (
      id uuid primary key,
      assignment_id uuid not null,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      requirement_version_ids uuid[] not null,
      evidence_references jsonb not null default '[]'::jsonb
    );

    create function private.assert_learning_read_committed()
    returns void
    language plpgsql
    stable
    as $$ begin return; end $$;

    create function learning.my_learning_snapshot()
    returns jsonb
    language sql
    stable
    as $$ select '{}'::jsonb $$;

    create function learning.resolve_assignments()
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$ begin return '{}'::jsonb; end $$;

    create function learning.start_requirement(payload jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $$ begin raise exception 'private start base should not run'; end $$;
  `);
  await db.exec(
    [
      foundationFunction("guard_attempt_lifecycle"),
      foundationFunction("guard_assignment_lifecycle"),
      foundationFunction("guard_assignment_requirement_lifecycle"),
    ].join("\n"),
  );
  await db.exec(
    legacyAlignment ? legacyCompletionAlignmentSql : completionAlignmentSql,
  );
  await db.exec(completionHardeningSql);
  await db.exec(`
    create or replace function private.resolve_assignments_base()
    returns jsonb
    language sql
    security definer
    set search_path = ''
    as $$ select '{}'::jsonb $$;

    create or replace function learning.my_learning_snapshot()
    returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $$ select '{}'::jsonb $$;
  `);
  await db.exec(`
    select pg_catalog.set_config(
      'request.jwt.claim.sub',
      '${ids.user}',
      false
    );
    insert into core.profiles(id, status, kind)
    values ('${ids.user}', 'active', 'employee');
    insert into learning.requirement_versions(
      id, audience, requirement_kind
    ) values
      ('${ids.requirementVersion}', 'internal', 'scenario'),
      ('${ids.retrainingRequirementVersion}', 'internal', 'scenario');
    insert into learning.assignments(
      id, user_id, department_id, audience, curriculum_version_id,
      source_type, status, completed_at
    ) values
      ('${ids.sourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'in_progress', null),
      ('${ids.targetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'in_progress', null),
      ('${ids.correctiveAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'corrective', 'assigned', null),
      ('${ids.retrainingSourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'retraining', 'completed', '2026-01-02T00:00:00Z'),
      ('${ids.retrainingTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned', null);
    insert into learning.assignment_requirements(
      id, assignment_id, user_id, department_id, audience,
      requirement_version_id, status, started_at, completed_at
    ) values
      ('${ids.sourceRequirement}', '${ids.sourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.requirementVersion}', 'passed', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'),
      ('${ids.targetRequirement}', '${ids.targetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.requirementVersion}', 'in_progress', '2026-01-03T00:00:00Z', null),
      ('${ids.correctiveRequirement}', '${ids.correctiveAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.requirementVersion}', 'not_started', null, null),
      ('${ids.retrainingSourceRequirement}', '${ids.retrainingSourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.retrainingRequirementVersion}', 'passed', '2026-01-02T00:00:00Z', '2026-01-02T00:10:00Z'),
      ('${ids.retrainingTargetRequirement}', '${ids.retrainingTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.retrainingRequirementVersion}', 'not_started', null, null);
    insert into learning.attempts(
      id, assignment_requirement_id, user_id, department_id, audience,
      status, integrity_result, completed_at
    ) values
      ('${ids.sourceAttempt}', '${ids.sourceRequirement}', '${ids.user}', '${ids.department}', 'internal', 'passed', 'valid', '2026-01-01T00:10:00Z'),
      ('${ids.targetAttempt}', '${ids.targetRequirement}', '${ids.user}', '${ids.department}', 'internal', 'in_progress', null, null);

    create trigger learning_attempts_lifecycle_guard
    before insert or update or delete on learning.attempts
    for each row execute function learning.guard_attempt_lifecycle();
    create trigger learning_assignments_lifecycle_guard
    before insert or update or delete on learning.assignments
    for each row execute function learning.guard_assignment_lifecycle();
    create trigger learning_assignment_requirements_lifecycle_guard
    before insert or update or delete on learning.assignment_requirements
    for each row execute function
      learning.guard_assignment_requirement_lifecycle();
  `);
  return db;
}

async function requirementStates(db) {
  const result = await db.query(`
    select id, status, progress
    from learning.assignment_requirements
    order by id
  `);
  return new Map(result.rows.map((row) => [row.id, row]));
}

test("applies shared completion once without bypassing retraining or corrective work", async () => {
  const db = await createCompletionDatabase({ legacyAlignment: true });
  try {
    const first = await db.query(
      "select learning.sync_shared_completions() as result",
    );
    assert.equal(first.rows[0].result.propagated_count, 1);

    const requirements = await requirementStates(db);
    assert.equal(requirements.get(ids.targetRequirement).status, "passed");
    assert.equal(
      requirements.get(ids.targetRequirement).progress
        .shared_completion_source_id,
      ids.sourceRequirement,
    );
    assert.equal(
      requirements.get(ids.correctiveRequirement).status,
      "not_started",
    );
    assert.equal(
      requirements.get(ids.retrainingTargetRequirement).status,
      "not_started",
    );

    const attempt = await db.query(
      "select status, integrity_result from learning.attempts where id = $1",
      [ids.targetAttempt],
    );
    assert.deepEqual(attempt.rows[0], {
      status: "abandoned",
      integrity_result: "valid",
    });
    const recovery = await db.query(`
      select event_type, detail
      from learning.attempt_events
      where attempt_id = '${ids.targetAttempt}'
    `);
    assert.equal(recovery.rows.length, 1);
    assert.equal(recovery.rows[0].event_type, "recovery");
    assert.equal(
      recovery.rows[0].detail.reason,
      "shared_completion_superseded_attempt",
    );

    const second = await db.query(
      "select learning.sync_shared_completions() as result",
    );
    assert.equal(second.rows[0].result.propagated_count, 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as count from learning.attempt_events",
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});

test("keeps convergence inside public resolve and start transactions", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.exec(`
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${ids.resolveTargetAssignment}', '${ids.user}', '${ids.department}',
        'internal', '${ids.curriculum}', 'role', 'assigned'
      );
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values (
        '${ids.resolveTargetRequirement}', '${ids.resolveTargetAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        '${ids.requirementVersion}', 'not_started'
      );
    `);

    await db.query("select learning.resolve_assignments()");
    let requirements = await requirementStates(db);
    assert.equal(
      requirements.get(ids.resolveTargetRequirement).status,
      "passed",
    );
    await db.exec(`
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${ids.startTargetAssignment}', '${ids.user}', '${ids.department}',
        'internal', '${ids.curriculum}', 'role', 'assigned'
      );
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values (
        '${ids.startTargetRequirement}', '${ids.startTargetAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        '${ids.requirementVersion}', 'not_started'
      );
    `);
    const started = await db.query(
      `select learning.start_requirement(
        pg_catalog.jsonb_build_object(
          'assignment_requirement_id', '${ids.startTargetRequirement}',
          'idempotency_key', '${ids.idempotency}'
        )
      ) as result`,
    );
    assert.equal(started.rows[0].result.attempt, null);
    assert.equal(
      started.rows[0].result.assignment_requirement.status,
      "passed",
    );
    requirements = await requirementStates(db);
    assert.equal(requirements.get(ids.startTargetRequirement).status, "passed");
  } finally {
    await db.close();
  }
});

test("writes source attempt lineage into certification evidence", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.query("select learning.sync_shared_completions()");
    await db.exec(`
      insert into learning.certifications(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_ids
      ) values (
        '${ids.certification}', '${ids.targetAssignment}', '${ids.user}',
        '${ids.department}', 'internal', array['${ids.requirementVersion}'::uuid]
      );
    `);
    const result = await db.query(
      "select evidence_references from learning.certifications where id = $1",
      [ids.certification],
    );
    assert.deepEqual(result.rows[0].evidence_references, [
      {
        acknowledgment_ids: [],
        assignment_requirement_id: ids.targetRequirement,
        attempt_ids: [ids.sourceAttempt],
        requirement_version_id: ids.requirementVersion,
        source_assignment_requirement_id: ids.sourceRequirement,
        status: "passed",
      },
    ]);
  } finally {
    await db.close();
  }
});

test("writes source policy acknowledgment lineage into certification evidence", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.exec(`
      insert into learning.requirement_versions(
        id, audience, requirement_kind
      ) values ('${ids.policyRequirementVersion}', 'internal', 'policy');
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values
        ('${ids.policySourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned'),
        ('${ids.policyTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned');
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values
        ('${ids.policySourceRequirement}', '${ids.policySourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.policyRequirementVersion}', 'not_started'),
        ('${ids.policyTargetRequirement}', '${ids.policyTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.policyRequirementVersion}', 'not_started');
      update learning.assignments
      set status = 'in_progress', started_at = '2026-01-01T00:00:00Z'
      where id = '${ids.policySourceAssignment}';
      update learning.assignment_requirements
      set status = 'in_progress', started_at = '2026-01-01T00:00:00Z'
      where id = '${ids.policySourceRequirement}';
      update learning.assignment_requirements
      set status = 'passed', completed_at = '2026-01-01T00:10:00Z'
      where id = '${ids.policySourceRequirement}';
      update learning.assignments
      set status = 'completed', completed_at = '2026-01-01T00:10:00Z'
      where id = '${ids.policySourceAssignment}';
      insert into learning.policy_acknowledgments(
        id, assignment_requirement_id, user_id, audience
      ) values (
        '${ids.policyAcknowledgment}', '${ids.policySourceRequirement}',
        '${ids.user}', 'internal'
      );
    `);
    await db.query("select learning.sync_shared_completions()");
    await db.exec(`
      insert into learning.certifications(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_ids
      ) values (
        '${ids.policyCertification}', '${ids.policyTargetAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        array['${ids.policyRequirementVersion}'::uuid]
      );
    `);
    const result = await db.query(
      "select evidence_references from learning.certifications where id = $1",
      [ids.policyCertification],
    );
    assert.deepEqual(result.rows[0].evidence_references, [
      {
        acknowledgment_ids: [ids.policyAcknowledgment],
        assignment_requirement_id: ids.policyTargetRequirement,
        attempt_ids: [],
        requirement_version_id: ids.policyRequirementVersion,
        source_assignment_requirement_id: ids.policySourceRequirement,
        status: "passed",
      },
    ]);
  } finally {
    await db.close();
  }
});

test("preserves the original assessment evidence across chained reuse", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.query("select learning.sync_shared_completions()");
    await db.exec(`
      update learning.assignments
      set status = 'cancelled'
      where id = '${ids.sourceAssignment}';
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${ids.chainTargetAssignment}', '${ids.user}', '${ids.department}',
        'internal', '${ids.curriculum}', 'role', 'assigned'
      );
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values (
        '${ids.chainTargetRequirement}', '${ids.chainTargetAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        '${ids.requirementVersion}', 'not_started'
      );
    `);

    const result = await db.query(
      "select learning.sync_shared_completions() as result",
    );
    assert.equal(result.rows[0].result.propagated_count, 1);
    const requirements = await requirementStates(db);
    assert.equal(requirements.get(ids.chainTargetRequirement).status, "passed");
    assert.equal(
      requirements.get(ids.chainTargetRequirement).progress
        .shared_completion_source_id,
      ids.sourceRequirement,
    );

    await db.exec(`
      insert into learning.certifications(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_ids
      ) values (
        '${ids.chainCertification}', '${ids.chainTargetAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        array['${ids.requirementVersion}'::uuid]
      );
    `);
    const certification = await db.query(
      "select evidence_references from learning.certifications where id = $1",
      [ids.chainCertification],
    );
    assert.equal(
      certification.rows[0].evidence_references[0]
        .source_assignment_requirement_id,
      ids.sourceRequirement,
    );
    assert.deepEqual(certification.rows[0].evidence_references[0].attempt_ids, [
      ids.sourceAttempt,
    ]);
  } finally {
    await db.close();
  }
});

test("preserves the original policy evidence across chained reuse", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.exec(`
      insert into learning.requirement_versions(
        id, audience, requirement_kind
      ) values ('${ids.policyRequirementVersion}', 'internal', 'policy');
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values
        ('${ids.policySourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned'),
        ('${ids.policyTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned');
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values
        ('${ids.policySourceRequirement}', '${ids.policySourceAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.policyRequirementVersion}', 'not_started'),
        ('${ids.policyTargetRequirement}', '${ids.policyTargetAssignment}', '${ids.user}', '${ids.department}', 'internal', '${ids.policyRequirementVersion}', 'not_started');
      update learning.assignments
      set status = 'in_progress', started_at = '2026-01-01T00:00:00Z'
      where id = '${ids.policySourceAssignment}';
      update learning.assignment_requirements
      set status = 'in_progress', started_at = '2026-01-01T00:00:00Z'
      where id = '${ids.policySourceRequirement}';
      update learning.assignment_requirements
      set status = 'passed', completed_at = '2026-01-01T00:10:00Z'
      where id = '${ids.policySourceRequirement}';
      insert into learning.policy_acknowledgments(
        id, assignment_requirement_id, user_id, audience
      ) values (
        '${ids.policyAcknowledgment}', '${ids.policySourceRequirement}',
        '${ids.user}', 'internal'
      );
    `);
    await db.query("select learning.sync_shared_completions()");
    await db.exec(`
      update learning.assignments
      set status = 'cancelled'
      where id = '${ids.policySourceAssignment}';
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${ids.policyChainTargetAssignment}', '${ids.user}',
        '${ids.department}', 'internal', '${ids.curriculum}', 'role', 'assigned'
      );
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values (
        '${ids.policyChainTargetRequirement}',
        '${ids.policyChainTargetAssignment}', '${ids.user}',
        '${ids.department}', 'internal', '${ids.policyRequirementVersion}',
        'not_started'
      );
    `);
    await db.query("select learning.sync_shared_completions()");
    const requirements = await requirementStates(db);
    assert.equal(
      requirements.get(ids.policyChainTargetRequirement).progress
        .shared_completion_source_id,
      ids.policySourceRequirement,
    );

    await db.exec(`
      insert into learning.certifications(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_ids
      ) values (
        '${ids.policyChainCertification}',
        '${ids.policyChainTargetAssignment}', '${ids.user}',
        '${ids.department}', 'internal',
        array['${ids.policyRequirementVersion}'::uuid]
      );
    `);
    const certification = await db.query(
      "select evidence_references from learning.certifications where id = $1",
      [ids.policyChainCertification],
    );
    assert.equal(
      certification.rows[0].evidence_references[0]
        .source_assignment_requirement_id,
      ids.policySourceRequirement,
    );
    assert.deepEqual(
      certification.rows[0].evidence_references[0].acknowledgment_ids,
      [ids.policyAcknowledgment],
    );
  } finally {
    await db.close();
  }
});

test("does not override blocked assignments during shared completion", async () => {
  const db = await createCompletionDatabase();
  try {
    await db.exec(`
      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${ids.blockedAssignment}', '${ids.user}', '${ids.department}',
        'internal', '${ids.curriculum}', 'department', 'assigned'
      );
      update learning.assignments
      set status = 'blocked', blocked_reason = 'Manager approval required'
      where id = '${ids.blockedAssignment}';
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, department_id, audience,
        requirement_version_id, status
      ) values (
        '${ids.blockedRequirement}', '${ids.blockedAssignment}',
        '${ids.user}', '${ids.department}', 'internal',
        '${ids.requirementVersion}', 'not_started'
      );
    `);
    await db.query("select learning.sync_shared_completions()");
    const assignment = await db.query(
      "select status, blocked_reason from learning.assignments where id = $1",
      [ids.blockedAssignment],
    );
    assert.deepEqual(assignment.rows[0], {
      status: "blocked",
      blocked_reason: "Manager approval required",
    });
    const requirements = await requirementStates(db);
    assert.equal(
      requirements.get(ids.blockedRequirement).status,
      "not_started",
    );
    await assert.rejects(
      db.query(`select learning.start_requirement(
        pg_catalog.jsonb_build_object(
          'assignment_requirement_id', '${ids.blockedRequirement}',
          'idempotency_key', '${ids.idempotency}'
        )
      )`),
      /not open for progress/i,
    );
    const unchanged = await db.query(
      "select status, blocked_reason from learning.assignments where id = $1",
      [ids.blockedAssignment],
    );
    assert.deepEqual(unchanged.rows[0], {
      status: "blocked",
      blocked_reason: "Manager approval required",
    });
  } finally {
    await db.close();
  }
});
