import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { includeFile, documentationOnly, secretKinds, checksum, sourceArchive } from './export-handoff-source.mjs';

test('source ZIP preserves committed text and binary bytes even with Windows autocrlf enabled', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mwell-source-archive-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { windowsHide: true });
  const require = createRequire(new URL('../../tools/handoff/package.json', import.meta.url));
  const JSZip = require('jszip');
  try {
    git('init', '--quiet');
    git('config', 'core.autocrlf', 'true');
    writeFileSync(path.join(dir, 'reference.txt'), 'first line\nsecond line\n');
    writeFileSync(path.join(dir, 'binary.dat'), Buffer.from([0, 13, 10, 255, 10]));
    git('add', '--', 'reference.txt', 'binary.dat');
    git('-c', 'user.name=Source export test', '-c', 'user.email=source-test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    const zip = await JSZip.loadAsync(sourceArchive(git, 'HEAD'));
    for (const file of ['reference.txt', 'binary.dat']) {
      assert.deepEqual(await zip.file(file).async('nodebuffer'), git('show', `HEAD:${file}`), file);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('copy includes app source, templates, locked tools and migration history', () => {
  for (const name of ['apps/shell/package.json', '.env.example', 'pnpm-lock.yaml', 'tools/handoff/package-lock.json', 'supabase/migrations/20260101.sql']) assert(includeFile(name), name);
});
test('never copy local credentials, state, caches, scratch or unsafe paths', () => {
  for (const name of ['.env', 'apps/shell/.env.local', '.vercel/project.json', 'supabase/.temp/pooler-url', '.superpowers/a', 'outputs/test.json', 'node_modules/a.js', '.codex-tmp/a', 'qa/storage-state.json', '../escape', 'C:/escape', '/root', 'a\\b']) assert.equal(includeFile(name), false, name);
});
test('newer documentation cannot disguise a runtime or deployment change', () => {
  for (const name of ['docs/handoffs/a.md', 'scripts/docs/export.mjs', 'tools/handoff/package.json']) assert(documentationOnly(name));
  for (const name of ['apps/shell/page.tsx', 'supabase/migrations/a.sql', '.github/workflows/deploy.yml', 'package.json']) assert.equal(documentationOnly(name), false);
});
test('scanner reports categories without returning credential values', () => {
  const sample = Buffer.from('sb_' + 'secret_' + 'x'.repeat(30));
  assert.deepEqual(secretKinds(sample), ['provider_secret']);
  assert.deepEqual(secretKinds(Buffer.from('const password = process.env.PASSWORD;')), []);
  assert.equal(checksum(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('recipient verification succeeds for matching files and rejects altered bytes or unsafe manifest paths', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mwell-source-verifier-'));
  const script = fileURLToPath(new URL('./export-handoff-source.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script, '--verify', dir], { encoding: 'utf8', windowsHide: true });
  try {
    mkdirSync(path.join(dir, 'apps/shell'), { recursive: true });
    writeFileSync(path.join(dir, 'apps/shell/package.json'), '{}');
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    const manifest = { schemaVersion: 1, commit: 'a'.repeat(40), sourceCommit: 'b'.repeat(40), files: {
      'apps/shell/package.json': checksum(Buffer.from('{}')),
      'pnpm-lock.yaml': checksum(Buffer.from('lockfileVersion: 9')),
    } };
    const save = () => writeFileSync(path.join(dir, 'source-manifest.json'), JSON.stringify(manifest));
    save();
    const good = run();
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).filesVerified, 2);
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'tampered');
    assert.notEqual(run().status, 0);
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    manifest.files['../escape'] = 'c'.repeat(64);
    save();
    assert.notEqual(run().status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
