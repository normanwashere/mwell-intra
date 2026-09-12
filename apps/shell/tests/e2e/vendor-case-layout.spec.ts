import { expect, test } from '@playwright/test';
import { actor, CONTROLLED_SUPABASE_URL, ControlledProcurementRpcFixture, installControlledRpc } from '../helpers/controlled-procurement-rpc';

const caseId = 'controlled-vendor-case-layout';
const vendorName = 'MWELL UAT Test Vendor';

test('draft vendor case status fits the viewport without clipping its label', async ({ page, context }, testInfo) => {
  expect(new URL(CONTROLLED_SUPABASE_URL).hostname).toBe('127.0.0.1');
  const fixture = new ControlledProcurementRpcFixture();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installControlledRpc(context, fixture, 'vendor');
  await context.route(`${CONTROLLED_SUPABASE_URL}/auth/v1/**`, async route => {
    const vendor = actor('vendor');
    const user = { id: vendor.id, email: vendor.email, aud: 'authenticated', role: 'authenticated',
      app_metadata: { roles: vendor.roles, kind: 'vendor', vendor_id: vendor.vendorId },
      user_metadata: { name: vendor.name, title: vendor.title } };
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/token') ? {
      access_token: `controlled-${vendor.id}`, refresh_token: `controlled-refresh-${vendor.id}`,
      token_type: 'bearer', expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400, user,
    } : path.endsWith('/user') ? user : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  // Read-only case projection; no invitation, certification, upload, or live account is exercised.
  await context.route('**/rest/v1/**', async route => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split('/').pop();
    if (table === 'my_capability_snapshot' && request.headers()['content-profile'] === 'core') {
      const capabilities = { core: ['vendor_portal', 'view_own_accreditation'] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roleCapabilities: capabilities, userCapabilities: capabilities }) });
    }
    if (request.method() !== 'GET' || request.headers()['accept-profile'] !== 'legal') return route.fallback();
    const rows = table === 'accreditation_cases' ? [{
      id: caseId, vendor_id: actor('vendor').vendorId, vendor_name: vendorName,
      status: 'draft', opened_at: '2026-09-12T00:00:00Z', category: 'Technology services', jurisdiction: 'PH',
    }] : table === 'requirement_checklist_items' ? [1, 2, 3, 4].map(index => ({
      id: `controlled-requirement-${index}`, case_id: caseId,
      requirement: `Company document ${index}`, required: true, decision: 'pending', document_ids: [],
    })) : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  const destination = `/vendor/cases/${caseId}`;
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel('Email').fill(actor('vendor').email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}/?$`));
  await expect(page.getByRole('heading', { level: 1, name: vendorName })).toBeVisible();
  await expect(page.getByText('0/4 required checklist items approved', { exact: true })).toBeVisible();
  const badge = page.locator('[data-workspace-header] .chip');
  await expect(badge).toHaveText('Action needed \u2014 complete your application');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('vendor-case-viewport.png'), fullPage: false });
  await page.screenshot({ path: testInfo.outputPath('vendor-case.png'), fullPage: true });
  const dimensions = await badge.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const header = element.closest('[data-workspace-header]')!.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth,
      badgeLeft: rect.left, badgeRight: rect.right, headerLeft: header.left, headerRight: header.right,
      badgeScrollWidth: element.scrollWidth, badgeClientWidth: element.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace };
  });
  await testInfo.attach('layout-dimensions', { body: JSON.stringify(dimensions), contentType: 'application/json' });
  expect(dimensions.pageWidth).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  expect(dimensions.badgeLeft).toBeGreaterThanOrEqual(dimensions.headerLeft);
  expect(dimensions.badgeRight).toBeLessThanOrEqual(dimensions.headerRight);
  expect(dimensions.badgeScrollWidth).toBeLessThanOrEqual(dimensions.badgeClientWidth);
  expect(errors).toEqual([]);
  await page.getByRole('link', { name: 'Back to cases', exact: true }).click();
  await expect(page).toHaveURL(/\/vendor\/?$/);
});
