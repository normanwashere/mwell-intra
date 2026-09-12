import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';

// Fixture preparation and independently verified cleanup are separate SQL steps.
// This runner never creates identities, bypasses training, or sends email.
const origin = 'https://mwell-intra-uat.vercel.app';
const project = 'kkoitlvydytdhlpxhuah';
const commit = process.env.PERF_EXPECTED_COMMIT;
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
const output = path.resolve('outputs/sep12-performance/vendor-ack-live', runId);
const health = async () => {
  const response = await fetch(origin + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok);
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.deployment.appEnv, 'uat');
  assert.equal(data.deployment.supabaseProjectRef, project);
  assert.equal(data.commit, commit);
  return data;
};
const report = { scope: 'Live PO acknowledgment on disposable seeded POs; not invitation delivery, PO approval or real-user evidence.',
  runId, startedAt, expectedCommit: commit ?? null, checks: [], complete: false, cleanup: 'Requires independent SQL verification' };
let browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  assert.equal(process.env.APP_ENV, 'uat');
  assert.equal(process.env.AUDIT_MUTATIONS, 'true');
  assert(process.env.AUDIT_PASSWORD);
  assert(/^[a-f0-9]{40}$/.test(commit ?? ''));
  const persona = auditPersonas('checkpoint-v1').find(p => p.kind === 'vendor');
  assert(persona, 'Isolated vendor persona is required');
  report.health = await health();
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test');
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(`https://${project}.supabase.co`, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) },
  });
  const { data: login, error: loginError } = await client.auth.signInWithPassword({ email: persona.email, password: process.env.AUDIT_PASSWORD });
  assert(!loginError, 'Isolated vendor login failed');
  assert.equal(login.user.email, persona.email);
  const rpc = (name, payload) => client.schema('procurement').rpc(name, { payload });
  const readPo = async id => {
    const listed = await rpc('vendor_purchase_order_acknowledgements', {});
    assert(!listed.error, 'Vendor purchase order projection failed');
    assert(Array.isArray(listed.data), 'Expected purchase order projection array');
    const po = listed.data.find(row => row.id === id);
    assert(po && po.poNumber === id && Number.isInteger(po.lifecycle?.revision), 'Expected run-owned fixture with lifecycle');
    return po;
  };
  browser = await chromium.launch();
  for (const [name, width, height, suffix] of [['desktop-1440', 1440, 900, 'D'], ['mobile-390', 390, 844, 'M']]) {
    const id = `QA-SEP12-VENDOR-ACK-175-${suffix}`;
    const reference = `${id}-REVIEWED`;
    const po = await readPo(id);
    assert(po.lifecycle.acknowledgementStatus !== 'acknowledged', 'Expected unused run-owned fixture');
    const payload = { purchase_order_id: id, expected_revision: po.lifecycle.revision, document_hash: po.documentHash, acknowledgement_reference: reference };
    // Current RAISE EXCEPTION guards in the Aug 22 lifecycle and Sep 05 RPC migrations.
    const lifecycleChanged = 'The PO lifecycle changed; refresh before retrying';
    const contentUnavailable = 'Purchase order content changed or is unavailable';
    const expectRejected = async (check, input, message, revision) => {
      const denied = await rpc('acknowledge_purchase_order', input);
      assert(denied.error, `${check} unexpectedly succeeded`);
      assert.equal(denied.error.code, 'P0001', `${check}: unexpected error code`);
      assert.equal(denied.error.message, message, `${check}: unexpected guard`);
      const saved = await readPo(id);
      assert.equal(saved.lifecycle.revision, revision, `${check}: rejected call changed revision`);
      report.checks.push({ viewport: name, id, check, rejected: true,
        code: denied.error.code, message: denied.error.message, revision: saved.lifecycle.revision });
    };
    for (const [negative, input, message] of [
      ['stale revision', { ...payload, expected_revision: 99999 }, lifecycleChanged],
      ['wrong document hash', { ...payload, document_hash: 'invalid' }, contentUnavailable],
      ['empty reference', { ...payload, acknowledgement_reference: '' }, 'A governed evidence reference is required'],
      ['unavailable order', { ...payload, purchase_order_id: 'QA-SEP12-VENDOR-ACK-175-UNAVAILABLE' }, contentUnavailable],
    ]) {
      await expectRejected(negative, input, message, po.lifecycle.revision);
    }
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await page.goto(origin + '/login?redirect=%2Fvendor%2Fpurchase-orders');
      await page.locator('#email').fill(persona.email);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login');
      await page.goto(origin + '/vendor/purchase-orders');
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: id, exact: true }) });
      await expect(section).toBeVisible();
      const button = section.getByRole('button', { name: `Acknowledge revision ${po.lifecycle.revision}`, exact: true });
      await expect(button).toBeDisabled();
      await section.getByLabel(`Acknowledgement reference for ${id}`, { exact: true }).fill(reference);
      await expect(button).toBeDisabled();
      await section.getByText('Read purchase order', { exact: true }).click();
      await expect(section.getByText('Synthetic acknowledgment test item', { exact: true })).toBeVisible();
      await expect(button).toBeEnabled();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
      await page.screenshot({ path: path.join(output, `${name}-review.png`), fullPage: true });
      await button.click();
      await expect(section.getByText('acknowledged', { exact: true })).toBeVisible();
      await page.reload();
      await expect(section.getByText('acknowledged', { exact: true })).toBeVisible();
      await expect(section.getByRole('button', { name: /^Acknowledge revision/ })).toHaveCount(0);
      await page.screenshot({ path: path.join(output, `${name}-acknowledged.png`), fullPage: true });
      const replay = await rpc('acknowledge_purchase_order', payload);
      assert(!replay.error, 'Exact replay must be idempotent');
      assert.equal(replay.data?.replayed, true, 'Exact replay must report an existing event');
      assert.equal(replay.data.revision, po.lifecycle.revision + 1, 'Exact replay must preserve revision');
      await expectRejected('changed replay', { ...payload, acknowledgement_reference: reference + '-CHANGED' },
        lifecycleChanged, po.lifecycle.revision + 1);
      const saved = await readPo(id);
      assert.equal(saved.lifecycle.acknowledgementStatus, 'acknowledged');
      assert.equal(saved.lifecycle.revision, po.lifecycle.revision + 1);
      report.checks.push({ viewport: name, check: 'review, acknowledge, refresh and exact replay', passed: true,
        id, actor: login.user.id, reference, documentHash: po.documentHash, replay: replay.data, lifecycle: saved.lifecycle });
    } finally { await context.close(); }
  }
  report.endHealth = await health();
  report.complete = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  catch (error) {
    report.browserCloseError = error instanceof Error ? error.message : String(error);
    report.complete = false;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ runId, output, complete: report.complete, checks: report.checks.length,
  error: report.error ?? report.browserCloseError ?? null }));
