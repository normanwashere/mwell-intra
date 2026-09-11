import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const origin = 'https://mwell-intra-uat.vercel.app';
const run = process.env.PERF_RUN;
assert(run && /^[a-z0-9-]+$/.test(run), 'Provide PERF_RUN');
assert(process.env.AUDIT_PASSWORD, 'Provide AUDIT_PASSWORD');
const health = await (await fetch(`${origin}/api/health`, { cache: 'no-store' })).json();
assert.equal(health.deployment?.appEnv, 'uat');
assert.equal(health.deployment?.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
const output = path.resolve('outputs/sep12-performance', run);
await mkdir(output, { recursive: true });
const routes = {
  platform_administrator: ['/', '/admin/users', '/admin/audit'],
  general_employee: ['/work', '/procurement/requests', '/knowledge'],
  operations_associate: ['/warehouse', '/warehouse/inventory', '/warehouse/receiving', '/warehouse/fulfillment?tab=orders&filter=floor_work'],
  operations_lead: ['/warehouse/approvals', '/warehouse/quality', '/warehouse/returns'],
  procurement_lead: ['/procurement/requests', '/procurement/purchase-orders', '/warehouse/purchase-orders'],
  finance_controller: ['/finance', '/warehouse/pricing', '/work'],
  legal_compliance_lead: ['/legal/cases', '/legal/cases?view=lifecycle', '/work'],
  marketing_events_lead: ['/events', '/warehouse/fulfillment?tab=requests', '/warehouse/inventory'],
  product_owner: ['/product', '/work', '/knowledge'],
  leadership_insights: ['/insights/finance', '/warehouse/reports', '/warehouse/data'],
  vendor_representative: ['/vendor', '/vendor/purchase-orders'],
};
const browser = await chromium.launch();
const results = [], logins = [];
const persist = () => writeFile(path.join(output, 'results.json'), JSON.stringify({ origin, health, run,
  methodology: 'Sequential real Chromium navigations; default 3 desktop samples and 1 mobile sample per route. Browser cache enabled, no CPU/network throttling. Capture starts with the destination document request, excluding outgoing-page requests. Ready means visible content plus 400 ms without foreground same-origin or Supabase requests. Explicit Next.js prefetches are recorded separately; cancelled prefetches are not foreground failures. Long-task time is a lab diagnostic, not field INP. Small-sample maxima are not p95 capacity certification.', results, logins }, null, 2));
try {
  for (const persona of CURRENT_LIVE_ROLES) {
    if (process.env.PERF_ROLES && !process.env.PERF_ROLES.split(',').includes(persona.role)) continue;
    console.log(`PERF ${run} ${persona.role}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.__perf = { lcp: null, cls: 0, longTaskMs: 0 };
      for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
        try { new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'largest-contentful-paint') window.__perf.lcp = entry.startTime;
            if (type === 'layout-shift' && !entry.hadRecentInput) window.__perf.cls += entry.value;
            if (type === 'longtask') window.__perf.longTaskMs += Math.max(0, entry.duration - 50);
          }
        }).observe({ type, buffered: true }); } catch { /* Browser support varies. */ }
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let active = null;
    const requests = new Map();
    page.on('request', req => {
      if (active && req.isNavigationRequest() && req.frame() === page.mainFrame() && req.resourceType() === 'document') active.capturing = true;
      if (!active?.capturing) return;
      if (active && (new URL(req.url()).hostname === 'kkoitlvydytdhlpxhuah.supabase.co' || new URL(req.url()).origin === origin)) {
        const headers = req.headers();
        const background = Boolean(headers['next-router-prefetch'] || headers['next-router-segment-prefetch'] || headers.purpose === 'prefetch');
        requests.set(req, { row: active, started: performance.now(), background });
        if (!background) { active.pending++; active.lastNetwork = performance.now(); }
      }
    });
    const finish = async req => {
      const record = requests.get(req);
      if (!record) return;
      requests.delete(req);
      const response = await req.response().catch(() => null);
      const sizes = await req.sizes().catch(() => null);
      record.row.requests.push({ path: new URL(req.url()).pathname, host: new URL(req.url()).hostname, background: record.background, type: req.resourceType(), method: req.method(), timing: req.timing(),
        status: response?.status() ?? null, ms: Math.round(performance.now() - record.started),
        bytes: sizes?.responseBodySize ?? null, failure: req.failure()?.errorText ?? null });
      if (!record.background) { record.row.pending--; record.row.lastNetwork = performance.now(); }
    };
    page.on('requestfinished', finish);
    page.on('requestfailed', finish);
    page.on('pageerror', error => active?.errors.push(error.message));
    try {
      await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.locator('#email').fill(persona.email);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      const loginStart = performance.now();
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login', { timeout: 90000, waitUntil: 'domcontentloaded' });
      await page.locator('main h1:visible,main h2:visible').first().waitFor();
      logins.push({ role: persona.role, ms: Math.round(performance.now() - loginStart), passed: true });
      const roleRoutes = process.env.PERF_INCLUDE_KB ? [...new Set([...routes[persona.role], '/knowledge'])] : routes[persona.role];
      for (const [index, route] of roleRoutes.entries()) {
        if (process.env.PERF_ROUTE && !process.env.PERF_ROUTE.split(',').some(prefix => route.startsWith(prefix))) continue;
        for (const [width, samples] of [[1440, Number(process.env.PERF_DESKTOP_SAMPLES ?? 3)], [390, 1]]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          for (let sample = 0; sample < samples; sample++) {
            // Finish the outgoing page before measuring the destination; retain context cookies/cache.
            await page.goto('about:blank');
            const row = { role: persona.role, route, width, sample, requests: [], errors: [], pending: 0, lastNetwork: 0 };
            results.push(row); active = row;
            const started = performance.now();
            try {
              await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 90000 });
              await page.locator('main h1:visible,main h2:visible').first().waitFor();
              row.headingMs = Math.round(performance.now() - started);
              while (performance.now() - started < 35000 && (row.pending > 0 || performance.now() - row.lastNetwork < 400)) await page.waitForTimeout(100);
              assert.equal(row.pending, 0, 'Backend requests did not settle');
              row.readyMs = Math.round(performance.now() - started);
              row.metrics = await page.evaluate(() => {
                const navigation = performance.getEntriesByType('navigation')[0];
                return { ...window.__perf, ttfb: navigation.responseStart, domContentLoaded: navigation.domContentLoadedEventEnd,
                  transferredBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0),
                  resources: performance.getEntriesByType('resource').map(entry => ({ name: new URL(entry.name).pathname, duration: entry.duration, bytes: entry.encodedBodySize })),
                  domNodes: document.querySelectorAll('*').length, overflow: document.documentElement.scrollWidth - innerWidth };
              });
              row.heading = await page.locator('main h1:visible,main h2:visible').first().innerText();
              row.notices = await page.locator('[role=alert]:visible').allTextContents();
              assert(!new URL(page.url()).pathname.startsWith('/login'), 'Session lost');
              assert(!/^Access denied|No .* access$/i.test(row.heading), 'Unexpected access denial');
              row.passed = row.errors.length === 0 && !row.requests.some(req => req.status >= 400 || (req.failure && !(req.background && req.failure === 'net::ERR_ABORTED')));
              if (sample === 0) {
                row.screenshot = `${persona.role}-${index}-${width}.png`;
                await page.screenshot({ path: path.join(output, row.screenshot), animations: 'disabled' });
              }
            } catch (error) { row.passed = false; row.error = error.message; }
            finally { active = null; delete row.pending; delete row.lastNetwork; delete row.capturing; await persist(); }
          }
        }
      }
    } catch (error) { logins.push({ role: persona.role, passed: false, error: error.message }); }
    finally { active = null; await context.close(); await persist(); }
  }
} finally { await browser.close(); await persist(); }
console.log(JSON.stringify({ navigations: results.length, failures: results.filter(row => !row.passed).length, logins: logins.length, output }));
assert(logins.length > 0 && logins.every(row => row.passed), 'Role login failed');
assert(results.length > 0 && results.every(row => row.passed), 'Some screen measurements failed');
