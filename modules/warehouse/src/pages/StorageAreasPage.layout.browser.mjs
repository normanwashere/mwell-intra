// Offline real-component layout regression. No app server, auth or backend calls.
/* global document, window, getComputedStyle, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss'), tailwind = require('tailwindcss');
const output = path.join(root, 'outputs/wms-signoff/storage-area-layout', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const runId = '4f486cb0-035c-4599-9a6b-bece2440ebc8';
const fixtures = [
  { id: 'destination', code: `DEST-${runId}-desktop1440`, label: `Synthetic inbound signoff ${runId} desktop1440`, zone: runId },
  { id: 'quarantine', code: `QC-${runId}-mobile390`, label: `Synthetic inbound signoff ${runId} mobile390`, zone: runId },
  { id: 'short', code: 'A-01', label: 'General stock', zone: '' },
  { id: 'unbroken', code: 'X'.repeat(96), label: 'LongLabel'.repeat(12), zone: 'LongZone'.repeat(12) },
];
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import {ToastProvider} from '@intra/ui';
  import {buildSeed} from '../../packages/data-kit/src/seed';
  import {StorageAreasPage} from './src/pages/StorageAreasPage';
  const data=buildSeed();
  data.locations=[{id:'offline-wh',name:'Offline layout fixture',type:'warehouse',active:true}];
  data.storageAreas=${JSON.stringify(fixtures)}.map(b=>({...b,locationId:'offline-wh',active:true}));
  data.stockLevels=[{productId:'shirt-l',locationId:'offline-wh',binId:'destination',quantity:7}];
  data.units=[];
  const mutation=name=>(...args)=>{window.fixture.mutations.push(name);throw new Error('No mutations in visual fixture');};
  window.fixture={mutations:[],warehouse:{data,can:()=>true,
    createStorageArea:mutation('create'),updateStorageArea:mutation('update'),deleteStorageArea:mutation('delete'),relocate:mutation('relocate'),
    loadWarehouseTasks:async()=>({rows:[]}),loadQualityInspections:async()=>({rows:[]}),loadInventoryPositions:async()=>({rows:[]})}};
  createRoot(document.getElementById('root')).render(<MemoryRouter><ToastProvider>
    <main className="mx-auto max-w-[1152px] p-4 sm:p-6"><StorageAreasPage /></main>
  </ToastProvider></MemoryRouter>);
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: path.join(root, 'modules/warehouse'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'modules/warehouse/src'), react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
  plugins: [{ name: 'offline-warehouse', setup(build) {
    build.onResolve({ filter: /^@\/app\/store$/ }, () => ({ path: 'warehouse', namespace: 'fixture' }));
    build.onResolve({ filter: /^(@intra\/auth|@\/auth\/session)$/ }, () => ({ path: 'session', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'warehouse'
      ? 'export const useWarehouse=()=>window.fixture.warehouse;'
      : 'export const useSession=()=>({mode:"memory",supabaseClient:null,profile:null});' }));
  } }],
});
const css = await postcss([tailwind({ presets: [require('@intra/config/tailwind/preset')], content: [
  { raw: entry, extension: 'tsx' }, path.join(root, 'modules/warehouse/src/pages/StorageAreasPage.tsx'),
  path.join(root, 'packages/ui/src/**/*.{ts,tsx}'),
] })]).process(await readFile(path.join(root, 'packages/ui/src/styles.css'), 'utf8') + '\n'
  + await readFile(path.join(root, 'apps/shell/app/globals.css'), 'utf8'), { from: undefined });
