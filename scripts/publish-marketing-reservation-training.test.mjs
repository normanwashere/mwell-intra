import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { renderMarketingReservationTrainingSql } from "./publish-marketing-reservation-training.mjs";

const options = {
  projectRef: "kkoitlvydytdhlpxhuah",
  ownerEmail: "intra.test.admin@mwell.com.ph",
  reviewerEmail: "intra.test.legal.lead@mwell.com.ph",
};
const owner = "00000000-0000-4000-8000-000000000001";
const reviewer = "00000000-0000-4000-8000-000000000002";
const foundation = readFileSync(new URL("../supabase/migrations/20260812130000_learning_foundation.sql", import.meta.url), "utf8");
const db = new PGlite();
const snapshot = async () => (await db.query(`
  select jsonb_build_object(
    'versions', (select jsonb_agg(to_jsonb(t) order by id) from learning.curriculum_versions t),
    'requirements', (select jsonb_agg(to_jsonb(t) order by id) from learning.requirement_versions t),
    'outcomes', (select jsonb_agg(to_jsonb(t) order by id) from learning.curriculum_capability_outcomes t),
    'roles', (select jsonb_agg(to_jsonb(t) order by id) from learning.role_curricula t)
  ) as snapshot
`)).rows[0].snapshot;

before(async () => {
  await db.exec(`
    create schema core; create schema learning; create schema private;
    create table core.profiles (id uuid primary key, email text, kind text, status text);
    create table core.departments (id uuid primary key);
    create table core.roles (module text, role text, primary key(module,role));
    create table core.capabilities (module text, cap text, primary key(module,cap));
    insert into core.profiles values
      ('${owner}', '${options.ownerEmail}', 'employee', 'active'),
      ('${reviewer}', '${options.reviewerEmail}', 'employee', 'active');
    insert into core.roles values ('warehouse','marketing');
    insert into core.capabilities values ('warehouse','request_stock'), ('warehouse','reserve_allocate');
    ${foundation.slice(foundation.indexOf("create table learning.curricula ("), foundation.indexOf("create table learning.assignments ("))}
    create table private.learning_assessment_answer_keys (
      requirement_version_id uuid primary key references learning.requirement_versions(id),
      answer_key jsonb not null, created_by uuid not null, updated_by uuid not null
    );
    insert into learning.curricula (catalog_key,audience,governance_owner,created_by)
      values ('internal.role.warehouse.marketing.capability-practice.v1.curriculum','internal','platform','${owner}');
    insert into learning.curriculum_versions (
      curriculum_id,audience,version,status,change_reason,materiality,owner_id,reviewer_id,
      approved_at,published_at,effective_at
    ) select id,'internal',1,'published','baseline','material','${owner}','${reviewer}',now(),now(),now()
      from learning.curricula;
    insert into learning.requirements (requirement_key,audience,requirement_kind,governance_owner,created_by)
      values ('internal.marketing_events_lead.orientation.v1','internal','orientation','platform','${owner}'),
      ('internal.role.warehouse.marketing.capability-practice.v1','internal','scenario','platform','${owner}');
    insert into learning.requirement_versions (
      requirement_id,audience,requirement_kind,governance_owner,version,status,title,simulation_id,
      pass_rules,estimated_minutes,change_reason,materiality,owner_id,reviewer_id,
      approved_at,published_at,effective_at
    ) select id,'internal',requirement_kind,'platform',1,'published',requirement_key,
      case when requirement_kind='scenario' then 'event-fulfillment-reconciliation-v1' else requirement_key end,
      case when requirement_kind='scenario' then '{"required_checkpoints":["plan-event-fulfillment","reconcile-event-custody"]}'::jsonb else '{}'::jsonb end,
      8,'baseline','material','${owner}','${reviewer}',now(),now(),now() from learning.requirements;
    insert into learning.curriculum_requirements (curriculum_version_id,requirement_version_id,audience,sort_order,created_by)
      select cv.id,rv.id,'internal',case when rv.requirement_kind='orientation' then 0 else 1 end,'${owner}'
      from learning.curriculum_versions cv cross join learning.requirement_versions rv;
    insert into learning.curriculum_requirement_prerequisites (
      curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by
    ) select cr.id,cr.curriculum_version_id,cr.requirement_version_id,pr.id,'internal','${owner}'
      from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
      cross join learning.requirement_versions pr where rv.requirement_kind='scenario' and pr.requirement_kind='orientation';
    insert into learning.curriculum_capability_outcomes (
      curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by
    ) select cr.id,cr.curriculum_version_id,cr.requirement_version_id,'internal','warehouse','request_stock','${owner}'
      from learning.curriculum_requirements cr join learning.requirement_versions rv on rv.id=cr.requirement_version_id
      where rv.requirement_kind='scenario';
    insert into learning.role_curricula (module,role,curriculum_version_id,audience,effective_at,created_by)
      select 'warehouse','marketing',id,'internal',now(),'${owner}' from learning.curriculum_versions;
  `);
  for (const name of [
    "private.assert_learning_read_committed", "private.lock_learning_curriculum_graph",
    "private.validate_curriculum_graph_publication", "learning.guard_content_lifecycle",
    "learning.guard_curriculum_composition",
  ]) {
    const start = foundation.indexOf(`create or replace function ${name}(`);
    assert.notEqual(start, -1);
    await db.exec(foundation.slice(start, foundation.indexOf("$$;", start) + 3));
  }
  for (const table of ["curriculum_versions", "requirement_versions"]) {
    await db.exec(`create trigger lifecycle before insert or update or delete on learning.${table}
      for each row execute function learning.guard_content_lifecycle()`);
  }
  for (const table of ["curriculum_requirements", "curriculum_requirement_prerequisites", "curriculum_capability_outcomes"]) {
    await db.exec(`create trigger composition before insert or update or delete on learning.${table}
      for each row execute function learning.guard_curriculum_composition()`);
  }
});
after(() => db.close());

