import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { MANIFEST } from './sep20-seller-learning-manifest.mjs';
import { renderSellerActivation, MAPPING_ID } from './sep20-seller-learning-activate.mjs';
import {
  fingerprintQuery, manifestSha256, renderSellerLearning, sha256, STAGES,
} from './sep20-seller-learning.mjs';

// Fictional review/execution artifacts for isolated tests, never UAT approval.
function artifacts() {
  const dir = mkdtempSync(join(tmpdir(), 'seller-learning-fixture-'));
  const save = (name, value) => {
    const path = join(dir, name);
    const bytes = JSON.stringify(value);
    writeFileSync(path, bytes);
    return { path, hash: sha256(bytes) };
  };
  const review = {
    schemaVersion: 1, reviewMode: 'automated', humanReviewClaimed: false,
    verdict: 'approved', scope: 'seller_learning_content_and_inactive_publication',
    projectRef: MANIFEST.projectRef, authorAgentId: MANIFEST.authorAgentId,
    reviewerAgentId: MANIFEST.reviewerAgentId, manifestSha256,
    contentSha256: MANIFEST.contentSha256, rulesSha256: MANIFEST.rulesSha256,
    reviewedAt: '2026-09-01T00:00:00Z',
    userAuthorizationReference: MANIFEST.userAuthorizationReference,
    findings: ['FICTIONAL LOCAL TEST ONLY'], activationApproved: false,
  };
  const reviewFile = save('review.json', review);
  const base = {
    operation: 'draft', baselineFingerprint: '0'.repeat(32),
    reviewArtifactPath: reviewFile.path, reviewArtifactSha256: reviewFile.hash,
  };
  const apply = (input, patch = {}, renderer = renderSellerLearning) => {
    const rehearsal = renderer(input);
    const execution = save('execution.json', {
      schemaVersion: 1, executionApproved: true,
      projectRef: MANIFEST.projectRef, manifestSha256,
      operation: input.operation, baselineFingerprint: input.baselineFingerprint,
      rehearsalSqlSha256: sha256(rehearsal), reviewArtifactSha256: input.reviewArtifactSha256 ?? null,
      authorizedByAgentId: '01a0b4fc-57b0-7351-84ee-b8baeb3a422c', authorizedAt: '2026-09-01T00:00:00Z',
      userAuthorizationReference: MANIFEST.userAuthorizationReference,
      roleIsolationVerified: true, roleIsolationEvidence: 'FICTIONAL LOCAL TEST ONLY',
      runtimeEvidence: 'FICTIONAL LOCAL TEST ONLY',
      ...patch,
    });
    return renderer({ ...input, mode: 'apply',
      executionApprovalPath: execution.path, executionApprovalSha256: execution.hash });
  };
  return { base, review, save, apply, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('only explicit single stages; defaults to rollback and never writes access or learner evidence', () => {
  const a = artifacts();
  try {
    for (const operation of STAGES) {
      const sql = renderSellerLearning({ ...a.base, operation });
      assert.match(sql, /rollback;\s*$/);
      assert.doesNotMatch(sql, /\b(insert into|update|delete from) (core\.|auth\.|warehouse\.|learning\.(role_curricula|assignments|attempts|certifications|checkpoint))/i);
      assert.doesNotMatch(sql, /set_config|disable trigger|acceptedChoiceId|rejectedFeedback/);
      assert.match(sql, /human_review_claimed/);
      const statusChanges = [...sql.matchAll(/set status='([^']+)'/g)].map((m) => m[1]);
      assert.deepEqual([...new Set(statusChanges)], operation === 'draft' ? [] :
        [operation === 'submit-review' ? 'in_review' : operation.startsWith('approve-') ? 'approved' : 'published']);
    }
    for (const patch of [{ operation: 'all' }, { mode: 'publish' }, { baselineFingerprint: null },
      { projectRef: 'other' }, { commit: true }, { mode: 'apply' }]) {
      assert.throws(() => renderSellerLearning({ ...a.base, ...patch }));
    }
  } finally { a.close(); }
});

test('approval needs actual independent AI artifact bound to exact manifest; drafts do not assert review', () => {
  const a = artifacts();
  try {
    const draft = renderSellerLearning({ operation: 'draft', baselineFingerprint: '0'.repeat(32) });
    assert.doesNotMatch(draft, /review_artifact_sha256|set status='approved'/);
    for (const patch of [{ verdict: 'rejected' }, { humanReviewClaimed: true },
      { reviewerAgentId: MANIFEST.authorAgentId }, { contentSha256: '0'.repeat(64) },
      { manifestSha256: '0'.repeat(64) }, { rulesSha256: '0'.repeat(64) },
      { activationApproved: true }, { reviewMode: 'human' }]) {
      const file = a.save('bad-review.json', { ...a.review, ...patch });
      assert.throws(() => renderSellerLearning({ ...a.base, operation: 'approve-requirement',
        reviewArtifactPath: file.path, reviewArtifactSha256: file.hash }));
    }
    assert.throws(() => renderSellerLearning({ ...a.base, operation: 'approve-requirement',
      reviewArtifactSha256: 'f'.repeat(64) }), /hash/);
    const sql = a.apply(a.base);
    assert.match(sql, /commit;\s*$/);
    assert.doesNotMatch(sql, /set status='approved'/);
    for (const patch of [{ operation: 'submit-review' }, { baselineFingerprint: 'f'.repeat(32) },
      { rehearsalSqlSha256: 'f'.repeat(64) }, { executionApproved: false },
      { manifestSha256: 'f'.repeat(64) }, { reviewArtifactSha256: null }, { authorizedByAgentId: MANIFEST.authorAgentId }]) {
      assert.throws(() => a.apply(a.base, patch), /Execution approval/);
    }
    for (const patch of [{ roleIsolationVerified: false }, { roleIsolationEvidence: '' }, { runtimeEvidence: '' }]) {
      assert.throws(() => a.apply({ ...a.base, operation: 'publish-requirement' }, patch), /isolation and runtime/);
    }
  } finally { a.close(); }
});

async function fixture() {
  const db = new PGlite();
  const f = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');
  await db.exec(`create schema core; create schema learning; create schema private;
    create table core.profiles(id uuid primary key,email text,kind text,status text);
    create table core.departments(id uuid primary key);
    create table core.roles(module text,role text,is_active boolean,primary key(module,role));
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
    create table core.capabilities(module text,cap text,primary key(module,cap));
    create table core.role_capabilities(module text,role text,cap text);
    insert into core.capabilities values('events','record_event_outcome');
    insert into core.role_capabilities values('events','seller','record_event_outcome'),('events','seller','view_event_custody');
    insert into core.profiles values('${MANIFEST.ownerId}','intra.test.admin@mwell.com.ph','employee','active'),
      ('${MANIFEST.reviewerId}','intra.test.legal.lead@mwell.com.ph','employee','active');
    insert into core.roles values('core','platform_admin',true),('events','seller',true);
    insert into core.user_roles values('${MANIFEST.ownerId}','core','platform_admin',now(),null);`);
  for (const name of ['curricula', 'curriculum_versions', 'requirements', 'requirement_versions',
    'curriculum_requirements', 'curriculum_requirement_prerequisites', 'curriculum_capability_outcomes', 'role_curricula']) {
    const start = f.indexOf(`create table learning.${name} (`);
    await db.exec(f.slice(start, f.indexOf('\n);', start) + 3));
  }
  await db.exec(`insert into learning.requirements(id,requirement_key,audience,requirement_kind,governance_owner,created_by)
    values('00000000-0000-4000-8000-000000000001','internal.general_employee.orientation.v1','internal','orientation','platform','${MANIFEST.ownerId}');
    insert into learning.requirement_versions(id,requirement_id,audience,requirement_kind,governance_owner,version,title,simulation_id,
      estimated_minutes,change_reason,materiality,owner_id,reviewer_id,approved_at,published_at,effective_at,status,pass_rules)
    values('${MANIFEST.orientationVersionId}','00000000-0000-4000-8000-000000000001','internal','orientation','platform',1,'fixture','fixture',3,
      'fixture','material','${MANIFEST.ownerId}','${MANIFEST.reviewerId}',now(),now(),now(),'published','{"required_checkpoints":["complete"]}');`);
  for (const name of ['private.assert_learning_read_committed', 'private.lock_learning_curriculum_graph',
    'private.validate_curriculum_graph_publication', 'learning.guard_content_lifecycle', 'learning.guard_curriculum_composition']) {
    const start = f.indexOf(`create or replace function ${name}(`);
    await db.exec(f.slice(start, f.indexOf('$$;', start) + 3));
  }
  for (const table of ['requirement_versions', 'curriculum_versions']) {
    await db.exec(`create trigger lifecycle before insert or update or delete on learning.${table}
      for each row execute function learning.guard_content_lifecycle()`);
  }
  for (const table of ['curriculum_requirements', 'curriculum_requirement_prerequisites', 'curriculum_capability_outcomes']) {
    await db.exec(`create trigger composition before insert or update or delete on learning.${table}
      for each row execute function learning.guard_curriculum_composition()`);
  }
  // Test fixture cannot reproduce live timestamps; replace only the pinned orientation digest in rendered SQL.
  const orientation = (await db.query(`select md5(jsonb_build_object('root',to_jsonb(r),'version',to_jsonb(rv))::text) as fingerprint
    from learning.requirements r join learning.requirement_versions rv on rv.requirement_id=r.id where rv.id='${MANIFEST.orientationVersionId}'`)).rows[0].fingerprint;
  const exec = (sql) => db.exec(sql.replaceAll(MANIFEST.orientationFingerprint, orientation));
  const fingerprint = async () => (await db.query(fingerprintQuery())).rows[0].fingerprint;
  return { db, exec, fingerprint };
}

test('real lifecycle and graph constraints: rollback, exact staged publication, no activation, replay/drift fail closed', async () => {
  const a = artifacts();
  const { db, exec, fingerprint } = await fixture();
  try {
    const before = await fingerprint();
    const draft = { operation: 'draft', baselineFingerprint: before };
    await exec(renderSellerLearning(draft));
    assert.equal(await fingerprint(), before);
    await exec(a.apply(draft));
    const rows = (await db.query(`select status,reviewer_id,approved_at,effective_at,published_at from learning.requirement_versions where id='${MANIFEST.ids.requirementVersion}'`)).rows;
    assert.deepEqual(rows, [{ status: 'draft', reviewer_id: null, approved_at: null, effective_at: null, published_at: null }]);
    await assert.rejects(exec(a.apply(draft)), /drift|exists/i);
    await db.exec('rollback');
    for (const operation of STAGES.slice(1)) {
      const input = { ...a.base, operation, baselineFingerprint: await fingerprint() };
      if (operation === 'approve-requirement') {
        await assert.rejects(exec(a.apply({ ...input, operation: 'approve-curriculum' })), /stage|published/i);
        await db.exec('rollback');
      }
      await exec(a.apply(input));
    }
    const published = (await db.query(`select status,approved_at<=published_at and published_at<=effective_at as chronology
      from learning.requirement_versions where id='${MANIFEST.ids.requirementVersion}'
      union all select status,approved_at<=published_at and published_at<=effective_at from learning.curriculum_versions where id='${MANIFEST.ids.curriculumVersion}'`)).rows;
    assert.deepEqual(published, [{ status: 'published', chronology: true }, { status: 'published', chronology: true }]);
    assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from core.user_roles')).rows[0].n, 1);
    await assert.rejects(db.exec(`update learning.requirement_versions set max_attempts=99 where id='${MANIFEST.ids.requirementVersion}'`), /immutable/);
    const activation = { ...a.base, operation: 'activate-role-mapping', baselineFingerprint: await fingerprint() };
    const activationSql = () => a.apply(activation, {}, renderSellerActivation);
    await assert.rejects(exec(activationSql()), /readiness helper/i);
    await db.exec('rollback');
    const helper = readFileSync(new URL('../supabase/migrations/20260920030900_event_seller_learning_readiness.sql', import.meta.url), 'utf8');
    await db.exec(helper.slice(0, helper.indexOf('\nrevoke all')));
    await exec(renderSellerActivation(activation));
    assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n, 0);
    await exec(activationSql());
    assert.deepEqual((await db.query('select id,module,role,audience,department_id,curriculum_version_id from learning.role_curricula')).rows,
      [{ id: MAPPING_ID, module: 'events', role: 'seller', audience: 'internal', department_id: null, curriculum_version_id: MANIFEST.ids.curriculumVersion }]);
    assert.equal((await db.query('select private.event_seller_learning_ready() as ready')).rows[0].ready, true);
    await assert.rejects(exec(a.apply({ ...activation, baselineFingerprint: await fingerprint() }, {}, renderSellerActivation)), /already exists/i);
    await db.exec('rollback');
  } finally { await db.close(); a.close(); }
});

test('activation needs its own parent approval and only inserts one mapping, never learner evidence', () => {
  const a = artifacts();
  try {
    const input = { ...a.base, operation: 'activate-role-mapping' };
    const sql = renderSellerActivation(input);
    assert.match(sql, /rollback;\s*$/);
    assert.equal([...sql.matchAll(/insert into /g)].length, 1);
    assert.match(sql, /insert into learning\.role_curricula/);
    assert.doesNotMatch(sql, /\b(update|delete from) |insert into (core|auth|warehouse)\./i);
    for (const patch of [{ authorizedByAgentId: MANIFEST.reviewerAgentId }, { roleIsolationVerified: false },
      { runtimeEvidence: '' }, { operation: 'publish-curriculum' }]) {
      assert.throws(() => a.apply(input, patch, renderSellerActivation));
    }
  } finally { a.close(); }
});

test('fresh fingerprints cannot authorize changed payload, graph, attribution, custodian, or premature activation', async () => {
  const a = artifacts();
  const { db, exec, fingerprint } = await fixture();
  try {
    await exec(a.apply({ operation: 'draft', baselineFingerprint: await fingerprint() }));
    const cases = [
      [`update learning.requirement_versions set max_attempts=9 where id='${MANIFEST.ids.requirementVersion}'`, /manifest\/content drift/],
      [`update learning.requirement_versions set pass_rules='{}' where id='${MANIFEST.ids.requirementVersion}'`, /manifest\/content drift/],
      [`update learning.requirement_versions set reviewer_id='${MANIFEST.reviewerId}' where id='${MANIFEST.ids.requirementVersion}'`, /attribution drift/],
      [`update learning.curriculum_requirements set mandatory=false where id='${MANIFEST.ids.sellerMember}'`, /membership/],
      ['delete from learning.curriculum_requirement_prerequisites', /prerequisite/],
      ['delete from learning.curriculum_capability_outcomes', /outcome/],
      [`update core.profiles set status='inactive' where id='${MANIFEST.ownerId}'`, /custodians/],
      [`update core.user_roles set expires_at=now()`, /authority/],
      [`insert into learning.role_curricula(module,role,curriculum_version_id,audience,effective_at,created_by)
        values('events','seller','${MANIFEST.ids.curriculumVersion}','internal',now(),'${MANIFEST.ownerId}')`, /mapping already exists/],
    ];
    for (const [mutation, expected] of cases) {
      // A failed nested rehearsal is rolled back with the fixture mutation.
      await db.exec('begin isolation level read committed');
      await db.exec(mutation);
      await assert.rejects(exec(a.apply({ operation: 'submit-review', baselineFingerprint: await fingerprint() })), expected);
      await db.exec('rollback');
    }
  } finally { await db.close(); a.close(); }
});
