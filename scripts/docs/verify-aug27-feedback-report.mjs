import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'apps/shell/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(root, 'docs/audits/2026-08-28-AUG27-WMS-REMEDIATION.html')).href);
  await page.getByRole('heading', { name: 'Response to August 27 Warehouse Feedback' }).waitFor();
  await page.getByLabel('Search this response').fill('quarantine');
  assert.ok(await page.locator('mark').count() > 0);
  await page.getByLabel('Search this response').fill('not-a-real-result');
  assert.equal(await page.getByRole('status').textContent(), '0 matches');
  await page.getByLabel('Search this response').clear();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(root, `docs/evidence/2026-08-28-aug27-remediation/report-${width}.png`) });
  }
  const evidence = page.locator('.evidence');
  assert.ok(await evidence.count() >= 10, 'Report must include actual desktop/mobile control evidence.');
  for (let index = 0; index < await evidence.count(); index++) {
    const button = evidence.nth(index);
    await button.scrollIntoViewIfNeeded();
    const img = button.locator('img');
    await img.evaluate((element) => element.decode());
    assert.ok(await img.evaluate((element) => element.naturalWidth > 0));
  }
  await evidence.first().click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const lastLink = page.getByRole('navigation').getByRole('link').last();
  const href = await lastLink.getAttribute('href');
  await lastLink.click();
  assert.ok(page.url().endsWith(href));
  assert.deepEqual(errors, []);
  console.log('Report verified: 1440/1920 desktop, search, navigation, all embedded images, enlargement, Escape, no runtime errors.');
} finally {
  await browser.close();
}
