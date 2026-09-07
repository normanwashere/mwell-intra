import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { prepareLearningMappingCorrections } from './prepare-learning-mapping-corrections.mjs';

test('correction proposal stays within existing role authority and requires independent review', () => {
  assert.throws(() => prepareLearningMappingCorrections('production'));
  const plan = prepareLearningMappingCorrections('kkoitlvydytdhlpxhuah');
  assert.equal(plan.executablePublication, false);
  assert.deepEqual(plan.corrections.filter((c) => c.capability === 'review_payment_readiness').map((c) => c.role), ['finance', 'admin']);
  assert.equal(plan.corrections.find((c) => c.role === 'vendor_portal').capability, null);
  assert.ok(plan.corrections.every((c) => c.observedVersion === 1 && c.proposedVersion === 2));
});

test('actual composition trigger rejects adding outcomes to published/approved graphs, allows new draft only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema learning; create schema private;
      create function private.assert_learning_read_committed() returns void language sql as $$select$$;
      create function private.lock_learning_curriculum_graph(uuid[]) returns void language sql as $$select$$;
      create table learning.curriculum_versions(id uuid primary key,audience text,status text);
      create table learning.curriculum_capability_outcomes(curriculum_version_id uuid,audience text,module text,capability text);
      insert into learning.curriculum_versions values('00000000-0000-4000-8000-000000000001','internal','published');`);
    const source = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');
    const start = source.indexOf('create or replace function learning.guard_curriculum_composition()');
    assert.ok(start >= 0);
    await db.exec(source.slice(start, source.indexOf('$$;', start) + 3));
    await db.exec(`create trigger composition before insert or update or delete on learning.curriculum_capability_outcomes
      for each row execute function learning.guard_curriculum_composition()`);
    for (const status of ['published', 'approved', 'scheduled', 'superseded', 'retired']) {
      await db.query('update learning.curriculum_versions set status=$1', [status]);
      await assert.rejects(db.exec(`insert into learning.curriculum_capability_outcomes values
        ('00000000-0000-4000-8000-000000000001','internal','warehouse','inspect_quality')`), /composition is immutable/);
    }
    await db.exec(`insert into learning.curriculum_versions values('00000000-0000-4000-8000-000000000002','internal','draft');
      insert into learning.curriculum_capability_outcomes values('00000000-0000-4000-8000-000000000002','internal','warehouse','inspect_quality');`);
    assert.equal((await db.query('select count(*)::int as n from learning.curriculum_capability_outcomes')).rows[0].n, 1);
  } finally { await db.close(); }
});
