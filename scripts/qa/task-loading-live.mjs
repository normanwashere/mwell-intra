import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const origin = 'https://mwell-intra-uat.vercel.app';
assert(process.env.AUDIT_PASSWORD);
const health = await (await fetch(origin + '/api/health', { cache: 'no-store' })).json();
assert.equal(health.deployment.appEnv, 'uat');
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
const output = path.resolve('outputs/sep12-performance/tasks-live');
await mkdir(output, { recursive: true });
const report = { health, results: [] };
const browser = await chromium.launch();
try {
  for (const suffix of ['operations.associate', 'operations.lead']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let failTasks = false, capture = false;
    const requests = [];
    page.on('request', req => { if (capture) requests.push(new URL(req.url()).pathname); });
    await page.route('**/rest/v1/warehouse_tasks?**', route => failTasks
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Task read interrupted for retry verification' }) })
      : route.continue());
    try {
      await page.goto(origin + '/login');
      await page.locator('#email').fill(`intra.test.${suffix}@mwell.com.ph`);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login');
      await page.goto('about:blank');
      capture = true;
      await page.goto(origin + '/warehouse/tasks');
      await page.getByRole('list', { name: 'due tasks', exact: true }).waitFor();
      assert(requests.includes('/rest/v1/quality_inspection_queue'));
      assert(!requests.includes('/rest/v1/quality_inspections'), 'Tasks must not read full photo payloads');
      const source = page.getByRole('link', { name: /Open quality source/i }).first();
      await source.waitFor();
      const href = await source.getAttribute('href');
      assert(new URL(href, origin).searchParams.get('source'));
      await page.screenshot({ path: path.join(output, `${suffix}-desktop.png`), animations: 'disabled' });
      failTasks = true;
      await page.reload();
      const retry = page.getByRole('button', { name: 'Retry task queue', exact: true });
      await retry.waitFor();
      await page.waitForTimeout(1200);
      await expect(retry).toBeVisible();
      await expect(page.getByText('No due tasks', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: path.join(output, `${suffix}-failure.png`), animations: 'disabled' });
      failTasks = false;
      await retry.click();
      await page.getByRole('list', { name: 'due tasks', exact: true }).waitFor();
      await expect(retry).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      await page.screenshot({ path: path.join(output, `${suffix}-mobile.png`), animations: 'disabled' });
      await page.getByRole('link', { name: /Open quality source/i }).first().click();
      await page.getByRole('heading', { name: 'Quality control', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('source'), new URL(href, origin).searchParams.get('source'));
      report.results.push({ role: suffix, passed: true, metadataOnly: true, explicitRetry: true, sourceLinkRetained: true });
    } catch (error) {
      report.results.push({ role: suffix, passed: false, error: error.message });
      await page.screenshot({ path: path.join(output, `${suffix}-unexpected.png`) });
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
assert(report.results.length === 2 && report.results.every(row => row.passed));
