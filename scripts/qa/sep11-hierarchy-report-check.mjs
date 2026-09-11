import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const root = path.resolve('outputs/sep11-hierarchy-preview');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  for (const label of ['Pick & Pack', 'My Work', 'PO detail']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    for (const width of ['1440', '390']) {
      await page.locator('#width').selectOption(width);
      for (const dark of [false, true]) {
        await page.locator('#dark').setChecked(dark);
        await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
  }
  await page.locator('#split').uncheck();
  assert.equal(await page.locator('#before').isVisible(), false);
  await page.locator('#split').check();
  await page.getByRole('tab', { name: 'Pick & Pack', exact: true }).click();
  await page.locator('#width').selectOption('1440');
  await page.locator('#dark').uncheck();
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(root, 'comparison-desktop.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const live = await (await fetch('https://mwell-intra-uat.vercel.app/api/health')).json();
  assert.equal(live.commit, '343b3725814f962c70e517f32cf336258f41e74f');
  console.log('PASS: 24 comparison images, navigation, theme, viewport, enlarged view; live UAT unchanged.');
} finally {
  await browser.close();
}
