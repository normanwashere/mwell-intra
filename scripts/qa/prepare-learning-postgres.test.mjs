import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { prepareLearningPostgres, validateLegacyPrerequisites, validateCanonicalManifest, validateReplayInventory } from './prepare-learning-postgres.mjs';

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

test('disposable replay executes canonical baseline plus all classified forward sources byte-for-byte', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'qa4-learning-postgres-'));
  try {
    const destination = path.join(temporaryRoot, 'database');
    const result = prepareLearningPostgres({ root, temporaryRoot, destination });
    const { files, manifest } = validateReplayInventory(root);
    assert.equal(result.baselineCount, 22);
    assert.equal(result.migrationCount, 231);
    assert.equal(result.preservedCount, 35);
    assert.equal(manifest.sources.length, 266);
    assert.deepEqual(readdirSync(path.join(destination, 'supabase')).sort(), ['config.toml', 'migrations']);
    assert.deepEqual(readdirSync(path.join(destination, 'supabase/migrations')).sort(), files.filter(file => file.output).map(file => file.output));
    for (const file of files.filter(file => file.output)) assert.deepEqual(
      readFileSync(path.join(destination, 'supabase/migrations', file.output)), file.bytes, file.file);
    const audit = JSON.parse(readFileSync(path.join(destination, 'replay-audit.json')));
    assert.match(audit.scope, /not exact applied-history replay/);
    assert.equal(audit.files.length, 288);
    assert.equal(audit.files.filter(file => !file.output && file.reason && file.sha256).length, 35);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination }), /already exists/);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination: root }), /outside.*temporary/i);
    assert.throws(() => prepareLearningPostgres({ root, temporaryRoot, destination: temporaryRoot }), /outside.*temporary/i);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test('manifest edits cannot silently omit, substitute, reorder or weaken migration authority', () => {
  const raw = readFileSync(path.join(root, 'scripts/qa/canonical-replay-manifest.json'), 'utf8');
  validateCanonicalManifest(raw.replace(/\r?\n/g, '\r\n'));
  for (const mutate of [
    m => m.sources.pop(),
    m => { m.sources.find(file => file.action === 'execute-forward').action = 'preserve-history'; },
    m => { m.baseline[0].sha256 = '0'.repeat(64); },
    m => m.baseline.reverse(),
    m => { m.baseline[0].file = '../outside.sql'; },
  ]) {
    const manifest = JSON.parse(raw);
    mutate(manifest);
    assert.throws(() => validateCanonicalManifest(JSON.stringify(manifest)), /unreviewed canonical/i);
  }
});

test('missing, changed and unknown SQL fails before any output workspace is created', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'qa4-canonical-input-'));
  try {
    const copy = path.join(temporaryRoot, 'source');
    mkdirSync(copy);
    for (const filename of ['supabase/migrations', 'supabase/config.toml', 'scripts/qa/canonical-replay-manifest.json', 'scripts/qa/fixtures/canonical-uat-baseline']) {
      cpSync(path.join(root, filename), path.join(copy, filename), { recursive: true });
    }
    const destination = path.join(temporaryRoot, 'database');
    const { files } = validateReplayInventory(copy);
    const baseline = files.find(file => file.kind === 'baseline');
    const source = files.find(file => file.kind === 'sources' && file.output);
    const excluded = files.find(file => !file.output);
    for (const file of [baseline, source, excluded]) {
      const filename = path.join(copy, file.kind === 'baseline' ? 'scripts/qa/fixtures/canonical-uat-baseline' : 'supabase/migrations', file.file);
      writeFileSync(filename, Buffer.concat([file.bytes, Buffer.from('\n-- changed\n')]));
      assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /changed.*migration/i);
      assert.equal(existsSync(destination), false);
      writeFileSync(filename, file.bytes);
      rmSync(filename);
      assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /missing or unclassified/i);
      assert.equal(existsSync(destination), false);
      writeFileSync(filename, file.bytes);
    }
    writeFileSync(path.join(copy, 'supabase/migrations/20990101000000_unclassified.sql'), 'select 1;');
    assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /missing or unclassified/i);
    assert.equal(existsSync(destination), false);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test('linked input directories and non-file SQL entries fail before output creation', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'qa3-canonical-links-'));
  try {
    const copy = path.join(temporaryRoot, 'source');
    mkdirSync(copy);
    for (const filename of ['supabase/migrations', 'supabase/config.toml', 'scripts/qa/canonical-replay-manifest.json', 'scripts/qa/fixtures/canonical-uat-baseline']) {
      cpSync(path.join(root, filename), path.join(copy, filename), { recursive: true });
    }
    const destination = path.join(temporaryRoot, 'database');
    for (const directory of ['supabase/migrations', 'scripts/qa/fixtures', 'scripts/qa']) {
      const original = path.join(copy, directory);
      const moved = path.join(temporaryRoot, 'linked-input');
      renameSync(original, moved);
      symlinkSync(moved, original, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /symlink input/i);
      assert.equal(existsSync(destination), false);
      unlinkSync(original);
      renameSync(moved, original);
    }
    const source = validateReplayInventory(copy).files.find(file => file.kind === 'sources' && file.output);
    const filename = path.join(copy, 'supabase/migrations', source.file);
    unlinkSync(filename);
    mkdirSync(filename);
    assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /regular file/i);
    assert.equal(existsSync(destination), false);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test('unsafe local configuration and existing destinations cannot write or overwrite a workspace', () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'qa3-canonical-destination-'));
  try {
    const copy = path.join(temporaryRoot, 'source');
    mkdirSync(copy);
    for (const filename of ['supabase/migrations', 'supabase/config.toml', 'scripts/qa/canonical-replay-manifest.json', 'scripts/qa/fixtures/canonical-uat-baseline']) {
      cpSync(path.join(root, filename), path.join(copy, filename), { recursive: true });
    }
    const configPath = path.join(copy, 'supabase/config.toml');
    const config = readFileSync(configPath, 'utf8');
    const destination = path.join(temporaryRoot, 'database');
    for (const mutation of [
      config.replace('mwell-intra-learning-ci', 'unowned-project'),
      config + '\nsecret = "env(TEST_ONLY_KEY)"\n',
      config + '\nproject_ref = "test-only-remote"\n',
      config + '\npassword = "synthetic-only"\n',
    ]) {
      writeFileSync(configPath, mutation);
      assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /credential-free local CI configuration/i);
      assert.equal(existsSync(destination), false);
    }
    writeFileSync(configPath, config);
    assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination: path.join(temporaryRoot, 'nested/database') }), /outside.*temporary/i);
    assert.equal(existsSync(path.join(temporaryRoot, 'nested')), false);
    const protectedPath = path.join(temporaryRoot, 'protected');
    mkdirSync(protectedPath);
    const sentinel = path.join(protectedPath, 'sentinel.txt');
    writeFileSync(sentinel, 'preserve-owned-test-sentinel');
    symlinkSync(protectedPath, destination, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /already exists/i);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-owned-test-sentinel');
    assert.deepEqual(readdirSync(protectedPath), ['sentinel.txt']);
    unlinkSync(destination);
    writeFileSync(destination, 'preserve-existing-file');
    assert.throws(() => prepareLearningPostgres({ root: copy, temporaryRoot, destination }), /already exists/i);
    assert.equal(readFileSync(destination, 'utf8'), 'preserve-existing-file');
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
