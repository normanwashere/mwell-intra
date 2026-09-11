import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

// Read-only UAT browser verification. Role toggles run only in the isolated memory fixture.
const origin = process.env.ADMIN_UX_ORIGIN || 'http://localhost:3022';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local candidate server required');
if (!process.env.AUDIT_PASSWORD) throw new Error('AUDIT_PASSWORD is required');
const output = path.resolve('outputs/sep11-admin-ux');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const expect = baseExpect.configure({ timeout: 15000 });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await context.route('**/rest/v1/rpc/**', route => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  if (/^(assign_|revoke_|save_|activate_|delete_|update_|create_|manage_|submit_|complete_)/.test(name)) return route.abort('blockedbyclient');
  return route.continue();
});
async function screenshot(name) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
}
try {
  if (process.env.ADMIN_UX_MEMORY_ONLY !== '1') {
  await page.goto(`${origin}/login`);
  await page.locator('#email').fill('intra.test.admin@mwell.com.ph');
  await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(url => url.pathname !== '/login', { timeout: 60000 });
  await page.goto(`${origin}/admin/users?q=intra.test.operations&status=all&kind=employee`);
  await page.getByRole('button', { name: 'Manage', exact: true }).first().waitFor({ timeout: 60000 });
  await expect(page.getByLabel('Search users')).toHaveValue('intra.test.operations');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('all');
  const firstAction = await page.getByRole('button', { name: 'Manage', exact: true }).first().boundingBox();
  expect(firstAction.y + firstAction.height).toBeLessThan(900);
  await screenshot('users-desktop');
  await page.getByRole('button', { name: 'Manage', exact: true }).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.has('user')).toBe(true);
  const selectedUrl = page.url();
  const check = page.getByRole('dialog').locator('input[type=checkbox]:not(:disabled)').first();
  await check.waitFor({ timeout: 30000 });
  await page.keyboard.press('Tab');
  await check.focus();
  await expect(check).toBeFocused();
  expect(await check.evaluate(input => window.getComputedStyle(input.nextElementSibling).outlineWidth)).toBe('2px');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(check).toBeFocused();
  await screenshot('role-focus-desktop');
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await check.evaluate(input => window.getComputedStyle(input.nextElementSibling).outlineStyle)).toBe('solid');
  await page.emulateMedia({ forcedColors: 'none' });
  await page.reload();
  await check.waitFor({ timeout: 30000 });
  expect(page.url()).toBe(selectedUrl);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Search users')).toHaveValue('intra.test.operations');
  await page.goForward();
  await check.waitFor({ timeout: 30000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`${origin}/admin/users?q=no-such-user&user=not-a-uuid`);
  await expect(page.getByText('User not found or outside your authorized scope.')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Return to directory' }).click();
  await expect(page.getByLabel('Search users')).toHaveValue('no-such-user');

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/admin', '/admin/users?q=intra.test.operations', '/admin/departments', '/admin/doa']) {
      await page.goto(origin + route);
      await expect(page.locator('main h1')).toBeVisible({ timeout: 30000 });
      if (route.includes('/users')) await page.getByRole('button', { name: 'Manage', exact: true }).first().waitFor({ timeout: 30000 });
      await screenshot(`${route.split('?')[0].replaceAll('/', '-')}-${width}`);
      if (route === '/admin/doa') {
        await page.getByRole('link', { name: 'Matrix editor', exact: true }).click();
        await expect(page.locator('#doa-editor')).toBeFocused();
        await screenshot(`doa-editor-${width}`);
        await page.locator('#doa-assignments input').last().scrollIntoViewIfNeeded();
        await screenshot(`doa-bottom-${width}`);
      }
    }
  }
  await page.goto(`${origin}/admin/audit`);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => page.locator('ol > li').count(), { timeout: 60000 }).toBeGreaterThan(0);
  await screenshot('audit-mobile');
  await page.route('**/api/admin/audit?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Isolated read failure' }) }), { times: 1 });
  await page.getByLabel('Search audit history').fill('governed');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Audit history unavailable' })).toBeVisible();
  await page.waitForTimeout(6000);
  await expect(page.getByRole('button', { name: 'Retry audit history' })).toBeVisible();
  await screenshot('audit-read-failure');
  await page.route('**/api/admin/audit?**', route => route.fulfill({ json: { rows: [], actors: {}, next: 101, snapshot: 2101, scanned: 2000, searchPending: true } }), { times: 1 });
  await page.getByRole('button', { name: 'Retry audit history' }).click();
  await expect(page.getByRole('heading', { name: 'Search unfinished' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No matching audit events' })).toHaveCount(0);
  await screenshot('audit-continuation');
  await page.route('**/api/admin/audit?**', route => {
    expect(new URL(route.request().url()).searchParams.get('before')).toBe('101');
    return route.fulfill({ json: { rows: [], actors: {}, next: null, snapshot: 2101, scanned: 100, searchPending: false } });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Continue searching' }).click();
  await expect(page.getByRole('heading', { name: 'No matching audit events' })).toBeVisible();
  await expect(page.getByLabel('Search audit history')).toHaveValue('governed');
  expect(errors).toEqual([]);
  console.log('PASS read-only UAT: URL reload/Back/Forward, missing selection, keyboard focus/forced colors, desktop/mobile layout, section focus, audit failure/retry/continuation.');
  }

  const memory = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const fixture = await memory.newPage();
  await fixture.addInitScript(() => {
    window.sessionStorage.setItem('intra.memory-session.v1', JSON.stringify({ profileId: 'demo-admin', roles: { core: ['platform_admin', 'staff'] } }));
    window.sessionStorage.setItem('intra.evidence-scenario', 'admin-role-correction');
  });
  await fixture.goto('http://localhost:3021/admin/users');
  await expect(fixture.getByText('Read-only preview', { exact: true })).toBeVisible({ timeout: 60000 });
  await fixture.getByRole('button', { name: 'Manage', exact: true }).nth(2).click();
  if (!(await fixture.getByRole('dialog').count())) {
    const actions = fixture.getByRole('button', { name: 'Manage', exact: true });
    for (let i = 0; i < await actions.count(); i++) { await actions.nth(i).click(); if (await fixture.getByRole('dialog').count()) break; }
  }
  const role = fixture.getByRole('dialog').locator('input[type=checkbox]:not(:disabled)').first();
  await role.waitFor({ timeout: 30000 });
  await role.focus();
  const checked = await role.isChecked();
  const label = await role.getAttribute('aria-label');
  await fixture.keyboard.press('Space');
  const nextLabel = label.replace(/^(Remove|Assign) /, checked ? 'Assign ' : 'Remove ');
  await expect(fixture.getByRole('checkbox', { name: nextLabel, exact: true })).toBeChecked({ checked: !checked });
  await memory.close();
  console.log('PASS isolated memory fixture: Space toggles the enabled native role checkbox.');
} finally {
  await browser.close();
}
