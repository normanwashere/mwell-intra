import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const origin = 'https://mwell-intra-uat.vercel.app';
const run = process.env.AUDIT_RUN ?? 'sep11-uat-deployment';
assert(/^[a-z0-9-]+$/.test(run));
const output = path.resolve('outputs', run);
const password = process.env.AUDIT_PASSWORD;
const sha = process.env.AUDIT_EXPECTED_SHA;
assert(password && /^[a-f0-9]{40}$/.test(sha ?? ''), 'Password and exact release SHA required.');
const health = await (await fetch(`${origin}/api/health`, { cache: 'no-store' })).json();
assert.equal(health.commit, sha);
assert.equal(health.deployment.appEnv, 'uat');
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
assert.equal(health.supabase, 'reachable');
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    for (const [role, email, route] of [
      ['marketing', 'intra.test.marketing.events@mwell.com.ph', '/warehouse/fulfillment?tab=requests'],
      ['operations', 'intra.test.operations.associate@mwell.com.ph', '/warehouse/fulfillment?tab=orders'],
      ['administrator', 'intra.test.admin@mwell.com.ph', '/admin/audit'],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: 'allow' });
      const page = await context.newPage();
      const result = { role, width, route, status: 'running', pageErrors: [], serverErrors: [], transactionMutations: false };
      page.on('pageerror', error => result.pageErrors.push(error.message));
      page.on('response', response => { if (response.status() >= 500) result.serverErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
      try {
        await page.goto(`${origin}/login?redirect=%2F`, { waitUntil: 'domcontentloaded' });
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(password);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.waitForURL(url => url.pathname !== '/login', { timeout: 45000 });
        await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
        const content = role === 'administrator' ? page.getByRole('heading', { name: /audit/i }).first() : page.getByRole('heading', { name: 'Department requests', exact: true });
        if (role !== 'operations') await expect(content).toBeVisible({ timeout: 45000 });
        else await expect(page.getByRole('group', { name: 'Order counters' })).toBeVisible({ timeout: 45000 });
        await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0, { timeout: 45000 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { timeout: 15000 }).toBeLessThanOrEqual(2);
        await page.screenshot({ path: path.join(output, `${role}-${width}.png`), animations: 'disabled' });
        if (role === 'marketing') {
          const action = page.getByRole('button', { name: 'Acknowledge receipt', exact: true });
          result.eligibleAcknowledgmentActions = await action.count();
          if (result.eligibleAcknowledgmentActions) {
            await action.first().click();
            const dialog = page.getByRole('dialog', { name: /Acknowledge receipt/ });
            await expect(dialog.getByLabel('Acknowledgment reference', { exact: true })).toBeVisible();
            await expect(dialog.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
            await page.screenshot({ path: path.join(output, `marketing-acknowledgment-${width}.png`), animations: 'disabled' });
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible();
          }
        }
        if (role === 'administrator') {
          await page.getByRole('button', { name: /^Notifications/ }).click();
          const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true });
          await expect(dialog.getByRole('button', { name: 'Unread', exact: true })).toBeVisible();
          await expect(dialog.getByLabel('Sort')).toBeVisible();
          await page.screenshot({ path: path.join(output, `notifications-${width}.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
        }
        assert.equal(result.pageErrors.length, 0, 'No uncaught page errors');
        assert.equal(result.serverErrors.length, 0, 'No server errors');
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed'; result.error = String(error.message).replaceAll(password, '[REDACTED]').slice(0,2500);
        await page.screenshot({ path: path.join(output, `${role}-${width}-failure.png`), mask: [page.locator('input')] }).catch(() => {});
      } finally { await context.close(); }
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(path.join(output, 'results.json'), JSON.stringify({ health, results, scope: 'Read-only post-deployment smoke; no transaction or receipt submitted.' }, null, 2));
    }
  }
} finally { await browser.close(); }
assert.equal(results.filter(row => row.status !== 'passed').length, 0, 'All deployment smoke cases must pass');
