// Local Next candidate with existing UAT reads. No operational mutations allowed.
/* global document, innerWidth, innerHeight, console, process */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import { CURRENT_LIVE_ROLES } from '../../../../scripts/qa/live-e2e-scenarios.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { chromium, expect } = require('@playwright/test');
const origin = 'http://127.0.0.1:3031';
const password = process.env.AUDIT_PASSWORD;
assert(password, 'AUDIT_PASSWORD required');
const output = path.join(root, 'modules/warehouse/output/playwright/fulfillment-sep20-candidate', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const result = { environment: 'local Next candidate, UAT read-only data, no migrations applied', captures: [], conversionRead: [], blockedWrites: [], errors: [], complete: false };
const browser = await chromium.launch();
const readRpc = /^(get_|list_|search_|read_|fetch_|can_|has_|my_|current_|resolve_my_|learning_read_|learning_get_|platform_finance_|platform_close_sources$|platform_close_evidence_options$|platform_followup_page$|department_request_actor_names$|request_decision_eligibility$|vendor_eligibility_projection$|vendor_purchase_order_acknowledgements$|purchase_order_(amendment|closure)_work_items$|procurement_receipt_(exception|excess)_work_items$|payment_evidence_options$|evaluation_workspace$|platform_user_directory$|purchase_order_receipt_status$|commitment_readiness$|purchase_order_lifecycle$|review_open_purchase_orders$|payment_readiness_staleness_work_items$|event_custody_workspace$|stock_conversion_workspace$)/;
try {
  for (const role of ['operations_associate', 'finance_controller']) {
    let storage;
    for (const [width, height] of (role === 'operations_associate' ? [[1440, 1000], [390, 844], [320, 720]] : [[390, 844]])) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce', ...(storage ? { storageState: storage } : {}) });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url()), rpc = url.pathname.split('/rpc/')[1];
        if (/^(GET|HEAD|OPTIONS)$/.test(request.method()) || url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/storage/v1/object/sign/')) return route.continue();
        if (rpc && (readRpc.test(rpc) || /^(resolve_assignments|evaluate_certifications|sync_shared_completions)$/.test(rpc))) return route.continue();
        if (url.origin === origin && url.pathname === '/api/client-errors') {
          result.errors.push((request.postData() ?? 'Client error reported').replaceAll(password, '[REDACTED]').slice(0, 1800));
          return route.continue();
        }
        if (url.origin === origin && url.pathname === '/__nextjs_original-stack-frames') return route.continue();
        result.blockedWrites.push({ role, width, method: request.method(), path: url.pathname });
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => result.errors.push(error.message.replaceAll(password, '[REDACTED]').slice(0,500)));
      const capture = async name => {
        const file = `${role}-${width}-${name}.png`;
        const metrics = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('ul[aria-label="Fulfillment demand"] > li')].map(el => {
            const rect = el.getBoundingClientRect(); return { y: rect.y, bottom: rect.bottom, height: rect.height };
          });
          const primary = document.querySelector('ul[aria-label="Fulfillment demand"] > li button.btn-primary');
          const rect = primary?.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth - innerWidth, visibleRows: rows.filter(row => row.y >= 0 && row.bottom <= innerHeight).length,
            rows: rows.slice(0, 6), firstAction: rect ? { y: rect.y, bottom: rect.bottom, height: rect.height,
              unobscured: primary.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 2)) } : null };
        });
        await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
        result.captures.push({ role, width, height, name, file, ...metrics });
        assert(metrics.overflow <= 1, `${role}-${width}-${name}: overflow ${metrics.overflow}`);
        console.log(JSON.stringify({ role, width, name, ...metrics }));
        if (name === 'queue' || name === 'uat-queue') {
          if (width === 1440) assert(metrics.visibleRows >= 5, `${name}: fewer than five desktop rows`);
          else assert(metrics.firstAction && metrics.firstAction.height >= 44 && metrics.firstAction.bottom < height && metrics.firstAction.unobscured, `${width}-${name}: first action below fold or obscured`);
        }
      };
      try {
        if (!storage) {
          const persona = CURRENT_LIVE_ROLES.find(persona => persona.role === role);
          await page.goto(origin + '/login?redirect=%2F', { waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForFunction(() => {
            const button = document.querySelector('button[type="submit"]');
            return button && !button.disabled && button.textContent.trim() === 'Sign in';
          }, { timeout: 90000 });
          await page.locator('#email').fill(persona.email);
          await page.locator('#password').fill(password);
          await page.getByRole('button', { name: /^sign in$/i }).click();
          await page.waitForURL(url => url.pathname !== '/login', { timeout: 90000, waitUntil: 'domcontentloaded' }).catch(async error => {
            result.errors.push('Login did not settle: ' + (await page.locator('body').innerText()).replaceAll(password, '[REDACTED]').slice(0, 1500));
            throw error;
          });
          storage = await context.storageState();
        }
        if (role === 'operations_associate') {
          await page.goto(origin + '/warehouse/fulfillment?tab=orders&filter=floor_work', { waitUntil: 'domcontentloaded', timeout: 120000 });
          const list = page.getByRole('list', { name: 'Fulfillment demand' });
          await expect(list).toBeVisible({ timeout: 90000 });
          await capture('queue');
          const first = list.getByRole('listitem').first();
          const actionBox = await first.locator('button.btn-primary').first().boundingBox();
          assert(actionBox && actionBox.height >= 44 && actionBox.y + actionBox.height < height, `${width}: first action below fold`);
          if (width < 600) {
            const filters = page.getByRole('button', { name: 'Filters', exact: true });
            await filters.click(); await expect(page.getByLabel('Channel', { exact: true })).toBeVisible(); await filters.click();
            const disclosure = first.locator('summary').filter({ hasText: 'Full order reference' });
            if (await disclosure.count()) { await disclosure.click(); await expect(first.getByRole('button', { name: 'Copy reference' })).toBeVisible(); await disclosure.click(); }
          }
          await first.getByRole('button', { name: 'View order details' }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible(); await capture('order-details');
          await dialog.getByRole('button', { name: 'Close', exact: true }).click();
          await expect(first.getByRole('button', { name: 'View order details' })).toBeFocused();
          await page.goto(origin + '/warehouse/fulfillment?tab=orders&uat=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
          await expect(page.getByRole('button', { name: /Show all records/ })).toBeVisible({ timeout: 90000 });
          await capture('uat-queue');
          await expect(page.getByRole('tab', { name: 'Kits and re-kits' })).toHaveCount(0);
          await page.getByRole('tab', { name: 'Stock conversion', exact: true }).click();
          await expect(page).toHaveURL(/tab=conversion/);
          const conversion = page.getByRole('region', { name: 'Stock conversion', exact: true });
          await expect(conversion).toBeVisible({ timeout: 90000 });
          await expect(conversion.getByText('Loading conversion work...', { exact: true })).toHaveCount(0, { timeout: 90000 });
          await expect(conversion.getByText('Product recipe approval', { exact: true })).toHaveCount(0);
          result.conversionRead.push({ role, width, routeReached: true, unavailable: await conversion.getByRole('alert').count() > 0 });
          await capture('conversion-destination');
        } else {
          await page.goto(origin + '/warehouse/fulfillment?tab=returns', { waitUntil: 'domcontentloaded', timeout: 120000 });
          const cases = page.getByRole('list', { name: 'Customer return cases' });
          await expect(cases).toBeVisible({ timeout: 90000 });
          await expect(cases.locator('a[href^="/warehouse/returns"],a[href^="/returns"]')).toHaveCount(0);
          const physicalContext = cases.getByText('Physical intake recorded. Warehouse returns team owns custody and inspection follow-up.', { exact: true }).first();
          await expect(physicalContext).toBeVisible();
          await physicalContext.scrollIntoViewIfNeeded();
          await capture('authorized-return-context');
        }
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.blockedWrites, []);
  result.complete = true;
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, complete: result.complete, blockedWrites: result.blockedWrites, errors: result.errors }));
}
