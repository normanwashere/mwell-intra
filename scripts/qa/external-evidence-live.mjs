import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = 'https://mwell-intra-uat.vercel.app';
const output = path.resolve('outputs/sep12-performance/external-evidence-live');
assert(process.env.AUDIT_PASSWORD);
const health = await (await fetch(origin + '/api/health', { cache: 'no-store' })).json();
assert.equal(health.deployment.appEnv, 'uat');
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
assert.equal(health.commit, process.env.EXPECTED_COMMIT);
await mkdir(output, { recursive: true });
const report = { health, results: [] };
const browser = await chromium.launch();
try {
  for (const suffix of ['operations.associate', 'operations.lead']) {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
      const errors = [], externalRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => { if (new URL(request.url()).hostname === 'deliverylink.com') externalRequests.push(request.url()); });
      try {
        await page.goto(origin + '/login?redirect=%2Fwarehouse%2Freceiving');
        await page.locator('#email').fill(`intra.test.${suffix}@mwell.com.ph`);
        await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.waitForURL(url => !url.pathname.startsWith('/login'));
        await page.goto(origin + '/warehouse/receiving');
        await page.getByRole('button', { name: 'Add to receipt', exact: true }).waitFor();
        const links = page.getByRole('link', { name: /open external evidence on deliverylink.com/i });
        await links.first().waitFor({ state: 'attached' });
        await links.first().scrollIntoViewIfNeeded();
        assert.match(await links.first().getAttribute('href'), /^https:\/\/deliverylink\.com/);
        assert.equal(await links.first().getAttribute('target'), '_blank');
        assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
        assert.equal(await page.locator('img[src*="deliverylink.com"]').count(), 0);
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          linksOverflow: [...document.querySelectorAll('a[aria-label^="Open external evidence"]')].filter(link => link.scrollWidth > link.clientWidth + 1).length,
        }));
        const screenshot = `${suffix}-${width}.png`;
        await page.screenshot({ path: path.join(output, screenshot), animations: 'disabled' });
        assert.equal(layout.overflow, false);
        assert.equal(layout.linksOverflow, 0);
        assert.equal(externalRequests.length, 0);
        assert.deepEqual(errors, []);
        report.results.push({ role: suffix, width, status: 'passed', links: await links.count(), layout, externalRequests, errors, screenshot });
      } catch (error) {
        const screenshot = `${suffix}-${width}-failed.png`;
        await page.screenshot({ path: path.join(output, screenshot), animations: 'disabled' }).catch(() => {});
        report.results.push({ role: suffix, width, status: 'failed', error: error.message, errors, externalRequests, screenshot });
      } finally { await page.context().close(); }
    }
  }
} finally { await browser.close(); }
await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.results));
if (report.results.some(result => result.status !== 'passed')) process.exitCode = 1;
