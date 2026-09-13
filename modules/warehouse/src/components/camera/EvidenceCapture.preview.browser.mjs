// Offline real-component regression: no app server, credentials, or backend traffic.
/* global document, getComputedStyle, window */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const output = path.join(root, 'outputs/evidence-capture-preview', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const entry = `
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {Sheet} from '@intra/ui';
  import {EvidenceCapture} from './src/components/camera/EvidenceCapture';
  window.fixture={changes:0,submits:0};
  function App() {
    const [open,setOpen]=useState(false);
    const [urls,setUrls]=useState([]);
    return <><button onClick={()=>setOpen(true)}>Inspect synthetic receipt</button>
      <Sheet open={open} onOpenChange={setOpen} title="Inspection">
        <form className="space-y-4" onSubmit={e=>{e.preventDefault();window.fixture.submits++;}}>
          <EvidenceCapture reference="offline-preview-only" value={urls}
            onChange={next=>{window.fixture.changes++;setUrls(next);}} />
          <button type="submit" className="btn-primary">Submit inspection</button>
        </form>
      </Sheet></>;
  }
  createRoot(document.getElementById('root')).render(<App />);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: path.join(root, 'modules/warehouse'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'modules/warehouse/src'),
    react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
  plugins: [{ name: 'offline-session', setup(build) {
    build.onResolve({ filter: /^@intra\/auth$/ }, () => ({ path: 'session', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
      'export const useSession=()=>({mode:"memory",supabaseClient:null,profile:null});', loader: 'js' }));
  } }],
});
const css = await postcss([tailwind({
  presets: [require('@intra/config/tailwind/preset')],
  content: [
    { raw: entry, extension: 'tsx' },
    path.join(root, 'modules/warehouse/src/components/camera/EvidenceCapture.tsx'),
    path.join(root, 'modules/warehouse/src/components/EvidenceGallery.tsx'),
    path.join(root, 'packages/ui/src/**/*.{ts,tsx}'),
  ],
})]).process(
  await readFile(path.join(root, 'packages/ui/src/styles.css'), 'utf8') + '\n' +
  await readFile(path.join(root, 'apps/shell/app/globals.css'), 'utf8'),
  { from: undefined },
);
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      hasTouch: width === 390, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const traffic = []; const errors = []; const advisories = [];
    await context.route('**/*', route => { traffic.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'warning' && message.text() === 'You have Reduced Motion enabled on your device. Animations may not appear as expected.. For more information and steps for solving, visit https://motion.dev/troubleshooting/reduced-motion-disabled') {
        advisories.push('Framer Motion reduced-motion development notice');
      } else if (['warning', 'error'].includes(message.type())) errors.push(message.text());
    });
    try {
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const opener = page.getByRole('button', { name: 'Inspect synthetic receipt' });
      await opener.click();
      const sheet = page.getByRole('dialog', { name: 'Inspection', exact: true });
      for (const shape of ['portrait', 'landscape']) {
        const png = await page.evaluate(shape => {
          const canvas = document.createElement('canvas');
          canvas.width = shape === 'portrait' ? 600 : 900;
          canvas.height = shape === 'portrait' ? 900 : 500;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#075b46'; ctx.lineWidth = 12; ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
          ctx.fillStyle = '#172121'; ctx.font = '30px sans-serif';
          ctx.fillText('SYNTHETIC INSPECTION', 28, 60);
          ctx.fillText('Whole document preview', 28, 120);
          ctx.fillText('TOP', 28, 175);
          ctx.fillText('BOTTOM - must remain visible', 28, canvas.height - 40);
          return canvas.toDataURL('image/png').split(',')[1];
        }, shape);
        await sheet.getByLabel('Capture photo evidence', { exact: true }).setInputFiles({
          name: `${shape}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
        });
        const trigger = sheet.getByRole('button', { name: /view.*evidence photo/i });
        await expect(trigger).toBeEnabled();
        const thumb = trigger.getByRole('img');
        await expect(thumb).toHaveJSProperty('complete', true);
        expect(await thumb.evaluate(img => getComputedStyle(img).objectFit)).toBe('contain');
        const box = await trigger.boundingBox();
        assert(box && box.width >= 44 && Math.abs(box.width - box.height) <= 1);
        await page.screenshot({ path: path.join(output, `${width}-${shape}-thumbnail.png`) });
        for (const dismissal of ['escape', 'close', 'backdrop']) {
          if (width === 390) await trigger.tap();
          else { await trigger.focus(); await page.keyboard.press('Enter'); }
          const modal = page.getByRole('dialog', { name: 'Evidence photo', exact: true });
          const close = modal.getByRole('button', { name: 'Close', exact: true });
          await expect(close).toBeFocused();
          await page.keyboard.press('Tab'); await expect(close).toBeFocused();
          await page.keyboard.press('Shift+Tab'); await expect(close).toBeFocused();
          const image = modal.getByRole('img');
          await expect(image).toHaveJSProperty('complete', true);
          assert(await image.evaluate(img => img.naturalWidth > 0 && getComputedStyle(img).objectFit === 'contain'));
          const bounds = await image.boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901);
          await image.click(); await expect(modal).toBeVisible();
          if (dismissal === 'escape') {
            await page.screenshot({ path: path.join(output, `${width}-${shape}-fullsize.png`) });
            await page.keyboard.press('Escape');
          } else if (dismissal === 'close') await close.click();
          else await modal.getByTestId('evidence-lightbox-backdrop').click({ position: { x: 2, y: 2 } });
          await expect(modal).toHaveCount(0);
          await expect(sheet).toBeVisible(); await expect(trigger).toBeFocused();
        }
        assert.equal(await page.evaluate(() => window.fixture.submits), 0);
        await sheet.getByRole('button', { name: 'Remove photo' }).click();
        await expect(trigger).toHaveCount(0);
        results.push({ width, shape, passed: true, mode: 'offline-memory', privateTransport: 'covered separately by unit tests', advisories });
      }
      assert.equal(await page.evaluate(() => window.fixture.changes), 4);
      await page.keyboard.press('Escape'); await expect(sheet).toHaveCount(0); await expect(opener).toBeFocused();
      assert.deepEqual(traffic, [], 'No network requests allowed');
      assert.deepEqual(errors, [], 'No browser errors or warnings allowed');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, liveActions: false }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, results }));
