import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CANDIDATE } from './publish-vendor-evidence-learning.mjs';
import { SCOPED_READINESS_CANDIDATES } from '../modules/learning/src/scopedReadinessCandidates.ts';
import { SCOPED_READINESS_CANDIDATE_RULES } from '../modules/learning/src/scopedReadinessCandidateAuthority.server.ts';
import { CORRECTIONS, RULES_HASH, baselineQuery, renderMappingCorrection, scopedPassRules } from './rehearse-learning-mapping-correction.mjs';
import { renderMappingActivation } from './activate-learning-mapping-correction.mjs';
import { OPS_HASHES, OPS_RULES_HASH, opsAdditions } from './ops-mapping-additions.mjs';

// Local fixture copies of the explicitly allowed custodian IDs, never remote accounts.
const owner = '5f86c147-34aa-4722-be5b-ed085caf97eb';
const reviewer = 'ab803856-0f20-4d1a-abe6-8444052725f2';
// Entirely fictional local inputs. No actual review or UAT calls.
const review = { projectRef: 'kkoitlvydytdhlpxhuah', candidate: CANDIDATE,
  ownerEmail: 'owner@fixture.invalid', reviewerEmail: 'reviewer@fixture.invalid',
  reviewEvidence: 'https://fixture.invalid/simulated-review', reviewedAt: '2026-09-01T00:00:00Z', reviewConfirmed: true };
const foundation = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');

test('renderer refuses unreviewed, unknown-role, unfingerprinted and commit-mode inputs', () => {
  const valid = { ...review, key: 'finance', baselineFingerprint: 'a'.repeat(32) };
  for (const change of [{ key: 'procurement_officer' }, { baselineFingerprint: null }, { reviewConfirmed: false },
    { reviewerEmail: review.ownerEmail }, { commit: true }, { projectRef: 'production' }]) {
    assert.throws(() => renderMappingCorrection({ ...valid, ...change }));
  }
});

