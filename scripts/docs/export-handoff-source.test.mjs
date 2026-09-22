import test from 'node:test';
import assert from 'node:assert/strict';
import { includeFile, documentationOnly, secretKinds, checksum } from './export-handoff-source.mjs';

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