let fontCss = ':root{--font-poppins:Arial;--font-jbmono:monospace}', fontMode = 'system-fallback', fontSourceSha256;
// Optional cached Next font CSS gives screenshot parity without a server or network.
if (process.env.WMS_STORAGE_LAYOUT_FONT_CSS) {
  const file = path.resolve(process.env.WMS_STORAGE_LAYOUT_FONT_CSS);
  const source = await readFile(file);
  fontSourceSha256 = createHash('sha256').update(source).digest('hex');
  const faces = []; postcss.parse(source.toString()).walkAtRules('font-face', rule => faces.push(rule.clone()));
  const families = new Set();
  for (const face of faces) {
    const family = face.nodes.find(n => n.prop === 'font-family')?.value;
    if (!['Poppins', 'JetBrains Mono'].includes(family)) continue;
    const src = face.nodes.find(n => n.prop === 'src');
    const relative = /^url\("(\.\.\/media\/[A-Za-z0-9_.-]+\.woff2)"\) format\("woff2"\)$/.exec(src?.value ?? '');
    assert(relative, 'Expected exact locally cached WOFF2 source');
    const bytes = await readFile(path.resolve(path.dirname(file), relative[1]));
    src.value = `url("data:font/woff2;base64,${bytes.toString('base64')}") format("woff2")`;
    fontCss += face.toString(); families.add(family);
  }
  assert(families.has('Poppins') && families.has('JetBrains Mono'), 'Both application font families required');
  fontCss += ':root{--font-poppins:Poppins;--font-jbmono:"JetBrains Mono"}';
  fontMode = 'cached-application-fonts';
}
const browser = await chromium.launch();
const results = [];
try {
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 390,
      reducedMotion: 'reduce', serviceWorkers: 'block' });
    const requests = [], errors = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
      await page.addStyleTag({ content: css.css + '\n' + fontCss }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.getByRole('heading', { name: 'Storage areas', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const bounds = [];
      for (const f of fixtures) {
        const code = page.getByText(f.code, { exact: true });
        const button = page.getByRole('button').filter({ has: code });
        await expect(button).toHaveCount(1);
        const texts = [code, button.getByText(f.label, { exact: true })];
        if (f.zone) texts.push(button.getByText(`Zone: ${f.zone}`, { exact: true }));
        else await expect(button.getByText(/^Zone:/)).toHaveCount(0);
        const rows = [];
        for (const text of texts) {
          const measured = await text.evaluate(node => {
            const r = node.getBoundingClientRect(), button = node.closest('button').getBoundingClientRect();
            const style = getComputedStyle(node);
            const range = document.createRange(); range.selectNodeContents(node);
            return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom,
              clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
              nowrap: style.whiteSpace === 'nowrap', ellipsis: style.textOverflow === 'ellipsis',
              fitsButton: [...range.getClientRects()].every(t => t.left >= button.left - 1 && t.right <= button.right + 1),
              fontSize: Number.parseFloat(style.fontSize) };
          });
          assert(!measured.clipped && !measured.nowrap && !measured.ellipsis && measured.fitsButton, `${width}: clipped ${f.id}`);
          assert(measured.x >= 0 && measured.x + measured.width <= width + 1);
          rows.push(measured);
        }
        assert(rows[0].bottom <= rows[1].y + 1, 'Label must follow full identity');
        if (f.zone) {
          assert(rows[1].bottom <= rows[2].y + 1, 'Zone must have its own row');
          assert(rows[0].fontSize > rows[2].fontSize, 'Code must be more prominent than zone');
        }
        bounds.push({ id: f.id, rows });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `${width}-queue-viewport.png`), animations: 'disabled' });
      await page.screenshot({ path: path.join(output, `${width}-queue-full.png`), animations: 'disabled', fullPage: true });
      const bin = page.getByRole('button').filter({ has: page.getByText(fixtures[0].code, { exact: true }) });
      await expect(bin).toContainText('7 items across 1 SKU');
      await bin.click();
      const contents = page.getByRole('dialog', { name: `Bin ${fixtures[0].code}`, exact: true });
      await expect(contents).toBeVisible();
      await expect(contents.getByRole('listitem')).toHaveCount(1);
      await contents.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(contents).toHaveCount(0);
      await bin.locator('..').getByRole('button', { name: 'Edit', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edit storage area', exact: true });
      await expect(edit.getByLabel('Bin code', { exact: true })).toHaveValue(fixtures[0].code);
      await edit.getByRole('button', { name: 'Close', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.fixture.mutations), []);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
      results.push({ width, height, bins: bounds, openedExactBin: true, editExactBin: true, mutations: 0, networkRequests: 0, pageErrors: 0 });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(path.join(output, 'report.json'), JSON.stringify({ mode: 'offline-real-component-mocked-store', fontMode, fontSourceSha256, liveActions: false, results }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, viewports: results.length, passed: true, liveActions: false }));
