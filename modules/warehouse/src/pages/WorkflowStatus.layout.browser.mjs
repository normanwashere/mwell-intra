// Real components and styles, isolated synthetic stores; no server or live access.
/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(path.join(root, 'apps/shell/package.json'));
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const postcss = require('postcss'), tailwind = require('tailwindcss');
const output = path.join(root, 'outputs/wms-signoff/workflow-status-layout', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import {ToastProvider} from '@intra/ui';
  import {buildSeed} from '../../packages/data-kit/src/seed';
  import {FulfillmentPage} from './src/pages/FulfillmentPage';
  import {QualityPage} from './src/pages/QualityPage';
  const kind=window.fixtureKind;
  const data=buildSeed();
  data.receipts=[{id:'pending-receipt',actor:'offline-receiver',locationId:'loc-wh',createdAt:'2026-09-13',lines:[{productId:'smart-watch',quantity:1}]}];
  data.customerReturnCases=[{id:'offline-case',productId:'smart-watch',sourceOrderId:'offline-order',
    defectDescription:'Screen does not turn on',requestingDepartment:'customer_service',status:'submitted',resolution:'pending',
    createdBy:'offline-customer-service',createdAt:'2026-09-13'}];
  data.fulfillmentOrders=[{id:'offline-order',externalReference:'OFFLINE-ORDER-001',source:'ecommerce',status:'completed',
    deliveryMethod:'shipment',customerName:'Training Customer',customerContact:'09000000000',
    deliveryAddress:{addressLine:'Training address only',city:'Training City',province:'Training Province',postalCode:'1000'},
    createdBy:'offline-creator',createdAt:'2026-09-13',updatedAt:'2026-09-13',lines:[{productId:'smart-watch',quantity:1,pickedQuantity:1,pickedSerialNumbers:[]}],packaging:[],shipmentEvents:[]}];
  data.returns=kind==='unlinked'?[]:[{id:'physical-intake',source:'customer',sourceOrderId:'offline-order',returnCaseId:'offline-case',
    actor:'offline-receiver',createdAt:'2026-09-13',evidenceUrls:['return/offline-intake/photo.png'],
    lines:[{productId:'smart-watch',quantity:1,reason:'Defect',locationId:'loc-wh',binId:'quarantine',disposition:'hold'}]}];
  data.departmentStockRequests=[];data.reKitWorkOrders=[];
  data.storageAreas=[{id:'quarantine',locationId:'loc-wh',code:'QC-01',label:'Quality quarantine',active:true}];
  const inspections=[{id:'completed-inspection',sourceType:'return',sourceId:'completed-intake',productId:'smart-watch',quantity:1,
    disposition:'accepted',inspectedBy:'offline-inspector',inspectedAt:'2026-09-13',evidenceCount:0}];
  const holds=[0,1,2].map(i=>({id:'hold-'+i,sourceType:'return',sourceId:'hold-source-'+i,productId:'smart-watch',quantity:1,
    status:'active',reason:i===0?'Review screen damage':'Packaging review '+i,createdBy:'offline-inspector',createdAt:'2026-09-13',inspectionId:'hold-inspection-'+i}));
  window.fixture={mutations:[]};
  const mutation=name=>()=>{window.fixture.mutations.push(name);throw Error('No mutation allowed in layout fixture');};
  window.fixture.warehouse={data,role:'warehouse_supervisor',source:'memory',actor:'offline-supervisor',identityId:'offline-supervisor',
    capabilities:['manage_returns','inspect_quality','release_quality_hold'],can:cap=>['manage_returns','inspect_quality','release_quality_hold'].includes(cap),
    loadQualityInspectionSummaries:async()=>({rows:inspections}),loadHolds:async()=>({rows:holds}),loadVendorReturns:async()=>({rows:[]}),
    inspectQuality:mutation('inspect'),releaseHold:mutation('release'),createVendorReturn:mutation('vendor-return'),
    resolveCustomerReturnCase:mutation('resolve'),closeCustomerReturnCase:mutation('close')};
  createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/warehouse/fulfillment?tab=returns']}><ToastProvider>
    <main className="mx-auto max-w-[1152px] p-4 sm:p-6">{kind==='quality'?<QualityPage/>:<FulfillmentPage/>}</main>
  </ToastProvider></MemoryRouter>);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: path.join(root, 'modules/warehouse'), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@': path.join(root, 'modules/warehouse/src'), react: path.dirname(require.resolve('react/package.json')),
    'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
  plugins: [{ name: 'isolated-status-store', setup(build) {
    build.onResolve({ filter: /^@\/app\/store$/ }, () => ({ path: 'warehouse', namespace: 'fixture' }));
    build.onResolve({ filter: /^(@intra\/auth|@\/auth\/session)$/ }, () => ({ path: 'session', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'warehouse'
      ? 'export const useWarehouse=()=>window.fixture.warehouse;'
      : 'export const useSession=()=>({mode:"memory",supabaseClient:null,profile:{id:"offline-supervisor",name:"Offline Supervisor"}});' }));
  } }],
});
const cssFiles = ['packages/ui/src/styles.css', 'apps/shell/app/globals.css', 'apps/shell/app/hierarchy-preview.css', 'modules/warehouse/src/pages/FulfillmentPage.css'];
let input = '';
for (const file of cssFiles) input += `${await readFile(path.join(root, file), 'utf8')}\n`;
const css = await postcss([tailwind({ presets: [require('@intra/config/tailwind/preset')], content: [
  { raw: entry, extension: 'tsx' }, path.join(root, 'modules/warehouse/src/**/*.{ts,tsx}'), path.join(root, 'packages/ui/src/**/*.{ts,tsx}'),
] })]).process(input, { from: undefined });
const report = { kind: 'offline-real-component-layout', fontMode: 'system-fallback', networkRequests: [], errors: [], mutations: [], screenshots: [], complete: false };
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 720]]) for (const kind of ['quality', 'linked', 'unlinked']) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.25, isMobile: width <= 390, hasTouch: width <= 390,
      serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      await context.route('**/*', route => { report.networkRequests.push({ kind, width, method: route.request().method() }); return route.abort(); });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push({ kind, width, message: error.message }));
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>');
      await page.evaluate(kind => { window.fixtureKind = kind; }, kind);
      await page.addStyleTag({ content: css.css + '\n:root{--font-poppins:Arial;--font-jbmono:monospace}' });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const shot = async (stage, target) => {
        await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${kind}-${width}: document overflow`);
        const ref = `${width}-${kind}-${stage}.png`;
        const bytes = await page.screenshot({ path: path.join(output, ref), animations: 'disabled' });
        report.screenshots.push({ kind, width, height, stage, ref, sha256: createHash('sha256').update(bytes).digest('hex'), visuallyReviewed: false });
      };
      if (kind === 'quality') {
        await expect(page.getByText('3 active holds', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Loading quality controls...', { exact: true })).toBeHidden();
        await page.getByRole('tab', { name: 'Holds', exact: true }).click();
        await shot('holds', page.getByText('3 active holds', { exact: true }));
        await page.getByRole('searchbox').fill('Review screen damage');
        await shot('filtered-holds', page.getByText('1 of 3 active holds', { exact: true }));
        await page.getByRole('searchbox').fill('');
        await page.getByRole('tab', { name: 'Completed', exact: true }).click();
        await shot('completed', page.getByText('1 completed inspections', { exact: true }));
      } else {
        await page.getByRole('button', { name: 'Record resolution', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Resolve return case', exact: true });
        const summary = dialog.getByRole('region', { name: 'Workflow status', exact: true });
        await expect(summary).toContainText('Customer case submitted / awaiting resolution');
        await expect(summary).toContainText(kind === 'linked'
          ? 'Linked physical intake is recorded. Current Quality hold or release status is not available in this view.'
          : 'Linked physical intake and current Quality status are not verified in this view.');
        await expect(summary).not.toContainText('Awaiting physical intake');
        await shot('summary', summary);
        const save = dialog.getByRole('button', { name: 'Save resolution', exact: true });
        const bin = dialog.getByLabel('Quarantine bin', { exact: true });
        const body = dialog.getByRole('region', { name: 'Resolve return case content', exact: true });
        if (width === 1440) {
          await page.setViewportSize({ width: 390, height: 844 });
          await dialog.getByRole('radio', { name: 'New delivery details', exact: true }).check();
          const header = dialog.locator('.intra-sheet-header');
          const headerBox = await header.boundingBox(), dialogBox = await dialog.boundingBox();
          assert(headerBox && dialogBox && headerBox.y >= dialogBox.y - 1, `${kind}: resized dialog header clipped`);
          await dialog.getByRole('radio', { name: 'Original delivery details', exact: true }).check();
          await page.setViewportSize({ width, height });
        }
        const fullyVisible = async control => {
          await control.scrollIntoViewIfNeeded();
          await control.evaluate(el => el.scrollIntoView({ block: 'center' }));
          const chrome = await dialog.evaluate(el => {
            const box = el.getBoundingClientRect();
            const header = el.querySelector('.intra-sheet-header').getBoundingClientRect();
            const footer = el.querySelector('.intra-sheet-footer').getBoundingClientRect();
            return { scrollTop: el.scrollTop, top: box.top, bottom: box.bottom, headerTop: header.top, footerBottom: footer.bottom };
          });
          assert.equal(chrome.scrollTop, 0, `${kind}-${width}: outer dialog scrolled`);
          assert(chrome.headerTop >= chrome.top - 1 && chrome.footerBottom <= chrome.bottom + 1,
            `${kind}-${width}: dialog title or actions clipped`);
          const box = await control.boundingBox(), frame = await body.boundingBox(), footer = await save.boundingBox();
          assert(box && frame && footer && box.y >= frame.y - 1 && box.y + box.height <= Math.min(frame.y + frame.height, footer.y) + 1,
            `${kind}-${width}: field obscured by sheet header/footer`);
        };
        await fullyVisible(bin);
        await shot('original-delivery-bin', bin);
        await dialog.getByRole('radio', { name: 'New delivery details', exact: true }).check();
        await expect(save).toBeDisabled();
        for (const label of ['Replacement recipient name', 'Replacement contact number', 'Replacement email (optional)',
          'Replacement address line', 'Replacement city', 'Replacement province', 'Replacement postal code', 'Reason for new delivery details']) {
          const field = dialog.getByLabel(label, { exact: true });
          await fullyVisible(field);
          if (label === 'Replacement recipient name') await shot('new-delivery-start', field);
        }
        await fullyVisible(bin);
        await shot('new-delivery-end', bin);
        const rect = await save.boundingBox(); assert(rect && rect.x >= 0 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= height + 1);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
      report.mutations.push(...await page.evaluate(() => window.fixture.mutations));
      assert.deepEqual(report.errors, []); assert.deepEqual(report.networkRequests, []); assert.deepEqual(report.mutations, []);
    } finally { await context.close(); }
  }
  report.complete = true;
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
}
console.log(JSON.stringify({ output, complete: report.complete, screenshots: report.screenshots.length, liveActions: false }));
