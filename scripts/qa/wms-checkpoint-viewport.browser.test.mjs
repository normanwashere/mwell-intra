import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureCheckpointViewport } from './wms-ecommerce-signoff-live.mjs';

test('checkpoint screenshots preserve the viewport even with a very tall queue', async () => {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  const folder = await mkdtemp(path.join(tmpdir(), 'wms-checkpoint-viewport-'));
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const mobile = viewport.width === 390;
      const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile });
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main style="height:66847px;background:#edf4fa"><h1>Working queue</h1><button>Review order</button></main>');
      const file = path.join(folder, `${viewport.width}.png`);
      const geometry = await captureCheckpointViewport(page, file);
      const bytes = await readFile(file);
      assert.equal(bytes.readUInt32BE(16), viewport.width);
      assert.equal(bytes.readUInt32BE(20), viewport.height);
      assert.deepEqual(geometry, { ...viewport, contentWidth: viewport.width });
      await page.close();
    }
  } finally { await browser.close(); }
});
