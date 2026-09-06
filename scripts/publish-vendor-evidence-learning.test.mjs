import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CANDIDATE, PASS_RULES, renderVendorEvidenceDryRun } from './publish-vendor-evidence-learning.mjs';

// Local fictional inputs only; never sent to UAT and never represented as human review.
const input = { projectRef: 'kkoitlvydytdhlpxhuah', candidate: CANDIDATE,
  ownerEmail: 'owner@fixture.invalid', reviewerEmail: 'reviewer@fixture.invalid',
  reviewEvidence: 'https://fixture.invalid/review/1', reviewedAt: '2026-09-01T00:00:00Z', reviewConfirmed: true };

test('requires explicit real-review inputs and exact target; refuses enablement modes', () => {
  for (const patch of [{ projectRef: 'production' }, { candidate: 'HEAD' }, { ownerEmail: undefined },
    { reviewerEmail: input.ownerEmail }, { reviewerEmail: 'intra.test.legal.lead@mwell.com.ph' },
    { reviewConfirmed: false }, { reviewEvidence: undefined }, { reviewedAt: 'invalid' }, { commit: true }]) {
    assert.throws(() => renderVendorEvidenceDryRun({ ...input, ...patch }));
  }
});

test('render binds immutable candidate and exact completion rules; never approves or activates', () => {
  const sql = renderVendorEvidenceDryRun(input);
  assert.match(sql, new RegExp(CANDIDATE));
  assert.ok(sql.includes(JSON.stringify(PASS_RULES)));
  assert.match(sql, /rollback;\s*$/);
  assert.doesNotMatch(sql, /\b(commit;|update learning\.|insert into learning\.role_curricula|set_config|disable trigger)\b/i);
  assert.match(sql, /content_reference/);
});

test('actual content lifecycle accepts scoped drafts; rehearsal rolls back and preserves baseline', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema core; create schema learning; create schema private;
      create table core.profiles(id uuid primary key,email text,kind text,status text);
      create table core.roles(module text,role text,is_active boolean);
      create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
      insert into core.profiles values('00000000-0000-4000-8000-000000000001','owner@fixture.invalid','employee','active'),
        ('00000000-0000-4000-8000-000000000002','reviewer@fixture.invalid','employee','active');
      insert into core.roles values('core','platform_admin',true);
      insert into core.user_roles values('00000000-0000-4000-8000-000000000001','core','platform_admin',now(),null);
      create table core.departments(id uuid primary key);
      create function private.assert_learning_read_committed() returns void language sql as $$select$$;`);
    const foundation = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');
    for (const name of ['curricula', 'curriculum_versions', 'requirements', 'requirement_versions', 'curriculum_requirements']) {
      const start = foundation.indexOf(`create table learning.${name} (`);
      await db.exec(foundation.slice(start, foundation.indexOf('\n);', start) + 3));
    }
    await db.exec(`create table learning.curriculum_requirement_prerequisites(curriculum_requirement_id uuid,curriculum_version_id uuid,
      requirement_version_id uuid,prerequisite_requirement_version_id uuid,audience text,created_by uuid);
      create table learning.curriculum_capability_outcomes(curriculum_requirement_id uuid,curriculum_version_id uuid,
      requirement_version_id uuid,audience text,module text,capability text,created_by uuid);
      insert into learning.curricula(id,catalog_key,audience,governance_owner,created_by) values
      ('00000000-0000-4000-8000-000000000003','vendor.role.core.vendor_portal.capability-practice.v1.curriculum','vendor','platform','00000000-0000-4000-8000-000000000001');
      insert into learning.curriculum_versions(id,curriculum_id,audience,version,status,change_reason,materiality,owner_id,reviewer_id,approved_at,published_at,effective_at)
      values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','vendor',1,'published','fixture','material',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',now(),now(),now());`);
    for (const [i, key, kind] of [[0, 'vendor.vendor_representative.orientation.v1', 'orientation'],
      [1, 'vendor.role.core.vendor_portal.capability-practice.v1', 'scenario']]) {
      const root = (await db.query(`insert into learning.requirements(requirement_key,audience,requirement_kind,governance_owner,created_by)
        values($1,'vendor',$2,'platform','00000000-0000-4000-8000-000000000001') returning id`, [key, kind])).rows[0].id;
      const version = (await db.query(`insert into learning.requirement_versions(requirement_id,audience,requirement_kind,governance_owner,
        version,title,simulation_id,estimated_minutes,change_reason,materiality,owner_id)
        values($1,'vendor',$2,'platform',1,$3,'fixture',3,'fixture','material','00000000-0000-4000-8000-000000000001') returning id`, [root, kind, key])).rows[0].id;
      await db.query(`insert into learning.curriculum_requirements(curriculum_version_id,requirement_version_id,audience,sort_order,mandatory,created_by)
        values('00000000-0000-4000-8000-000000000004',$1,'vendor',$2,true,'00000000-0000-4000-8000-000000000001')`, [version, i]);
    }
    const start = foundation.indexOf('create or replace function learning.guard_content_lifecycle()');
    await db.exec(foundation.slice(start, foundation.indexOf('$$;', start) + 3));
    for (const table of ['requirement_versions', 'curriculum_versions']) {
      await db.exec(`create trigger lifecycle before insert or update on learning.${table} for each row execute function learning.guard_content_lifecycle()`);
    }
    const sql = renderVendorEvidenceDryRun(input);
    for (let i = 0; i < 2; i++) {
      const results = await db.exec(sql);
      const draft = results.find((result) => result.rows?.[0]?.requirement_key)?.rows[0];
      assert.equal(draft.status, 'draft');
      assert.deepEqual(draft.pass_rules, PASS_RULES);
      assert.equal(draft.content_reference, null);
      assert.equal((await db.query('select count(*)::int as n from learning.requirements')).rows[0].n, 2);
      assert.equal((await db.query('select count(*)::int as n from learning.curriculum_versions')).rows[0].n, 1);
    }
  } finally { await db.close(); }
});
