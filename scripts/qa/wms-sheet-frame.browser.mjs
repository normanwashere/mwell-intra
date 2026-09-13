// Offline shared-Sheet regression. Real components/styles; no backend or business commands.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss'), tailwind = require('tailwindcss');
const output = path.join(root, 'outputs/wms-signoff/sheet-frame', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const entry = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {Sheet, MotionProvider} from '@intra/ui';
function App(){const [open,setOpen]=useState(false);return <MotionProvider>
<button onClick={()=>setOpen(true)}>Open review</button><a href="#outside">Outside</a>
<Sheet open={open} onOpenChange={setOpen} side={window.fixtureSide} title="Review warehouse record"
description="Review the record and its supporting evidence before continuing."
footer={<button type="button" disabled className="btn-primary">Save record</button>}>
{Array.from({length:14},(_,i)=><label key={i} className="mb-4 block">Field {i+1}<input className="input mt-2" /></label>)}
</Sheet></MotionProvider>};createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: path.join(root, 'apps/shell'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.css': 'empty' },
  alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } });
let source = '';
for (const file of ['packages/ui/src/styles.css', 'apps/shell/app/globals.css', 'apps/shell/app/hierarchy-preview.css']) {
  source += `${await readFile(path.join(root, file), 'utf8')}\n`;
}
const css = await postcss([tailwind({ presets: [require('@intra/config/tailwind/preset')], content: [
  { raw: entry, extension: 'tsx' }, path.join(root, 'packages/ui/src/**/*.{ts,tsx}'),
] })]).process(source, { from: undefined });
const report = { complete: false, offlineOnly: true, fontMode: 'system-fallback', network: [], errors: [], cases: [] };
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 720]]) {
    for (const side of ['adaptive', 'bottom', 'right', 'center']) for (const motion of ['reduce', 'no-preference']) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.25,
        isMobile: width < 768, hasTouch: width < 768, reducedMotion: motion, serviceWorkers: 'block' });
      const result = { width, height, side, motion, complete: false, checkpoints: [], screenshots: [] };
      report.cases.push(result);
      try {
        await context.route('**/*', route => { report.network.push({ method: route.request().method() }); return route.abort(); });
        const page = await context.newPage(); page.on('pageerror', () => report.errors.push({ side, width, motion }));
        await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
        await page.evaluate(side => { window.fixtureSide = side; }, side);
        await page.addStyleTag({ content: css.css + '\n:root{--font-poppins:Arial;--font-jbmono:monospace}' });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const opener = page.getByRole('button', { name: 'Open review', exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Review warehouse record', exact: true });
        await expect(dialog.getByLabel('Field 1', { exact: true })).toBeFocused();
        const check = async stage => {
          await expect.poll(() => dialog.evaluate(el => {
            const d=el.getBoundingClientRect(), h=el.querySelector('.intra-sheet-header').getBoundingClientRect(),
              f=el.querySelector('.intra-sheet-footer').getBoundingClientRect();
            return el.scrollTop === 0 && h.top >= d.top-1 && f.bottom <= d.bottom+1 && h.top >= -1 && f.bottom <= innerHeight+1;
          })).toBe(true);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Focus escaped');
          result.checkpoints.push(stage);
        };
        await check('opened');
        for (const number of [14, 1, 8]) {
          const field = dialog.getByLabel(`Field ${number}`, { exact: true });
          await field.evaluate(el => el.scrollIntoView({ block: 'center' }));
          await field.focus();
          await check(`center-field-${number}`);
          await expect(field).toBeInViewport();
        }
        for (let i=0;i<20;i++) { await page.keyboard.press('Tab'); await check(`tab-${i}`); }
        await expect(dialog.getByRole('button', { name: 'Save record', exact: true })).toBeDisabled();
        const body = dialog.getByRole('region', { name: 'Review warehouse record content', exact: true });
        assert(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'Long body must remain scrollable');
        if (motion === 'reduce') {
          const ref=`${width}-${side}.png`, bytes=await page.screenshot({path:path.join(output,ref),animations:'disabled'});
          result.screenshots.push({ref,sha256:createHash('sha256').update(bytes).digest('hex'),visuallyReviewed:false});
        }
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        result.checkpoints.push('escape-restores-focus');
        await opener.click(); await dialog.getByRole('button',{name:'Close',exact:true}).click();
        await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        result.checkpoints.push('close-restores-focus');
        result.complete=true;
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.network,[]); assert.deepEqual(report.errors,[]); report.complete=true;
} finally {
  await browser.close(); await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
}
console.log(JSON.stringify({output,complete:report.complete,cases:report.cases.length}));
