// Offline real-component regression: no authentication, network or stock mutations.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const output = path.join(os.tmpdir(), 'receiving-r04-browser', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const receipt = 'external-ad90f0fb-5558-4a0f-acf5-9e6e8c0a2e5d';
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import {ToastProvider} from '@intra/ui';
  import {buildSeed} from '../../packages/data-kit/src/seed';
  import {QualityPage} from './src/pages/QualityPage';
  import {StorageAreasPage} from './src/pages/StorageAreasPage';
  const data=buildSeed();
  data.locations=[{id:'rbc',name:'RBC warehouse',type:'warehouse'}, {id:'receipt-wh',name:'Receipt warehouse',type:'warehouse'}];
  data.storageAreas=[{id:'final-bin',locationId:'receipt-wh',code:'DEST-01',active:true}];
  data.receipts=[{id:'${receipt}',locationId:'receipt-wh',deliveryReference:'DR-42',actualDeliveryDate:'2026-10-20',
    actor:'receiver',createdAt:'2026-10-19T17:15:00Z',lines:[{productId:'shirt-l',quantity:3}]}];
  data.returns=[]; data.units=[];
  data.stockLevels=[{productId:'shirt-l',locationId:'receipt-wh',quantity:3,lotId:'lot-one'}];
  const inspections=[{id:'inspection-5558-4a0f-acf5-9e6e8c0a2e5d',sourceType:'receipt',sourceId:'${receipt}',
    productId:'shirt-l',lotId:'lot-one',quantity:3,disposition:'accepted',inspectedBy:'quality',inspectedAt:'2026-10-19T17:15:00Z',evidenceCount:0}];
  const mutation=()=>{window.fixture.mutations++;throw new Error('No mutations allowed');};
  window.fixture={mutations:0,warehouse:{data,can:()=>true,identityId:'quality',capabilities:['inspect_quality','transfer_stock'],source:'memory',
    loadQualityInspectionSummaries:async()=>({rows:inspections}),loadQualityInspections:async()=>({rows:inspections}),
    loadHolds:async()=>({rows:[]}),loadVendorReturns:async()=>({rows:[]}),loadWarehouseTasks:async()=>({rows:[]}),
    loadInventoryPositions:async()=>({rows:[{productId:'shirt-l',locationId:'receipt-wh',onHand:3,available:3,held:0,unavailable:0,committed:0}]}),
    relocate:mutation,submitQualityInspection:mutation,submitQualityBatch:mutation,releaseHold:mutation,createVendorReturn:mutation}};
  const root=createRoot(document.getElementById('root'));
  window.showPage=(page,route)=>root.render(<MemoryRouter key={page+route} initialEntries={[route]}><ToastProvider>
    <main className="mx-auto max-w-[1152px] p-4 sm:p-6">{page==='quality'?<QualityPage/>:<StorageAreasPage/>}</main>
  </ToastProvider></MemoryRouter>);
  window.showPage('quality','/quality?source=${receipt}');
`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: path.join(root, 'modules/warehouse'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'modules/warehouse/src'), react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
  plugins: [{ name: 'offline-fixture', setup(build) {
    build.onResolve({ filter: /^@\/app\/store$/ }, () => ({ path: 'warehouse', namespace: 'fixture' }));
    build.onResolve({ filter: /^(@intra\/auth|@\/auth\/session)$/ }, () => ({ path: 'session', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'warehouse'
      ? 'export const useWarehouse=()=>window.fixture.warehouse;'
      : 'export const useSession=()=>({mode:"memory",supabaseClient:null,profile:null});' }));
  } }],
});
const css = await postcss([tailwind({ presets: [require('@intra/config/tailwind/preset')], content: [
  { raw: entry, extension: 'tsx' }, path.join(root, 'modules/warehouse/src/pages/{QualityPage,StorageAreasPage}.tsx'),
  path.join(root, 'packages/ui/src/**/*.{ts,tsx}'), path.join(root, 'modules/warehouse/src/components/**/*.{ts,tsx}'),
] })]).process(await readFile(path.join(root, 'packages/ui/src/styles.css'), 'utf8') + '\n'
  + await readFile(path.join(root, 'apps/shell/app/globals.css'), 'utf8'), { from: undefined });
const browser = await chromium.launch();
try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const requests = [], errors = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.setContent('<!doctype html><title>Offline receiving regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
      await page.addStyleTag({ content: css.css + '\n:root{--font-poppins:Arial;--font-jbmono:monospace}' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await expect(page.getByRole('heading', { name: 'Quality control' })).toBeVisible();
      const item = page.getByRole('list', { name: 'Completed inspections' }).getByRole('listitem');
      await expect(item.locator('time')).toHaveText('Oct 20, 2026, 1:15 AM (Asia/Manila)');
      assert((await item.boundingBox()).y < height - 100, 'Quality result must start in the first viewport');
      await expect(item.getByText(`receipt: ${receipt}`, { exact: true })).not.toBeVisible();
      await page.screenshot({ path: path.join(output, `${width}-quality.png`), animations: 'disabled' });
      await item.getByText('Traceability', { exact: true }).click();
      await expect(item.getByText(`receipt: ${receipt}`, { exact: true })).toBeVisible();
      assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1), 'Quality overflow');
      await page.evaluate(receipt => globalThis.showPage('storage', '/storage?warehouse=receipt-wh&receipt='+receipt+'&product=shirt-l'), receipt);
      const dialog = page.getByRole('dialog', { name: 'Put away stock' });
      await expect(dialog.getByText('Warehouse: Receipt warehouse')).toBeVisible();
      await expect(dialog.getByText('3 eligible unit(s) in the general area')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
      await dialog.getByLabel('Enter destination bin manually').fill('DEST-01');
      await dialog.getByRole('button', { name: 'Add bin', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Confirm putaway' })).toBeEnabled();
      await page.screenshot({ path: path.join(output, `${width}-putaway.png`), animations: 'disabled' });
      assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Putaway overflow');
      assert.equal(await page.evaluate(() => globalThis.fixture.mutations), 0);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ passed: true, output, viewports: [390, 1440], liveActions: false, networkRequests: 0, mutations: 0 }));
