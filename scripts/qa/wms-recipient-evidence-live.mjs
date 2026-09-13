import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';

// Continue the exact already-released orders from the department journey.
// This is post-fix acknowledgment evidence, not a fresh whole-journey pass.
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 30000 });
const { createClient } = require('@supabase/supabase-js');
assert.equal(process.env.APP_ENV, 'uat');
assert.equal(process.env.AUDIT_MUTATIONS, 'true');
assert(process.env.AUDIT_PASSWORD);
const root = path.resolve(process.argv[2]);
const m = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(m.project, 'kkoitlvydytdhlpxhuah');
assert.equal(m.origin, 'https://mwell-intra-uat.vercel.app');
const output = path.join(root, `ack-retest-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output);
const report = { runId: m.runId, startedAt: new Date().toISOString(), complete: false,
  scope: 'Actual recipient evidence upload and acknowledgment on previously released synthetic department orders. Not a fresh full-journey, real delivery or human pilot.',
  checks: [], failures: [], storageObjects: [] };
const persist = () => writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
await persist();
const health = async () => {
  const r = await fetch(m.origin + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(r.ok);
  const body = await r.json();
  assert.equal(body.deployment.appEnv, 'uat');
  assert.equal(body.deployment.supabaseProjectRef, m.project);
  assert.equal(body.commit, m.commit);
  return body;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const actors = {};
let browser;
try {
  report.health = await health();
  for (const role of ['marketing_events_lead', 'general_employee', 'operations_lead']) {
    const persona = auditPersonas('checkpoint-v1').find(p => p.role === role);
    const client = createClient(`https://${m.project}.supabase.co`, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) },
    });
    const login = await client.auth.signInWithPassword({ email: persona.email, password: process.env.AUDIT_PASSWORD });
    assert(!login.error, `${role} sign-in failed`);
    actors[role] = { persona, client, id: login.data.user.id };
  }
  browser = await chromium.launch();
  const proofPage = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await proofPage.setContent('<body style="font:24px Arial;padding:40px"><h1>SYNTHETIC UAT EVIDENCE</h1><p>Automated recipient upload test.</p><p>No physical delivery or human acceptance.</p></body>');
  const bytes = await proofPage.screenshot();
  await proofPage.close();
  await writeFile(path.join(output, 'synthetic-proof.png'), bytes);
  const read = async (table, column, id) => {
    const response = await actors.operations_lead.client.schema('warehouse').from(table).select('*').eq(column, id);
    assert(!response.error, `${table}: ${response.error?.message}`);
    return response.data;
  };
  for (const c of m.cases) {
    const mobile = c.viewport.startsWith('mobile');
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      const [before] = await read('fulfillment_orders', 'id', c.orderId);
      const [request] = await read('department_stock_requests', 'id', c.requestId);
      assert.equal(before.status, 'released');
      assert.equal(before.source, 'department_request');
      assert.equal(before.released_by, actors.operations_lead.id);
      assert.equal(request.requested_by, actors.marketing_events_lead.id);
      assert.equal(request.fulfillment_order_id, c.orderId);
      assert.equal(request.purpose, `Synthetic WMS signoff ${m.runId}`);
      const stockBefore = await read('stock_levels', 'product_id', c.productId);
      const movementsBefore = await read('movements', 'product_id', c.productId);
      for (const [role, objectPath, scenario] of [
        ['general_employee', `acknowledgment-${c.orderId}/0/${randomUUID()}.png`, 'unrelated-requester'],
        ['marketing_events_lead', `acknowledgment-${randomUUID()}/0/${randomUUID()}.png`, 'unknown-order'],
        ['marketing_events_lead', `fulfillment/${c.orderId}/pick/${randomUUID()}.png`, 'unrelated-upload-purpose'],
      ]) {
        const denied = await actors[role].client.storage.from('evidence').upload(objectPath, bytes, { contentType: 'image/png', upsert: false });
        if (!denied.error) report.storageObjects.push({ path: objectPath, role, unexpected: true });
        assert(denied.error, `${scenario} was allowed`);
        assert.match(denied.error.message, /row.level security|not authorized|permission/i);
        report.checks.push({ viewport: c.viewport, scenario, actor: actors[role].id, denied: true });
        await persist();
      }
      await page.goto(m.origin + '/login?redirect=%2Fwarehouse%2Ffulfillment');
      await page.locator('#email').fill(actors.marketing_events_lead.persona.email);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login');
      await page.goto(`${m.origin}/warehouse/fulfillment?tab=requests&request=${c.requestId}`);
      await page.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Acknowledge receipt / REQ-${c.requestId}`, exact: true });
      await dialog.getByLabel('Acknowledgment reference', { exact: true }).fill(`SYNTHETIC-${m.runId}`);
      await expect(dialog.getByRole('button', { name: 'Confirm receipt', exact: true })).toBeDisabled();
      // Track the attempted object even if acknowledgment later fails.
      page.on('request', req => {
        const url = new URL(req.url());
        if (req.method() === 'POST' && url.hostname === `${m.project}.supabase.co` && url.pathname.startsWith('/storage/v1/object/evidence/')) {
          const objectPath = decodeURIComponent(url.pathname.slice('/storage/v1/object/evidence/'.length));
          report.storageObjects.push({ path: objectPath, role: 'marketing_events_lead', attempted: true });
        }
      });
      await dialog.locator('input[type=file]').setInputFiles({ name: 'synthetic-proof.png', mimeType: 'image/png', buffer: bytes });
      await expect(dialog.getByRole('button', { name: 'Confirm receipt', exact: true })).toBeEnabled();
      await page.screenshot({ path: path.join(output, `${c.viewport}-upload-accepted.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
      await expect.poll(async () => (await read('fulfillment_orders', 'id', c.orderId))[0].status).toBe('completed');
      await expect(dialog).not.toBeVisible();
      const [saved] = await read('fulfillment_orders', 'id', c.orderId);
      assert.equal(saved.acknowledged_by, actors.marketing_events_lead.id);
      assert.equal(saved.acknowledgement_reference, `SYNTHETIC-${m.runId}`);
      assert(saved.acknowledgement_evidence_url.startsWith(`acknowledgment-${c.orderId}/0/`));
      for (const role of ['marketing_events_lead', 'operations_lead']) {
        const download = await actors[role].client.storage.from('evidence').download(saved.acknowledgement_evidence_url);
        assert(!download.error, `${role} evidence read failed: ${download.error?.message}`);
        assert.equal(hash(Buffer.from(await download.data.arrayBuffer())), hash(bytes), 'Evidence bytes changed');
      }
      assert.deepEqual(await read('stock_levels', 'product_id', c.productId), stockBefore, 'Acknowledgment changed stock');
      assert.deepEqual(await read('movements', 'product_id', c.productId), movementsBefore, 'Acknowledgment posted another stock movement');
      assert.equal((await read('department_stock_requests', 'id', c.requestId))[0].status, 'closed');
      await page.reload();
      await expect(page.getByText('Receipt acknowledged', { exact: false }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Acknowledge receipt', exact: true })).toHaveCount(0);
      await page.screenshot({ path: path.join(output, `${c.viewport}-acknowledged.png`), fullPage: true });
      report.checks.push({ viewport: c.viewport, scenario: 'upload-acknowledge-readback', actor: actors.marketing_events_lead.id,
        persisted: saved, unchangedStock: true, byteHash: hash(bytes), readers: ['marketing_events_lead', 'operations_lead'] });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${c.viewport}-failure.png`), fullPage: true }).catch(() => {});
      report.failures.push({ viewport: c.viewport, message: error.message });
    } finally { await context.close(); await persist(); }
  }
  report.endHealth = await health();
  report.complete = report.failures.length === 0;
} catch (error) { report.failures.push({ message: error.message }); }
finally { await browser?.close(); report.finishedAt = new Date().toISOString(); await persist(); }
if (!report.complete) process.exitCode = 1;
console.log(JSON.stringify({ output, complete: report.complete, checks: report.checks.length, failures: report.failures }));
