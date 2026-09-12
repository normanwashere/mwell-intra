import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const ts = require('typescript');
const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('audit.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ['pageAudit', 'auditKeyboardAndHotspots', 'routeReadinessSnapshot', 'describeRouteStructureProblems', 'waitForMeaningfulRoute'];
const definitions = names.map(name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert(node, `Missing actual audit helper ${name}`);
  return node.getText(ast);
});
const helpers = new Function(`${definitions.join('\n')}\nreturn {${names.join(',')}};`)();
const output = path.resolve('outputs/sep12-performance/live-mobile-recheck');
await mkdir(output, { recursive: true });
const report = { complete: false, startedAt: new Date().toISOString(), checks: [] };
await writeFile(path.join(output, 'results.json'), JSON.stringify(report));
let browser;
const origin = 'https://mwell-intra-uat.vercel.app';
const health = async () => {
  const response = await fetch(origin + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok);
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.deployment.appEnv, 'uat');
  assert.equal(data.deployment.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
  assert.equal(data.commit, process.env.PERF_EXPECTED_COMMIT);
  return data;
};
try {
  assert.equal(process.env.APP_ENV, 'uat');
  assert(process.env.AUDIT_PASSWORD);
  assert(/^[a-f0-9]{40}$/.test(process.env.PERF_EXPECTED_COMMIT ?? ''));
  report.health = await health();
  browser = await chromium.launch();
  for (const persona of auditPersonas('checkpoint-v1')) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    try {
      await page.goto(origin + '/login');
      await page.locator('#email').fill(persona.email);
      await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL(url => url.pathname !== '/login');
      await page.goto(origin + '/');
      await helpers.waitForMeaningfulRoute(page);
      const visual = await helpers.pageAudit(page);
      const hotspots = await helpers.auditKeyboardAndHotspots(page);
      const screenshot = `${persona.key ?? persona.email.split('@')[0]}-390-home.png`;
      await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
      report.checks.push({ role: persona.label ?? persona.email, route: '/', width: 390, visual, hotspots, screenshot });
      assert.equal(visual.horizontalOverflow, false, `${persona.email}: overflow`);
      assert.equal(hotspots.interceptedTargets.length, 0, `${persona.email}: unreachable controls`);
      assert.equal(hotspots.undersizedTargets.length, 0, `${persona.email}: undersized targets`);
      if (persona.kind === 'vendor') {
        await page.setViewportSize({ width: 320, height: 720 });
        await page.goto(origin + '/vendor');
        const link = page.locator('a[href^="/vendor/cases/"]').first();
        await expect(link).toBeVisible();
        await link.click();
        await helpers.waitForMeaningfulRoute(page);
        await expect(page.getByText('Action needed', { exact: false }).first()).toBeVisible();
        const vendorVisual = await helpers.pageAudit(page);
        await page.screenshot({ path: path.join(output, 'vendor-320-case.png'), fullPage: true });
        report.checks.push({ role: 'vendor', route: new URL(page.url()).pathname, width: 320, visual: vendorVisual, screenshot: 'vendor-320-case.png' });
        assert.equal(vendorVisual.horizontalOverflow, false, 'Vendor case status still overflows at 320px');
      }
    } finally { await context.close(); }
  }
  report.endHealth = await health();
  report.complete = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ complete: report.complete, checks: report.checks.length, error: report.error ?? null }));
