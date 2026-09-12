import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createReceivingAuditEvidence } from './receiving-audit-evidence.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const marker = 'QA-20260912-000000AE-desktop-1440';
const folder = `audit/${marker}/receiving`;

const runner = readFileSync(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');

test('receiving fixtures never persist fabricated audit image or PDF paths', () => {
  const receiving = runner.slice(runner.indexOf('async function task3OperatorReceiptTransactions'),
    runner.indexOf('async function task3UploadPaymentEvidence'));
  assert.equal(/`audit\/\$\{fixture\.marker\}\/[^`]+\.(jpg|png|pdf)`/.test(receiving), false);
  assert.match(receiving, /await fixture\.receivingEvidence\.seed\(/);
});

test('receiving evidence lifecycle is registered before use and cleanup gates fixture deletion', () => {
  assert.ok(runner.includes('receivingEvidence: createReceivingAuditEvidence(client, marker)'));
  const cleanup = runner.slice(runner.indexOf('async function cleanupTask3ReceiptFixture'),
    runner.indexOf('async function cleanupGovernedWorkflowActivity'));
  assert.ok(cleanup.indexOf('await fixture.receivingEvidence.cleanup()') >= 0);
  assert.ok(cleanup.indexOf('await fixture.receivingEvidence.cleanup()') < cleanup.indexOf('await remove('));
});

test('actual fixture cleanup propagates storage failure before deleting receiving rows', async () => {
  const ast = ts.createSourceFile('runner.mjs', runner, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const definition = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'cleanupTask3ReceiptFixture');
  assert.ok(definition);
  const cleanup = new Function(`${definition.getText(ast)}; return cleanupTask3ReceiptFixture;`)();
  let restored = false;
  const failure = new Error('Receiving evidence storage cleanup failed');
  const group = {
    update() { restored = true; return this; },
    eq() { return this; },
  };
  const client = { schema(name) {
    assert.equal(name, 'core', 'Receiving discovery/deletion must not start after a storage failure');
    return { from(table) { assert.equal(table, 'approval_groups'); return group; } };
  } };
  await assert.rejects(cleanup({ client, marker, ids: {}, poIds: [], approvalGroupOriginalRoles: [],
    receivingEvidence: { async cleanup() { throw failure; } } }), error => error === failure);
  assert.ok(restored, 'Restore shared group configuration even if storage cleanup fails');
});

test('both receipt race probes prepare evidence before launching competing RPCs', () => {
  const receiving = runner.slice(runner.indexOf('async function task3OperatorReceiptTransactions'),
    runner.indexOf('async function task3RequestExcessAmendment'));
  const concurrent = receiving.indexOf('const concurrent = await Promise.all(');
  for (const name of ['concurrent-a.png', 'concurrent-b.png']) {
    const prepared = receiving.indexOf(`await fixture.receivingEvidence.seed("${name}");`);
    assert.ok(prepared >= 0 && prepared < concurrent);
  }
  const collision = receiving.indexOf('const collisionResults = await Promise.all(');
  for (const name of ['a', 'b']) {
    const prepared = receiving.indexOf(`= await collisionPayload("${name}");`);
    assert.ok(prepared >= 0 && prepared < collision);
  }
});

function harness(initial = {}) {
  const objects = new Map(Object.entries(initial));
  const calls = [];
  const api = {
    async upload(path, bytes, options) {
      calls.push({ type: 'upload', path, bytes, options });
      if (objects.has(path)) return { error: { message: 'already exists' } };
      objects.set(path, Buffer.from(bytes));
      return { data: { path }, error: null };
    },
    async download(path) {
      calls.push({ type: 'download', path });
      return objects.has(path)
        ? { data: new Blob([objects.get(path)], { type: 'image/png' }), error: null }
        : { error: { message: 'Object not found' } };
    },
    async list(prefix, options) {
      calls.push({ type: 'list', prefix, ...options });
      assert.deepEqual(options.sortBy, { column: 'name', order: 'asc' });
      const rows = [...objects.keys()].filter(path => path.startsWith(`${prefix}/`))
        .map(path => ({ id: path, name: path.slice(prefix.length + 1) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { data: rows.slice(options.offset, options.offset + options.limit), error: null };
    },
    async remove(paths) {
      calls.push({ type: 'remove', paths });
      paths.forEach(path => objects.delete(path));
      return { data: paths.map(name => ({ name })), error: null };
    },
  };
  const client = { storage: { from(bucket) { assert.equal(bucket, 'evidence'); return api; } } };
  return { client, api, calls, objects, fixture: createReceivingAuditEvidence(client, marker) };
}

test('seeds once, reads exact stored bytes and reuses the verified path for replays and races', async () => {
  const h = harness();
  const paths = await Promise.all([h.fixture.seed('receipt.png'), h.fixture.seed('receipt.png')]);
  assert.deepEqual(paths, [`${folder}/receipt.png`, `${folder}/receipt.png`]);
  assert.equal(await h.fixture.seed('receipt.png'), paths[0]);
  assert.deepEqual(h.calls.map(call => call.type), ['upload', 'download']);
  assert.deepEqual(h.calls[0].options, { contentType: 'image/png', upsert: false });
  assert.equal(h.calls[0].bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await h.fixture.cleanup();
  await assert.rejects(h.fixture.seed('late.png'), /closing/);
});

test('cleanup waits for an in-flight upload before discovering and deleting its object', async () => {
  const h = harness();
  const originalUpload = h.api.upload;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  h.api.upload = async (...args) => { await pending; return originalUpload(...args); };
  const seeded = h.fixture.seed('pending.png');
  const cleaned = h.fixture.cleanup();
  assert.equal(h.calls.length, 0);
  release();
  await seeded;
  assert.equal((await cleaned).remaining, 0);
  assert.deepEqual(h.calls.map(call => call.type), ['upload', 'download', 'list', 'remove', 'list']);
  assert.equal(h.objects.size, 0);
});

for (const failure of ['upload error', 'upload throw after write', 'missing upload', 'wrong path',
  'read error', 'missing read', 'wrong MIME', 'wrong bytes']) {
  test(`seed rejects ${failure}, never caches a fake success, and keeps cleanup possible`, async () => {
    const h = harness();
    const originalUpload = h.api.upload;
    if (failure.startsWith('upload') || failure === 'missing upload' || failure === 'wrong path') {
      h.api.upload = async (...args) => {
        if (failure === 'upload error') return { error: { message: 'denied' } };
        await originalUpload(...args);
        if (failure === 'upload throw after write') throw new Error('response lost');
        return { data: failure === 'wrong path' ? { path: 'foreign/file.png' } : null, error: null };
      };
    } else {
      h.api.download = async () => {
        if (failure === 'read error') return { error: { message: 'HTTP400' } };
        if (failure === 'missing read') return { data: null, error: null };
        return { data: new Blob(['not a PNG'], { type: failure === 'wrong MIME' ? 'text/plain' : 'image/png' }), error: null };
      };
    }
    await assert.rejects(h.fixture.seed('receipt.png'), /failed|mismatch|response lost/);
    await assert.rejects(h.fixture.seed('receipt.png'), /failed|mismatch|response lost/);
    const result = await h.fixture.cleanup();
    assert.deepEqual(result.storagePaths, [`${folder}/receipt.png`]);
    assert.equal(result.remaining, 0);
    assert.equal(h.objects.size, 0);
  });
}

test('cleanup discovers orphan objects, paginates before batched deletion, and preserves adjacent scopes', async () => {
  const foreign = [`${folder}-other/ordinary.png`, `audit/${marker}/other.png`,
    `audit/${marker.replace('desktop-1440', 'mobile-390')}/receiving/receipt.png`];
  const initial = Object.fromEntries([...Array.from({ length: 205 }, (_, i) => `${folder}/orphan-${i}.png`),
    ...foreign].map(path => [path, Buffer.from('fixture')]));
  const h = harness(initial);
  const result = await h.fixture.cleanup();
  assert.equal(result.removed, 205);
  assert.equal(result.remaining, 0);
  assert.deepEqual([...h.objects.keys()], foreign);
  assert.deepEqual(h.calls.filter(call => call.type === 'list').map(call => call.offset), [0, 100, 200, 0]);
  assert.deepEqual(h.calls.filter(call => call.type === 'remove').map(call => call.paths.length), [100, 100, 5]);
  assert.equal((await h.fixture.cleanup()).removed, 0);
});

for (const failure of ['list error', 'missing list', 'remove error', 'remove throw', 'verify error', 'missing verify', 'residue']) {
  test(`cleanup ${failure} rejects instead of certifying zero remaining, and can be retried`, async () => {
    const h = harness({ [`${folder}/orphan.png`]: Buffer.from('fixture') });
    const originalList = h.api.list;
    const originalRemove = h.api.remove;
    let lists = 0;
    h.api.list = async (...args) => {
      lists++;
      if (failure === 'list error' || (failure === 'verify error' && lists > 1)) return { error: { message: 'denied' } };
      if (failure === 'missing list' || (failure === 'missing verify' && lists > 1)) return { data: null, error: null };
      return originalList(...args);
    };
    if (failure === 'remove error') h.api.remove = async () => ({ error: { message: 'denied' } });
    if (failure === 'remove throw') h.api.remove = async () => { throw new Error('network failure'); };
    if (failure === 'residue') h.api.remove = async () => ({ error: null });
    await assert.rejects(h.fixture.cleanup(), /failed|left objects|network failure/);
    h.api.list = originalList;
    h.api.remove = originalRemove;
    assert.equal((await h.fixture.cleanup()).remaining, 0);
    assert.equal(h.objects.size, 0);
  });
}

test('unsafe markers, filenames and discovered entries cause no writes or deletes', async () => {
  for (const value of ['', '../outside', `${marker}/nested`, `${marker}\n`]) {
    assert.throws(() => createReceivingAuditEvidence(null, value), /Invalid receiving evidence marker/);
  }
  const h = harness();
  for (const value of ['../outside.png', 'nested/file.png', '/absolute.png', 'bad\\file.png', 'x.pdf', 'x.png\n']) {
    await assert.rejects(h.fixture.seed(value), /Unsafe/);
  }
  assert.equal(h.calls.length, 0);
  for (const entry of [{ id: null, name: 'nested' }, { id: '1', name: '../outside.png' },
    { id: '1', name: 'nested/file.png' }, { id: '1', name: 'x.png\n' }]) {
    h.api.list = async () => ({ data: [entry], error: null });
    await assert.rejects(h.fixture.cleanup(), /unsafe or nested/);
  }
  assert.equal(h.calls.filter(call => call.type === 'remove').length, 0);
});

test('installed Supabase SDK uploads and reads bytes over loopback HTTP; Chromium decodes only the stored object', async () => {
  const objects = new Map();
  const calls = [];
  let failRemove = false;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://localhost');
    calls.push({ method: req.method, path: url.pathname });
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const objectRoute = '/storage/v1/object/evidence/';
    if (req.method === 'POST' && url.pathname.startsWith(objectRoute)) {
      assert.equal(req.headers['content-type'], 'image/png');
      assert.equal(req.headers['x-upsert'], 'false');
      const key = decodeURIComponent(url.pathname.slice(objectRoute.length));
      if (key.endsWith('/denied.png')) return json(400, { message: 'Upload denied', statusCode: '403' });
      objects.set(key, bytes);
      json(200, { Key: `evidence/${key}`, Id: 'loopback-object' });
    } else if (req.method === 'GET' && url.pathname.startsWith(objectRoute)) {
      const key = decodeURIComponent(url.pathname.slice(objectRoute.length));
      if (!objects.has(key)) return json(400, { message: 'Object not found', statusCode: '404' });
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(objects.get(key));
    } else if (req.method === 'POST' && url.pathname === '/storage/v1/object/list/evidence') {
      const { prefix, offset, limit } = JSON.parse(bytes);
      const rows = [...objects.keys()].filter(key => key.startsWith(`${prefix}/`))
        .map(key => ({ id: key, name: key.slice(prefix.length + 1) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      json(200, rows.slice(offset, offset + limit));
    } else if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/evidence') {
      if (failRemove) return json(400, { message: 'Delete denied', statusCode: '403' });
      const { prefixes } = JSON.parse(bytes);
      prefixes.forEach(key => objects.delete(key));
      json(200, prefixes.map(name => ({ name })));
    } else json(500, { message: `Unexpected local test request: ${req.method} ${url.pathname}` });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = createClient(base, 'loopback-only-key', { auth: { persistSession: false, autoRefreshToken: false } });
    const missing = await client.storage.from('evidence').download(`${folder}/fabricated.jpg`);
    assert.equal(missing.error?.message, 'Object not found', 'Unseeded CI174-style path must really fail');
    const fixture = createReceivingAuditEvidence(client, marker);
    await assert.rejects(fixture.seed('denied.png'), /upload failed.*Upload denied/);
    assert.equal(objects.size, 0);
    const path = await fixture.seed('receipt.png');
    assert.ok(objects.get(path)?.length > 0);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const response = await page.goto(`${base}/storage/v1/object/evidence/${path}`);
    assert.equal(response.status(), 200);
    const size = await page.locator('img').evaluate(async img => {
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, complete: img.complete };
    });
    assert.deepEqual(size, { width: 1, height: 1, complete: true });
    failRemove = true;
    await assert.rejects(fixture.cleanup(), /cleanup failed.*Delete denied/);
    assert.ok(objects.has(path));
    failRemove = false;
    assert.equal((await fixture.cleanup()).remaining, 0);
    assert.equal(objects.size, 0);
    assert.ok((await client.storage.from('evidence').download(path)).error);
    assert.ok(calls.some(call => call.method === 'POST' && call.path === `/storage/v1/object/evidence/${path}`));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
