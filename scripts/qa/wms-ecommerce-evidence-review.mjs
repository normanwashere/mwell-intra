import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertHealth, isOwnLearningBootstrap, isReviewedReadRpc, TARGET, validateManifest } from './wms-ecommerce-signoff-live.mjs';
import { auditPersonas } from './uat-audit-identities.mjs';

const [attemptPath, ...extra] = process.argv.slice(2);
assert(attemptPath && !extra.length && process.env.AUDIT_PASSWORD, 'Usage: AUDIT_PASSWORD=... node wms-ecommerce-evidence-review.mjs COMPLETED_ATTEMPT');
const attempt = path.resolve(attemptPath);
const manifest = validateManifest(JSON.parse(await readFile(path.join(attempt, 'manifest.json'), 'utf8')));
const source = JSON.parse(await readFile(path.join(attempt, 'results.json'), 'utf8'));
assert.equal(source.runId, manifest.runId); assert.equal(source.commit, manifest.commit);
assert.equal(source.complete, true); assert.deepEqual(source.failures, []);
assert.equal(source.bindings.length, 2);
const health = async () => {
  const response = await fetch(`${TARGET.origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok); const body = await response.json(); assertHealth(body, manifest); return body;
};
const report = { kind: 'supplemental-ui-review', runId: manifest.runId, health: await health(),
  businessMutations: false, bootstrapCommands: [], screenshots: [], errors: [], complete: false };
const output = path.join(attempt, `evidence-review-${new Date().toISOString().replace(/[:.]/g, '-')}`); await mkdir(output);
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const browser = await chromium.launch();
try {
  for (const c of manifest.cases) {
    const binding = source.bindings.find(b => b.view === c.viewport);
    assert.equal(binding.reference, c.reference); assert.equal(binding.productId, c.productId);
    const mobile = c.viewport === 'mobile390';
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.errors.push(error.message));
    await context.route(`https://${TARGET.project}.supabase.co/rest/v1/**`, async route => {
      const r = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.continue();
      const name = new URL(r.url()).pathname.split('/').at(-1); const schema = r.headers()['content-profile'];
      if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/rest/v1/rpc/')) {
        if (isReviewedReadRpc(schema, name)) return route.continue();
        if (isOwnLearningBootstrap(schema, name, r.postDataJSON())) {
          report.bootstrapCommands.push({ schema, name, view: c.viewport, parameters: {} }); return route.continue();
        }
      }
      report.errors.push(`Blocked unexpected write ${schema}.${name}`); await route.abort();
    });
    await context.route(`https://${TARGET.project}.supabase.co/storage/v1/**`, async route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      const request = route.request(); const pathname = decodeURIComponent(new URL(request.url()).pathname);
      const proof = source.privateStorageEvidence.find(item => item.view === c.viewport && item.orderId === binding.orderId);
      // A signed download URL is requested with POST but does not change the object.
      if (request.method() === 'POST' && proof && pathname === `/storage/v1/object/sign/evidence/${proof.path}`) return route.continue();
      report.errors.push(`Blocked unexpected Storage write ${request.method()} ${pathname}`); await route.abort();
    });
    try {
      const persona = auditPersonas('checkpoint-v1').find(p => p.role === 'operations_lead');
      await page.goto(`${TARGET.origin}/login?redirect=%2Fwarehouse%2Ffulfillment`);
      await page.locator('#email').fill(persona.email); await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click(); await page.waitForURL(url => url.pathname !== '/login');
      await page.goto(`${TARGET.origin}/warehouse/fulfillment?tab=orders&status=all&q=${encodeURIComponent(c.reference)}`);
      const card = page.getByRole('listitem', { name: `Order ${c.reference}`, exact: true });
      await expect(card.getByText('Completed', { exact: true })).toBeVisible();
      await card.getByRole('button', { name: 'View order details', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Order details / ${c.reference}`, exact: true });
      const save = async name => {
        await health();
        const ref = `${c.viewport}-${name}.png`;
        await page.screenshot({ path: path.join(output, ref), animations: 'disabled' });
        report.screenshots.push({ ref, view: c.viewport, orderId: binding.orderId, role: 'operations_lead', reviewed: false });
      };
      await save('summary');
      const region = dialog.getByRole('region', { name: 'Proof of delivery', exact: true });
      const image = region.getByRole('img', { name: 'Evidence', exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
      await expect(image).toBeInViewport();
      await save('proof');
      await region.getByRole('button', { name: 'View evidence photo', exact: true }).click();
      const lightbox = page.getByRole('dialog', { name: 'Evidence photo', exact: true });
      await expect(lightbox.getByRole('img', { name: 'Evidence', exact: true })).toBeInViewport();
      await save('proof-expanded');
      await lightbox.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(lightbox).not.toBeVisible();
      await dialog.getByRole('heading', { name: 'Shipment timeline', exact: true }).scrollIntoViewIfNeeded();
      await save('timeline');
      await dialog.getByRole('heading', { name: 'Shipment timeline', exact: true }).locator('..').getByText('Delivered', { exact: true }).scrollIntoViewIfNeeded();
      await save('timeline-delivered');
      await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []); report.complete = true;
} catch (error) {
  report.errors.push(String(error.message).replaceAll(process.env.AUDIT_PASSWORD, '[REDACTED]')); process.exitCode = 1;
} finally {
  await browser.close(); report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, complete: report.complete, screenshots: report.screenshots.length, errors: report.errors }));
}
