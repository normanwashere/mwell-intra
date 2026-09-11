import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = process.env.AUDIT_ORIGIN ?? 'http://localhost:3022';
assert(['http://localhost:3022', 'https://mwell-intra-uat.vercel.app'].includes(origin), 'Only the local UAT preview or live UAT may be audited');
assert(process.env.AUDIT_PASSWORD, 'Supply the test password in the process environment');
const health = await (await fetch(origin + '/api/health', {cache:'no-store'})).json();
assert.equal(health.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
if (origin.startsWith('https:')) {
  assert(process.env.AUDIT_EXPECTED_SHA, 'Live validation requires the exact release commit');
  assert.equal(health.commit, process.env.AUDIT_EXPECTED_SHA);
  assert.equal(health.deployment.appEnv, 'uat');
}
const run = process.env.AUDIT_RUN ?? 'screens';
assert(/^[a-z0-9-]+$/.test(run));
const output = path.resolve('outputs/sep11-app-layout', run);
await mkdir(output, { recursive: true });
const routes = {
  platform_administrator: ['/', '/admin', '/admin/users', '/admin/audit', '/admin/doa', '/admin/departments'],
  general_employee: ['/', '/work', '/procurement/requests', '/procurement/requests/new'],
  operations_associate: ['/warehouse', '/warehouse/receiving', '/warehouse/inventory', '/warehouse/fulfillment?tab=orders&filter=floor_work', '/warehouse/storage', '/warehouse/returns', '/warehouse/scan', '/warehouse/cycle-counts', '/warehouse/tasks'],
  operations_lead: ['/warehouse/approvals', '/warehouse/quality', '/warehouse/locations', '/warehouse/operation-routes', '/warehouse/exceptions', '/procurement/approvals', '/product'],
  procurement_lead: ['/procurement/requests', '/procurement/purchase-orders', '/warehouse/purchase-orders', '/warehouse/suppliers', '/warehouse/procurement'],
  finance_controller: ['/finance', '/warehouse/pricing', '/procurement/purchase-orders/HANDBOOK-T7-R1-PO?section=payment&from=finance'],
  legal_compliance_lead: ['/legal/cases', '/legal/cases?view=lifecycle', '/legal/invites/new'],
  marketing_events_lead: ['/events', '/warehouse/fulfillment?tab=requests', '/warehouse/inventory'],
  product_owner: ['/product'],
  leadership_insights: ['/insights/finance', '/warehouse/data', '/warehouse/reports'],
  vendor_representative: ['/vendor', '/vendor/purchase-orders'],
};
for (const [role, paths] of Object.entries(routes)) {
  if (role !== 'vendor_representative' && !paths.includes('/work')) paths.push('/work');
}
const readRpcs = new Set(['my_capability_snapshot','my_learning_snapshot','commitment_readiness','department_request_actor_names','platform_finance_page','platform_finance_totals','platform_close_sources','platform_close_evidence_options','platform_followup_page','acceptance_work_items','payment_readiness_staleness_work_items','purchase_order_closure_work_items','purchase_order_lifecycle','purchase_order_receipt_status','review_open_purchase_orders','platform_user_directory','list_rbac_catalog','list_departments','get_effective_policy_profile']);
readRpcs.add('get_latest_request_draft');
for (const name of ['list_stock_change_requests','payment_evidence_options','purchase_order_amendment_work_items','request_decision_eligibility','vendor_purchase_order_acknowledgements']) readRpcs.add(name);
const results = [], blocked = [], bootstrap = [];
const browser = await chromium.launch();
try {
  for (const persona of CURRENT_LIVE_ROLES) {
    if (process.env.AUDIT_ROLES && !process.env.AUDIT_ROLES.split(',').includes(persona.role)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname === 'kkoitlvydytdhlpxhuah.supabase.co' && req.method() === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/')) return route.continue();
      // Normal page initialization may synchronize assignments and already-earned
      // shared orientation records. Never allow assessment or business commands.
      if (process.env.AUDIT_NORMAL_BOOTSTRAP === '1' && url.hostname === 'kkoitlvydytdhlpxhuah.supabase.co' && url.pathname === '/rest/v1/rpc/resolve_assignments') {
        bootstrap.push({ role:persona.role, path:url.pathname });
        return route.continue();
      }
      if (['GET','HEAD','OPTIONS'].includes(req.method()) || (url.hostname === 'kkoitlvydytdhlpxhuah.supabase.co' && (url.pathname === '/auth/v1/token' || (url.pathname.startsWith('/rest/v1/rpc/') && readRpcs.has(url.pathname.split('/').at(-1)))))) return route.continue();
      blocked.push({ role: persona.role, path: url.pathname, method: req.method() });
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    try {
      await page.goto(origin + '/login', { timeout: 120000 });
      await page.locator('#email').fill(persona.email);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login', { timeout: 120000, waitUntil: 'domcontentloaded' });
      for (const [index, route] of routes[persona.role].entries()) for (const width of [1440, 390]) {
        const row = { role: persona.role, route, width, errors: [] };
        const blockedBefore = blocked.length;
        results.push(row);
        const onError = error => row.errors.push(error.message);
        page.on('pageerror', onError);
        try {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.goto(origin + route, { timeout: 120000, waitUntil: 'domcontentloaded' });
          await page.locator('main h1:visible,main h2:visible,[role=alert]:visible').first().waitFor();
          await page.locator('[aria-busy=true]:visible').first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
          await page.locator('main h1:visible,main h2:visible').first().waitFor();
          await page.waitForTimeout(650);
          row.url = page.url();
          row.headings = await page.locator('main h1:visible,main h2:visible').allTextContents();
          row.dom = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - innerWidth,
            headers: [...document.querySelectorAll('[data-workspace-header]')].map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent, x: r.x, width: r.width, height: r.height }; }),
            controls: [...document.querySelectorAll('main button,main a[href],main input,main select')].filter(el => el.getBoundingClientRect().height > 0).map(el => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || el.textContent || el.id, x:r.x,y:r.y,width:r.width,height:r.height }; }),
          }));
          row.blockedRequests = blocked.slice(blockedBefore);
          row.notices = await page.locator('[role=status]:visible,[role=alert]:visible').allTextContents();
          row.screenshot = `${persona.role}-${index}-${width}.png`;
          await page.screenshot({ path: path.join(output, row.screenshot), animations: 'disabled' });
          assert(row.headings.length, 'No content heading');
          assert(!new URL(row.url).pathname.startsWith('/login'), 'Session lost');
          assert(!/^Access denied|No (?:warehouse|procurement|legal|admin) access/m.test(await page.locator('body').innerText()), 'Unexpected access denial');
          assert(row.dom.overflow <= 1, 'Document horizontal overflow');
          for (const h of row.dom.headers) assert(h.x >= 0 && h.x + h.width <= width + 1, 'Header exceeds viewport');
          assert.deepEqual(row.errors, []);
          assert.deepEqual(row.blockedRequests, [], 'The harness blocked a page request; this is not a clean screen check');
          if (route === '/events' && width === 1440) {
            const tracks = await page.locator('section[aria-labelledby="event-list-title"] .card').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
            assert.equal(tracks, 3, 'Events desktop row utilities were not generated');
          }
          if (route === '/work') {
            row.interactions = [];
            for (const [view, label] of [['waiting','Waiting on someone else'], ['completed','Recently completed'], ['action','Needs your action']]) {
              await page.getByRole('button', { name: new RegExp(label) }).click();
              assert.equal(new URL(page.url()).searchParams.get('view'), view === 'action' ? null : view);
              await page.getByText('Loading request tracking...', { exact: true }).waitFor({ state:'hidden' });
              assert.equal(await page.getByText('Some tracking records could not be loaded.', { exact:true }).count(), 0, 'Tracking source failed');
              await page.getByRole('searchbox', {name:'Search work'}).fill('NO-MATCH-UX-CHECK');
              await page.getByRole('searchbox', {name:'Search work'}).fill('');
              const screenshot = `${persona.role}-work-${view}-${width}.png`;
              await page.screenshot({ path:path.join(output,screenshot),animations:'disabled' });
              row.interactions.push({ view, screenshot });
            }
            await page.goBack();
            assert.equal(new URL(page.url()).searchParams.get('view'),'completed','Back restores view');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1,true);
          }
          assert.deepEqual(row.errors, [], 'No interaction errors');
          assert.deepEqual(blocked.slice(blockedBefore), [], 'No requests blocked during interaction');
          row.passed = true;
        } catch (error) { row.passed = false; row.error = error.message; }
        finally {
          page.off('pageerror', onError);
          await writeFile(path.join(output, 'results.json'), JSON.stringify({ health, origin, results, blocked, bootstrap }, null, 2));
        }
      }
    } catch (error) { results.push({ role: persona.role, passed: false, error: error.message, phase:'login' }); }
    finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ health, origin, results, blocked, bootstrap }, null, 2));
}
console.log(JSON.stringify({ screens: results.length, passed: results.filter(r=>r.passed).length, failed:results.filter(r=>!r.passed).map(({role,route,width,error})=>({role,route,width,error})) }));
if (results.some(row => !row.passed)) process.exitCode=1;
