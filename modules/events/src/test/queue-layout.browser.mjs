/* global URL, process, fetch, document, innerWidth, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(new URL('../../../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = 'http://localhost:3022';
assert(process.env.AUDIT_PASSWORD, 'AUDIT_PASSWORD is required');
const health = await (await fetch(`${origin}/api/health`)).json();
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
const output = path.resolve('outputs/sep11-ux-remediation/events-compact');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const blocked = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      || url.pathname === '/auth/v1/token'
      || /^\/rest\/v1\/rpc\/my_(capability_snapshot|learning_snapshot)$/.test(url.pathname);
    if (safe) return route.continue();
    blocked.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${origin}/login`, { timeout: 120000 });
  await page.locator('#email').fill('intra.test.marketing.events@mwell.com.ph');
  await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(url => url.pathname !== '/login', { timeout: 120000 });
  for (const width of [390, 320, 1440]) {
    const height = width < 600 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/events`, { timeout: 120000 });
    await page.getByRole('heading', { name: 'Events', level: 1, exact: true }).waitFor();
    const first = page.getByRole('link', { name: 'View event', exact: true }).first();
    await first.waitFor();
    const totals = await page.getByRole('region', { name: 'Event totals' }).innerText();
    const firstAction = await first.boundingBox();
    assert(firstAction && firstAction.y + firstAction.height <= height - (width < 600 ? 90 : 0), 'First event action must fit above mobile navigation');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page overflow');
    assert.match(await page.getByRole('button', { name: 'New event', exact: true }).getAttribute('class'), /btn-outline/);
    const screenshot = `events-${width}.png`;
    await page.screenshot({ path: path.join(output, screenshot), animations: 'disabled' });
    results.push({ width, totals, firstAction, screenshot, passed: true });
    if (width === 390) {
      await page.getByRole('button', { name: 'New event', exact: true }).click();
      await page.getByRole('dialog', { name: 'Create event', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await first.click();
      await page.waitForURL(url => /^\/events\/.+/.test(url.pathname));
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.goBack();
      await page.getByRole('heading', { name: 'Events', level: 1, exact: true }).waitFor();
    }
  }
  // The shared learning provider attempts assignment resolution on mount; keep it blocked.
  assert(blocked.every(item => item === 'POST /rest/v1/rpc/resolve_assignments'), 'Unexpected write attempted');
  await context.close();
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, blocked }, null, 2));
}
console.log(JSON.stringify(results));