test("requires the exact UAT project and distinct explicit reviewers", () => {
  assert.throws(() => renderMarketingReservationTrainingSql({ ...options, projectRef: "anotherproject" }), /UAT/);
  assert.throws(() => renderMarketingReservationTrainingSql({ ...options, reviewerEmail: options.ownerEmail.toUpperCase() }), /Distinct/);
  assert.throws(() => renderMarketingReservationTrainingSql({ ...options, ownerEmail: "" }), /Distinct/);
  assert.throws(() => renderMarketingReservationTrainingSql({ ...options, ownerEmail: "real.employee@mwell.com.ph" }), /synthetic UAT/);
});

test("defaults to a rollback-only publication rehearsal", async () => {
  const before = await snapshot();
  await db.exec(renderMarketingReservationTrainingSql(options));
  assert.deepEqual(await snapshot(), before);
});

test("publishes only a new immutable curriculum and uncompleted assessment", async () => {
  const before = await snapshot();
  await db.exec(renderMarketingReservationTrainingSql({ ...options, commit: true }));
  const after = await snapshot();
  assert.deepEqual(after.versions.find((row) => row.version === 1), before.versions[0]);
  for (const old of before.requirements) assert.deepEqual(after.requirements.find((row) => row.id === old.id), old);
  const version = after.versions.find((row) => row.version === 2);
  assert.equal(version.status, "published");
  assert.equal(version.owner_id, owner);
  assert.equal(version.reviewer_id, reviewer);
  const assessment = after.requirements.find((row) => row.requirement_kind === "assessment");
  assert.equal(assessment.passing_score, 100);
  assert.equal(assessment.max_attempts, 3);
  assert.equal(assessment.waivable, false);
  assert.equal(assessment.simulation_id, null);
  assert.deepEqual(after.outcomes.filter((row) => row.curriculum_version_id === version.id).map((row) => row.capability).sort(), ["request_stock", "reserve_allocate"]);
  assert.equal(after.outcomes.find((row) => row.capability === "reserve_allocate").requirement_version_id, assessment.id);
  assert.deepEqual(after.roles.filter((row) => row.curriculum_version_id === version.id).map((row) => [row.module,row.role]), [["warehouse","marketing"]]);
  const sql = renderMarketingReservationTrainingSql(options);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+(?:learning\.(?:assignments|assignment_requirements|attempts|attempt_events|certifications|emergency_exceptions|policy_acknowledgments)|core\.)/i);
  assert.doesNotMatch(sql, /(?:resolve_assignments|refresh_certifications|sync_equivalent|disable trigger)/i);
});

test("republication is idempotent", async () => {
  const before = await snapshot();
  await db.exec(renderMarketingReservationTrainingSql({ ...options, commit: true }));
  assert.deepEqual(await snapshot(), before);
});

test("published curriculum outcomes remain protected by the real composition guard", async () => {
  await assert.rejects(db.exec(`update learning.curriculum_capability_outcomes set capability='request_stock'
    where capability='reserve_allocate'`), /immutable/);
});

test("refuses actor drift without changing the catalog", async () => {
  const before = await snapshot();
  await db.exec(`update core.profiles set status='inactive' where id='${owner}'`);
  await assert.rejects(db.exec(renderMarketingReservationTrainingSql({ ...options, commit: true })), /query returned no rows/);
  await db.exec("rollback");
  await db.exec(`update core.profiles set status='active' where id='${owner}'`);
  assert.deepEqual(await snapshot(), before);
});