for (const [key, correction] of Object.entries(CORRECTIONS)) {
  test(`${key}: actual SQL clones draft v2 graph/content, preserves authority and rolls back`, async () => {
    const db = new PGlite();
    const extraCapabilities = key === 'warehouse_operator' ? ['transfer_stock','reserve_allocate','issue_items'] : [];
    try {
      await db.exec(`create schema core; create schema learning; create schema private;
        create table core.profiles(id uuid primary key,email text,kind text,status text);
        insert into core.profiles values('${owner}','owner@fixture.invalid','employee','active'),('${reviewer}','reviewer@fixture.invalid','employee','active');
        create table core.departments(id uuid primary key);
        create table core.roles(module text,role text,is_active boolean,primary key(module,role));
        insert into core.roles values('core','platform_admin',true),('${correction.module}','${correction.role}',true);
        create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
        insert into core.user_roles values('${owner}','core','platform_admin',now(),null);
        create table core.capabilities(module text,cap text,primary key(module,cap));
        insert into core.capabilities values('${correction.module}','${correction.capability}'),('${correction.module}','existing_authority');
        create table core.role_capabilities(module text,role text,cap text);
        insert into core.role_capabilities values('${correction.module}','${correction.role}','${correction.capability}');
        create function private.assert_learning_read_committed() returns void language sql as $$select$$;
        create function private.lock_learning_curriculum_graph(uuid[]) returns void language sql as $$select$$;`);
      for (const cap of extraCapabilities) {
        await db.query('insert into core.capabilities values($1,$2)', ['warehouse', cap]);
        await db.query('insert into core.role_capabilities values($1,$2,$3)', ['warehouse','warehouse_operator',cap]);
      }
      for (const name of ['curricula', 'curriculum_versions', 'requirements', 'requirement_versions',
        'curriculum_requirements', 'curriculum_requirement_prerequisites', 'curriculum_capability_outcomes', 'role_curricula']) {
        const start = foundation.indexOf(`create table learning.${name} (`);
        assert.ok(start >= 0);
        await db.exec(foundation.slice(start, foundation.indexOf('\n);', start) + 3));
      }
      const root = (await db.query(`insert into learning.curricula(catalog_key,audience,governance_owner,created_by)
        values($1,'internal','platform',$2) returning id`, [correction.curriculum, owner])).rows[0].id;
      const base = (await db.query(`insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,
        source_references,owner_id,reviewer_id,approved_at,published_at,effective_at)
        values($1,'internal',1,'published','local fixture','material','[{"original":"curriculum"}]',$2,$3,now(),now(),now()) returning id`, [root, owner, reviewer])).rows[0].id;
      const members = [];
      for (const [i, reqKey, kind] of [[0, `internal.${key}.orientation`, 'orientation'], [1, correction.requirement, 'scenario']]) {
        const req = (await db.query(`insert into learning.requirements(requirement_key,audience,requirement_kind,governance_owner,created_by)
          values($1,'internal',$2,'platform',$3) returning id`, [reqKey, kind, owner])).rows[0].id;
        const rv = (await db.query(`insert into learning.requirement_versions(requirement_id,audience,requirement_kind,governance_owner,version,status,
          title,simulation_id,estimated_minutes,change_reason,materiality,source_references,pass_rules,owner_id,reviewer_id,approved_at,published_at,effective_at)
          values($1,'internal',$2,'platform',1,'published',$3,'existing-simulation',5,'fixture','material','[{"original":"requirement"}]',
          '{"required_checkpoints":["existing"],"checkpoint_outcomes":{"existing":["correct"]}}',$4,$5,now(),now(),now()) returning id`, [req, kind, reqKey, owner, reviewer])).rows[0].id;
        const cr = (await db.query(`insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
          values($1,$2,'internal',$3,true,$4) returning id`, [base, rv, i, owner])).rows[0].id;
        members.push({ rv, cr });
      }
      await db.query(`insert into learning.curriculum_requirement_prerequisites(curriculum_requirement_id,curriculum_version_id,requirement_version_id,prerequisite_requirement_version_id,audience,created_by)
        values($1,$2,$3,$4,'internal',$5)`, [members[1].cr, base, members[1].rv, members[0].rv, owner]);
      await db.query(`insert into learning.curriculum_capability_outcomes(curriculum_requirement_id,curriculum_version_id,requirement_version_id,audience,module,capability,created_by)
        values($1,$2,$3,'internal',$4,'existing_authority',$5)`, [members[1].cr, base, members[1].rv, correction.module, owner]);
      await db.query(`insert into learning.role_curricula(module,role,curriculum_version_id,audience,effective_at,created_by)
        values($1,$2,$3,'internal',now(),$4)`, [correction.module, correction.role, base, owner]);
      for (const fn of ['private.validate_curriculum_graph_publication(', 'learning.guard_content_lifecycle()', 'learning.guard_curriculum_composition()']) {
        const start = foundation.indexOf(`create or replace function ${fn}`);
        await db.exec(foundation.slice(start, foundation.indexOf('$$;', start) + 3));
      }
      for (const table of ['requirement_versions', 'curriculum_versions']) {
        await db.exec(`create trigger lifecycle before insert or update or delete on learning.${table} for each row execute function learning.guard_content_lifecycle()`);
      }
      for (const table of ['curriculum_requirements', 'curriculum_requirement_prerequisites', 'curriculum_capability_outcomes']) {
        await db.exec(`create trigger composition before insert or update or delete on learning.${table} for each row execute function learning.guard_curriculum_composition()`);
      }
      const fingerprint = (await db.query(baselineQuery(key))).rows[0].fingerprint;
      const sql = renderMappingCorrection({ ...review, key, baselineFingerprint: fingerprint });
      assert.match(sql, /rollback;\s*$/);
      assert.doesNotMatch(sql, /update learning\.|insert into learning\.role_curricula|disable trigger|set_config/i);
      for (let i = 0; i < 2; i++) {
        const results = await db.exec(sql);
        const draft = results.find((r) => r.rows?.[0]?.requirement_version)?.rows[0];
        assert.equal(draft.status, 'draft');
        assert.equal(draft.requirement_version, 1);
        assert.equal(draft.unique_requirement_roots, true);
        assert.equal(draft.edges, key === 'warehouse_operator' ? 4 : 2);
        const content = SCOPED_READINESS_CANDIDATES.find((d) => d.id === correction.simulation);
        assert.equal(draft.simulation_id, content.id);
        assert.deepEqual(draft.pass_rules.required_checkpoints, content.checkpointIds);
        assert.deepEqual(draft.pass_rules.checkpoint_outcomes, Object.fromEntries(content.embeddedSteps.map((s) => [s.checkpointId,
          [SCOPED_READINESS_CANDIDATE_RULES[`${content.id}:${s.checkpointId}`].acceptedChoiceId]])));
        assert.deepEqual(draft.source_references[0], { original: 'requirement' });
        assert.equal(draft.source_references[1].content_sha256, correction.contentHash);
        assert.deepEqual(draft.outcomes, ['existing_authority', correction.capability, ...extraCapabilities].map((cap) => [correction.module,cap]).sort((a,b) => a[1].localeCompare(b[1])));
        assert.equal((await db.query(baselineQuery(key))).rows[0].fingerprint, fingerprint);
        assert.equal((await db.query('select count(*)::int as n from learning.curriculum_versions')).rows[0].n, 1);
        assert.equal((await db.query('select count(*)::int as n from learning.requirement_versions')).rows[0].n, 2);
      }
      await db.exec('delete from core.role_capabilities');
      await assert.rejects(db.exec(sql), /absent role authority/);
      await db.exec('rollback');
      await db.query('insert into core.role_capabilities values($1,$2,$3)', [correction.module, correction.role, correction.capability]);
      for (const cap of extraCapabilities) await db.query('insert into core.role_capabilities values($1,$2,$3)', ['warehouse','warehouse_operator',cap]);
      const wrongHash = renderMappingCorrection({ ...review, key, baselineFingerprint: '0'.repeat(32) });
      await assert.rejects(db.exec(wrongHash), /Reviewed baseline drift/);
      await db.exec('rollback');
      const dir = mkdtempSync(join(tmpdir(), 'local-governance-review-'));
      try {
        const artifact = { reviewMode: 'automated', verdict: 'approved', authorAgentId: 'local-fixture-author',
          reviewerAgentId: 'local-fixture-reviewer', contentSha256: correction.contentHash, rulesSha256: RULES_HASH,
          opsContentHashes: OPS_HASHES, opsRulesSha256: OPS_RULES_HASH,
          baselineFingerprint: fingerprint, candidate: 'a'.repeat(40), projectRef: review.projectRef, key,
          reviewedAt: review.reviewedAt, userAuthorizationReference: 'LOCAL SIMULATION ONLY, no real user review',
          publicationPolicy: 'publish_inactive_no_role_mapping', runtimeCandidate: 'a'.repeat(40) };
        const bytes = JSON.stringify(artifact);
        const path = join(dir, 'simulated-review.json');
        writeFileSync(path, bytes);
        const auto = { key, baselineFingerprint: fingerprint, projectRef: review.projectRef, candidate: artifact.candidate,
          ownerEmail: 'intra.test.admin@mwell.com.ph', reviewerEmail: 'intra.test.legal.lead@mwell.com.ph',
          reviewMode: 'automated', authorAgentId: artifact.authorAgentId, reviewerAgentId: artifact.reviewerAgentId,
          reviewedAt: review.reviewedAt,
          reviewArtifactPath: path, reviewArtifactSha256: createHash('sha256').update(bytes).digest('hex'),
          reviewedContentSha256: correction.contentHash, userAuthorizationReference: artifact.userAuthorizationReference };
        assert.throws(() => renderMappingCorrection({ ...auto, reviewerAgentId: auto.authorAgentId }));
        assert.throws(() => renderMappingCorrection({ ...auto, reviewArtifactSha256: '0'.repeat(64) }), /hash mismatch/);
        assert.throws(() => renderMappingCorrection({ ...auto, reviewedContentSha256: '0'.repeat(64) }));
        assert.throws(() => renderMappingCorrection({ ...auto, candidate: 'b'.repeat(40) }), /exact content and baseline/);
        assert.throws(() => renderMappingCorrection({ ...auto, candidate: '5aaf7eb' }));
        await db.query('update core.profiles set email=$1 where id=$2', [auto.ownerEmail, owner]);
        await db.query('update core.profiles set email=$1 where id=$2', [auto.reviewerEmail, reviewer]);
        const autoResults = await db.exec(renderMappingCorrection(auto));
        const row = autoResults.find((r) => r.rows?.[0]?.requirement_version)?.rows[0];
        assert.equal(row.source_references[1].review_mode, 'automated');
        assert.equal(row.source_references[1].human_review_claimed, false);
        assert.equal(row.source_references[1].runtime_status, 'draft_runtime_registration_not_asserted');
        assert.equal(row.source_references[1].registered_runtime_candidate, null);
        assert.equal(row.source_references[1].reviewer_agent_id, artifact.reviewerAgentId);
        assert.equal((await db.query(baselineQuery(key))).rows[0].fingerprint, fingerprint);
        const publication = renderMappingCorrection({ ...auto, mode: 'publish-rehearsal' });
        const publishedResults = await db.exec(publication);
        const publishedRow = publishedResults.find((r) => r.rows?.[0]?.requirement_version)?.rows[0];
        assert.equal(publishedRow.status, 'published');
        assert.equal(publishedRow.source_references[1].runtime_status, 'registered_in_exact_reviewed_candidate');
        assert.equal(publishedRow.source_references[1].registered_runtime_candidate, auto.candidate);
        assert.equal(publishedRow.source_references[1].publication_state, 'reviewed_publication_inactive_no_role_mapping');
        assert.doesNotMatch(publication, /not approved|independent review required|unregistered_requires/);
        assert.equal((await db.query(baselineQuery(key))).rows[0].fingerprint, fingerprint);
        assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n, 1);
        assert.throws(() => renderMappingCorrection({ ...auto, mode: 'apply' }), /Execution approval artifact required/);
        const execution = { executionApproved: true, candidate: auto.candidate, key, baselineFingerprint: fingerprint,
          reviewerAgentId: auto.reviewerAgentId, rehearsalSqlSha256: createHash('sha256').update(publication).digest('hex') };
        const executionBytes = JSON.stringify(execution);
        const executionPath = join(dir, 'local-execution-simulation.json');
        writeFileSync(executionPath, executionBytes);
        const applySql = renderMappingCorrection({ ...auto, mode: 'apply', executionApprovalPath: executionPath,
          executionApprovalSha256: createHash('sha256').update(executionBytes).digest('hex') });
        assert.match(applySql, /commit;\s*$/);
        await db.exec(applySql);
        assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n, 1);
        assert.doesNotMatch(applySql, /insert into learning\.role_curricula/i);
        assert.equal((await db.query(baselineQuery(key))).rows[0].fingerprint, fingerprint);
        const publishedFingerprint = (await db.query(baselineQuery(key, 2))).rows[0].fingerprint;
        const digest = (s) => createHash('sha256').update(s).digest('hex');
        const healthPath = join(dir, 'simulated-public-health.json');
        const health = { surface: 'protected_preview', healthy: true, projectRef: auto.projectRef, commit: auto.candidate, observedAt: review.reviewedAt };
        writeFileSync(healthPath, JSON.stringify(health));
        const activationPath = join(dir, 'simulated-activation-review.json');
        const activation = { verdict: 'approved', reviewMode: 'automated', key, candidate: auto.candidate, projectRef: auto.projectRef,
          publishedFingerprint, baselineFingerprint: fingerprint, reviewerAgentId: auto.reviewerAgentId,
          publicHealthSha256: digest(JSON.stringify(health)), activationPolicy: 'add_current_version_preserve_prior' };
        writeFileSync(activationPath, JSON.stringify(activation));
        const activationInput = { ...auto, publishedFingerprint, publicHealthPath: healthPath,
          publicHealthSha256: activation.publicHealthSha256, activationReviewPath: activationPath,
          activationReviewSha256: digest(JSON.stringify(activation)) };
        assert.throws(() => renderMappingActivation(activationInput), /public-alias/);
        health.surface = 'public_alias';
        health.commit = 'b'.repeat(40);
        writeFileSync(healthPath, JSON.stringify(health));
        assert.throws(() => renderMappingActivation({ ...activationInput, publicHealthSha256: digest(JSON.stringify(health)) }), /public-alias/);
        health.commit = auto.candidate;
        writeFileSync(healthPath, JSON.stringify(health));
        activation.publicHealthSha256 = digest(JSON.stringify(health));
        writeFileSync(activationPath, JSON.stringify(activation));
        const finalActivation = { ...activationInput, publicHealthSha256: activation.publicHealthSha256,
          activationReviewSha256: digest(JSON.stringify(activation)) };
        const activationSql = renderMappingActivation(finalActivation);
        await db.exec(activationSql);
        assert.equal((await db.query('select count(*)::int as n from learning.role_curricula')).rows[0].n, 1);
        assert.equal((await db.query(baselineQuery(key, 2))).rows[0].fingerprint, publishedFingerprint);
        assert.throws(() => renderMappingActivation({ ...finalActivation, mode: 'apply' }), /evidence hash/i);
        await db.query(`insert into learning.curriculum_versions(curriculum_id,audience,version,status,change_reason,materiality,owner_id)
          values($1,'internal',3,'draft','newer local draft','material',$2)`, [root, owner]);
        assert.equal((await db.query(baselineQuery(key))).rows[0].fingerprint, fingerprint);
        assert.equal((await db.query(baselineQuery(key, 2))).rows[0].fingerprint, publishedFingerprint);
        await assert.rejects(db.exec(activationSql), /Newer curriculum exists/);
        await db.exec('rollback');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    } finally { await db.close(); }
  });
}

