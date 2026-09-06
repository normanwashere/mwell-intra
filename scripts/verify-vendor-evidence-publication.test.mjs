import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const foundation = readFileSync(new URL('../supabase/migrations/20260812130000_learning_foundation.sql', import.meta.url), 'utf8');
const start = foundation.indexOf('create or replace function learning.guard_content_lifecycle()');
assert.ok(start >= 0);
const guard = foundation.slice(start, foundation.indexOf('$$;', start) + 3);

test('actual publication guard forbids retrofitting the evidence simulation or kind onto published attestation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema learning; create schema private;
      create function private.assert_learning_read_committed() returns void language sql as $$ select $$;
      create table learning.requirement_versions(id text primary key,audience text,requirement_kind text,
        status text,simulation_id text,pass_rules jsonb);
      insert into learning.requirement_versions values('published-evidence','vendor','attestation','published',null,'{}');`);
    await db.exec(guard);
    await db.exec(`create trigger content_lifecycle before insert or update or delete on learning.requirement_versions
      for each row execute function learning.guard_content_lifecycle()`);
    const before = (await db.query('select * from learning.requirement_versions')).rows;
    for (const assignment of [
      "simulation_id='vendor-evidence-review-v1'",
      "requirement_kind='scenario'",
      "pass_rules='{}', simulation_id='vendor-evidence-review-v1'",
    ]) await assert.rejects(db.exec(`update learning.requirement_versions set ${assignment}`), /Published learning content is immutable/);
    assert.deepEqual((await db.query('select * from learning.requirement_versions')).rows, before);
    await assert.rejects(db.exec(`insert into learning.requirement_versions values('shortcut','vendor','attestation','published','vendor-evidence-review-v1','{}')`), /must begin as a draft/);
    await db.exec(`insert into learning.requirement_versions values('new-draft','vendor','attestation','draft',null,'{}');
      update learning.requirement_versions set simulation_id='vendor-evidence-review-v1' where id='new-draft'`);
    assert.deepEqual((await db.query("select audience,requirement_kind,status,simulation_id from learning.requirement_versions where id='new-draft'")).rows[0],
      { audience: 'vendor', requirement_kind: 'attestation', status: 'draft', simulation_id: 'vendor-evidence-review-v1' });
  } finally { await db.close(); }
});
