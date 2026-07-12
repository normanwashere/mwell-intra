import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(path.resolve('apps/shell/package.json'));
const { chromium } = require('@playwright/test');

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, '');
const password = process.env.AUDIT_PASSWORD;
if (!baseUrl || !password) throw new Error('AUDIT_BASE_URL and AUDIT_PASSWORD are required.');

const output = path.resolve('docs/manual/assets/live-20260711');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !document.body.innerText.includes('Restoring your session'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });
  await settle(page);
}

async function capture({ name, viewport, email, route = '/', fullPage = true }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  if (email) await login(page, email);
  await page.goto(`${baseUrl}${route}`);
  await settle(page);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
  await context.close();
}

await capture({ name: '01-sign-in-desktop', viewport: { width: 1440, height: 900 }, route: '/login', fullPage: false });
await capture({ name: '02-sign-in-mobile', viewport: { width: 390, height: 844 }, route: '/login', fullPage: false });
await capture({ name: '03-command-center-admin-desktop', viewport: { width: 1440, height: 900 }, email: 'intra.test.admin@mwell.com.ph' });
await capture({ name: '04-admin-users-mobile-320', viewport: { width: 320, height: 720 }, email: 'intra.test.admin@mwell.com.ph', route: '/admin/users' });
await capture({ name: '05-procurement-list-desktop', viewport: { width: 1440, height: 900 }, email: 'intra.test.proc.requester@mwell.com.ph', route: '/procurement' });
await capture({ name: '06-procurement-request-mobile-320', viewport: { width: 320, height: 720 }, email: 'intra.test.proc.requester@mwell.com.ph', route: '/procurement/requests/new' });
await capture({ name: '07-procurement-created-desktop', viewport: { width: 1440, height: 900 }, email: 'intra.test.proc.requester@mwell.com.ph', route: '/procurement/requests/req_0c335433cb79423e9ad0c45a4f0c1f22' });
await capture({ name: '08-legal-cases-desktop', viewport: { width: 1440, height: 900 }, email: 'intra.test.legal.reviewer@mwell.com.ph', route: '/legal' });
await capture({ name: '09-legal-invite-mobile', viewport: { width: 390, height: 844 }, email: 'intra.test.legal.reviewer@mwell.com.ph', route: '/legal/invites/new' });
await capture({ name: '10-vendor-portal-mobile', viewport: { width: 390, height: 844 }, email: 'intra.test.vendor@mwell.com.ph', route: '/vendor' });
await capture({ name: '11-warehouse-live-error-desktop', viewport: { width: 1440, height: 900 }, email: 'intra.test.wh.logistics@mwell.com.ph', route: '/warehouse/receiving' });
await capture({ name: '12-warehouse-live-error-mobile', viewport: { width: 390, height: 844 }, email: 'intra.test.wh.logistics@mwell.com.ph', route: '/warehouse/receiving' });

await browser.close();
console.log(`Captured manual evidence in ${output}`);