test('all twelve API choice IDs pass actual SQL checkpoint enforcement; wrong choices fail', async () => {
  const route = readFileSync(new URL('../apps/shell/app/api/learning/simulation-choice/route.ts', import.meta.url), 'utf8');
  assert.match(route, /outcome_id:\s*command\.choiceId/);
  const source = readFileSync(new URL('../supabase/migrations/20260812160000_learning_services.sql', import.meta.url), 'utf8');
  const start = source.indexOf("  v_required_checkpoints := v_requirement_version.pass_rules->'required_checkpoints';");
  const end = source.indexOf('  select not exists (', start);
  assert.ok(start >= 0 && end > start);
  const db = new PGlite();
  try {
    await db.exec(`create type fixture_requirement as (pass_rules jsonb);
      create function enforce_checkpoint(rules jsonb,v_checkpoint_id text,v_outcome_id text) returns void language plpgsql as $$
      declare v_required_checkpoints jsonb; v_requirement_version fixture_requirement;
      begin v_requirement_version.pass_rules := rules;
      ${source.slice(start, end)}
      end; $$;`);
    let accepted = 0;
    const candidates = [...SCOPED_READINESS_CANDIDATES.map((content) => ({ content, rules: scopedPassRules(content) })), ...opsAdditions()];
    for (const { content, rules } of candidates) {
      for (const step of content.embeddedSteps) {
        const correct = rules.checkpoint_outcomes[step.checkpointId][0];
        await db.query('select enforce_checkpoint($1,$2,$3)', [rules, step.checkpointId, correct]);
        accepted++;
        for (const wrong of [step.outcomeId, ...step.choices.filter((c) => c.id !== correct).map((c) => c.id)].filter((id) => id !== correct)) {
          await assert.rejects(db.query('select enforce_checkpoint($1,$2,$3)', [rules, step.checkpointId, wrong]), /Checkpoint outcome is not accepted/);
        }
      }
      await assert.rejects(db.query('select enforce_checkpoint($1,$2,$3)', [rules, 'foreign-checkpoint', 'anything']), /Checkpoint is not part/);
    }
    assert.equal(accepted, 12);
  } finally { await db.close(); }
});
