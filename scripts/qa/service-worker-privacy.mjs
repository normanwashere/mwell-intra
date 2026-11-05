import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repo, 'apps/shell/package.json'));
const { chromium } = require('@playwright/test');
const { build } = require('esbuild');

test('current worker isolates private data, purges legacy caches, preserves public assets and queued work', { timeout: 60000 }, async () => {
  const bundle = await build({
    entryPoints: [path.join(repo, 'apps/shell/app/sw.ts')], bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"', 'self.__SW_MANIFEST': JSON.stringify([{ url: '/~offline', revision: 'test' }, { url: '/api/admin/audit', revision: 'must-not-precache' }]) },
  });
  let actor = 'actor-A';
  let apiReads = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/sw.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(bundle.outputFiles[0].text); return; }
    if (req.url.startsWith('/api/') || req.url.startsWith('/rest/') || req.url.startsWith('/storage/')) {
      apiReads++;
      res.writeHead(actor ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
      res.end(JSON.stringify(actor ? { marker: actor } : { error: 'Authentication required' })); return;
    }
    if (req.url.startsWith('/_next/static/')) { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' }); res.end('PUBLIC_ASSET'); return; }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': req.url.startsWith('/~offline') ? 'public' : 'private, no-store' });
    res.end(req.url.startsWith('/~offline') ? '<h1>Offline public fallback</h1>' : '<h1>Local private-cache acceptance</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const evidence = { kind: 'synthetic local browser acceptance', source: 'apps/shell/app/sw.ts', checks: [] };
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const legacy = await caches.open('apis');
      await legacy.put('/api/admin/audit', new Response('OLD_PRIVATE', { headers: { 'cache-control': 'private, no-store' } }));
      await legacy.put('/warehouse', new Response('OLD_PRIVATE_PAGE'));
      await legacy.put('https://db.supabase.co/storage/v1/object/sign/private?token=old', new Response('OLD_PRIVATE_FILE'));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('qa-actor-outbox', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('commands');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => { const db = req.result; const tx = db.transaction('commands', 'readwrite'); tx.objectStore('commands').put({ actorId: 'actor-A', intent: 'must-survive' }, 'draft'); tx.oncomplete = () => { db.close(); resolve(); }; };
      });
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForFunction(async () => !(await caches.match('/api/admin/audit')) && !(await caches.match('/warehouse')) && !(await caches.match('https://db.supabase.co/storage/v1/object/sign/private?token=old')));
    assert.equal(apiReads, 0, 'private entries must be filtered out of precache');
    evidence.checks.push('Legacy API/page/signed-file caches purged; private precache entry ignored');
    const read = url => page.evaluate(async url => {
      try { const response = await fetch(url, { cache: 'no-store' }); return { status: response.status, body: await response.text() }; }
      catch { return { status: 0 }; }
    }, url);
    for (const url of ['/api/admin/audit', '/rest/v1/items', '/storage/v1/object/sign/private?token=synthetic']) {
      assert.equal(JSON.parse((await read(url)).body).marker, 'actor-A');
      assert.equal(await page.evaluate(async url => Boolean(await caches.match(url)), url), false);
    }
    evidence.checks.push('Authenticated API, REST and signed-file responses never enter CacheStorage');
    assert.equal((await read('/_next/static/test.js')).body, 'PUBLIC_ASSET');
    await page.waitForFunction(async () => Boolean(await caches.match('/_next/static/test.js')));
    actor = '';
    await context.clearCookies();
    assert.equal((await read('/api/admin/audit')).status, 401);
    actor = 'actor-B';
    assert.equal(JSON.parse((await read('/api/admin/audit')).body).marker, 'actor-B');
    await context.setOffline(true);
    assert.equal((await read('/api/admin/audit')).status, 0);
    assert.equal((await read('/rest/v1/items')).status, 0);
    assert.equal((await read('/storage/v1/object/sign/private?token=synthetic')).status, 0);
    assert.equal((await read('/_next/static/test.js')).body, 'PUBLIC_ASSET');
    evidence.checks.push('Logged-out and second actor cannot recover private data offline; public JS remains available');
    const queued = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('qa-actor-outbox', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const read = db.transaction('commands').objectStore('commands').get('draft'); read.onsuccess = () => { db.close(); resolve(read.result); }; };
    }));
    assert.deepEqual(queued, { actorId: 'actor-A', intent: 'must-survive' });
    await page.goto(`http://127.0.0.1:${server.address().port}/warehouse`);
    assert.match(await page.locator('body').innerText(), /Offline public fallback/);
    evidence.checks.push('Actor-scoped IndexedDB queue survives; offline navigation returns public fallback, not old private page');
    if (process.env.QA_OUTPUT_DIR) {
      await fs.mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.QA_OUTPUT_DIR, 'private-cache-acceptance.json'), JSON.stringify({ ...evidence, passed: true }, null, 2));
    }
    console.log(JSON.stringify(evidence));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
