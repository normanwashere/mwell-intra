// Real fulfillment, shell, providers and CSS. Synthetic in-memory custody only.
/* global window, document, innerWidth, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss'), tailwind = require('tailwindcss');
const output = path.join(root, 'modules/warehouse/output/playwright/fulfillment-sep20', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import {ToastProvider} from '@intra/ui';
  import {LearningContext} from '@intra/learning';
  import {buildSeed, InMemoryRepository} from '@intra/data-kit';
  import {SessionProvider} from '@/auth/session';
  import {WarehouseProvider} from '@/app/store';
  import {ThemeProvider} from '@/app/theme';
  import {AppShell} from '@/components/AppShell';
  import {FulfillmentPage} from '@/pages/FulfillmentPage';
  const data=buildSeed(), role='warehouse_operator';
  window.reference=window.innerWidth<600 ? 'FULFILLMENT-LONG-REFERENCE-'+ 'CONTEXT-'.repeat(14)+'0099' : 'ORDER-0001';
  data.fulfillmentOrders=Array.from({length:8},(_,i)=>({
    id:'order-'+i,externalReference:i ? 'ORDER-000'+(i+1) : window.reference,
    source:'ecommerce',ecommerceChannel:'Shopee',sourceLocationId:'loc-wh',status:'received',
    customerName:'Test Customer '+(i+1),deliveryAddress:{addressLine:'Training address',city:'Pasig',province:'Metro Manila',postalCode:'1600'},
    deliveryMethod:'shipment',createdBy:'fixture',createdAt:'2026-09-20T00:00:00Z',updatedAt:'2026-09-20T00:00:00Z',
    lines:[{productId:'shirt-l',quantity:2,pickedQuantity:0,pickedSerialNumbers:[]}],packaging:[],shipmentEvents:[]
  }));
  data.departmentStockRequests=[];data.customerReturnCases=[];data.returns=[];
  const repo=new InMemoryRepository(data,{storage:null});
  window.mutations=[];
  for(const name of ['advanceFulfillmentOrder','cancelFulfillmentOrder','splitFulfillmentBackorder','recordReturn']) {
    repo[name]=async()=>{window.mutations.push(name);throw Error('No mutation permitted in layout proof');};
  }
  const learning={snapshot:{curricula:[],progress:[],certifications:[],lockedCapabilities:[],refreshedAt:'2026-09-20T00:00:00Z'},
    loading:false,stale:false,error:null,refreshAccess:async()=>true,isLiveCapability:()=>true,lockedReason:()=>null};
  window.sessionStorage.setItem('intra.memory-session.v1',JSON.stringify({profileId:'offline-operator',roles:{warehouse:[role]}}));
  createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/fulfillment?tab=orders']}>
    <SessionProvider config={{mode:'memory',profiles:[{id:'offline-operator',email:'offline@example.invalid',name:'Offline Operator',kind:'employee',roles:{warehouse:[role]}}]}}>
      <ThemeProvider><ToastProvider><LearningContext.Provider value={learning}>
        <WarehouseProvider repo={repo} source="memory" initialRole={role}><AppShell><FulfillmentPage/></AppShell></WarehouseProvider>
      </LearningContext.Provider></ToastProvider></ThemeProvider>
    </SessionProvider></MemoryRouter>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: path.join(root, 'modules/warehouse'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  alias: { '@': path.join(root, 'modules/warehouse/src'), react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
});
let styles = '';
for (const file of ['packages/ui/src/styles.css', 'apps/shell/app/globals.css', 'apps/shell/app/hierarchy-preview.css', 'modules/warehouse/src/pages/FulfillmentPage.css']) styles += await readFile(path.join(root, file), 'utf8') + '\n';
const css = await postcss([tailwind({ presets: [require('@intra/config/tailwind/preset')], content: [
  { raw: entry, extension: 'tsx' }, path.join(root, 'modules/warehouse/src/**/*.{ts,tsx}'), path.join(root, 'packages/ui/src/**/*.{ts,tsx}'),
] })]).process(styles, { from: undefined });
const report = { kind: 'offline-real-component-layout', fontMode: 'system-fallback', rows: [], errors: [], blockedRequests: [], complete: false };
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      await context.route('**/*', route => {
        if (route.request().url() === 'https://fulfillment-fixture.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
        report.blockedRequests.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto('https://fulfillment-fixture.test/');
      await page.addStyleTag({ content: css.css + '\n:root{--font-inter:Arial;--font-poppins:Arial;--font-grotesk:Arial;--font-jbmono:monospace}' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const list = page.getByRole('list', { name: 'Fulfillment demand' });
      await expect(list).toBeVisible();
      await expect(list.getByRole('listitem')).toHaveCount(8);
      await page.evaluate(() => document.fonts.ready);
      const boxes = await list.getByRole('listitem').evaluateAll(rows => rows.map(row => {
        const box = row.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
      }));
      const first = list.getByRole('listitem').first();
      const action = first.getByRole('button', { name: 'Allocate stock', exact: true });
      const actionBox = await action.boundingBox();
      const visibleRows = boxes.filter(box => box.y >= 0 && box.bottom <= height).length;
      const measurements = { width, height, visibleRows, firstAction: actionBox, rows: boxes };
      report.rows.push(measurements);
      await page.screenshot({ path: path.join(output, width + '-queue.png'), animations: 'disabled' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + ': overflow');
      assert(actionBox.height >= 44 && actionBox.y + actionBox.height <= height, width + ': first action below fold or undersized');
      assert(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.includes('Allocate stock'), { x: actionBox.x + actionBox.width / 2, y: actionBox.y + actionBox.height - 2 }), width + ': first action covered by navigation');
      if (width === 1440) {
        assert(visibleRows >= 5, 'Desktop must show at least five complete ordinary rows; got ' + visibleRows);
        assert(boxes.every(box => box.x === boxes[0].x && box.width === boxes[0].width), 'Single-column queue required');
        await page.getByText('Queue tools', { selector: 'summary' }).click();
        await page.getByLabel('Order density').selectOption('comfortable');
        await expect(list).toHaveAttribute('data-density', 'comfortable');
        await page.getByLabel('Order density').selectOption('compact');
        await page.getByText('Queue tools', { selector: 'summary' }).click();
      } else {
        const filters = page.getByRole('button', { name: 'Filters', exact: true });
        await expect(page.getByLabel('Status', { exact: true })).toBeHidden();
        await filters.click();
        await page.getByLabel('Status', { exact: true }).selectOption('all');
        await page.getByLabel('Channel', { exact: true }).selectOption('Shopee');
        await filters.click();
        const disclosure = first.locator('summary[aria-label="Full order reference"]');
        await disclosure.focus(); await page.keyboard.press('Enter');
        await expect(first.getByText(await page.evaluate(() => window.reference), { exact: true })).toBeVisible();
        await expect(first.getByRole('button', { name: 'Copy reference' })).toBeVisible();
        await disclosure.click();
      }
      await first.getByRole('button', { name: 'View order details' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Receive physical return' })).toHaveCount(0);
      await page.screenshot({ path: path.join(output, width + '-details.png'), animations: 'disabled' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(first.getByRole('button', { name: 'View order details' })).toBeFocused();
      const lastAction = list.getByRole('listitem').last().getByRole('button', { name: 'Allocate stock' });
      await lastAction.scrollIntoViewIfNeeded();
      const lastBox = await lastAction.boundingBox();
      assert(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.includes('Allocate stock'), { x: lastBox.x + lastBox.width / 2, y: lastBox.y + lastBox.height - 2 }), width + ': last action obscured');
      assert.deepEqual(await page.evaluate(() => window.mutations), []);
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.complete = true;
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, complete: report.complete, rows: report.rows, errors: report.errors }));
}
