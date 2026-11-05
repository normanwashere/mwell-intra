import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { prepareLearningPostgres, validateLegacyPrerequisites } from './prepare-learning-postgres.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('unknown bootstrap authority, grants and data fail closed while CRLF remains equivalent', () => {
  const fixture = readFileSync(new URL('./fixtures/learning-legacy-prerequisites.sql', import.meta.url), 'utf8');
  validateLegacyPrerequisites(fixture);
  validateLegacyPrerequisites(fixture.replace(/\r?\n/g, '\r\n'));
  for (const mutation of [
    fixture.replace('where id = auth.uid()', 'where true'),
    fixture.replace('select role from public.profiles where id = auth.uid()', "select 'admin'::public.app_role"),
    fixture + '\ngrant service_role to authenticated;',
    fixture + '\ncreate schema learning;',
    fixture + "\ninsert into public.profiles(id,full_name,role) values(gen_random_uuid(),'Injected','admin');",
  ]) assert.throws(() => validateLegacyPrerequisites(mutation), /unreviewed legacy/i);
});

test('disposable replay retains every repository migration byte-for-byte and excludes linked credentials', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'qa4-learning-postgres-'));
  try {
    const destination = path.join(temporaryRoot, 'database');
    const result = prepareLearningPostgres({ root, temporaryRoot, destination });
    const names = readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
    assert.equal(result.migrationCount, names.length);
    assert.deepEqual(readdirSync(path.join(destination, 'supabase')).sort(), ['config.toml', 'migrations']);
    assert.deepEqual(readdirSync(path.join(destination, 'supabase/migrations')).sort(), [result.fixtureName, ...names]);
    for (const name of names) assert.deepEqual(readFileSync(path.join(destination, 'supabase/migrations', name)),
      readFileSync(path.join(root, 'supabase/migrations', name)), name);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination }), /already exists/);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination: root }), /outside.*temporary/i);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination: temporaryRoot }), /outside.*temporary/i);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test('real legacy helper is caller-bound, null without a profile, and compatible with the historical grant', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth to authenticated;`);
    const fixture = readFileSync(new URL('./fixtures/learning-legacy-prerequisites.sql', import.meta.url), 'utf8');
    await db.exec(fixture);
    assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 0);
    await db.exec(readFileSync(new URL('../../supabase/migrations/20260708141000_grant_current_app_role_for_legacy_policies.sql', import.meta.url), 'utf8'));
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    await db.query('insert into auth.users values ($1),($2)', [A, B]);
    await db.query("insert into public.profiles(id,full_name,role) values($1,'Synthetic A','warehouse'),($2,'Synthetic B','admin')", [A, B]);
    for (const [uid, expected] of [[A, 'warehouse'], [B, 'admin'], ['', null], ['33333333-3333-4333-8333-333333333333', null]]) {
      await db.query("select set_config('test.uid',$1,false)", [uid]);
      await db.exec('set role authenticated');
      try {
        assert.equal((await db.query('select private.current_app_role() as role')).rows[0].role, expected);
        await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
      } finally { await db.exec('reset role'); }
    }
    assert.deepEqual((await db.query("select has_function_privilege('anon','private.current_app_role()','execute') as anon,has_function_privilege('authenticated','private.current_app_role()','execute') as authenticated")).rows[0], { anon: false, authenticated: true });
    assert.equal((await db.query("select count(*)::int as n from pg_namespace where nspname in ('learning','core')")).rows[0].n, 0);
  } finally { await db.close(); }
});
