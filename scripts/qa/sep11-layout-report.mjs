import {readFile, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root=path.resolve('outputs/sep11-hierarchy-preview');
const report=JSON.parse(await readFile(path.join(root,'layout-refined/results.json'),'utf8'));
if(report.results.length!==6 || report.results.some(row=>!row.passed)) throw new Error('Incomplete verification');
const screens={
  'order-copy':['Order details','A narrower record dialog, a distinct status band, grouped metadata and section headings.'],
  'order-dark':['Order details / dark','The same hierarchy and readable status colors in dark mode.'],
  'order-bottom':['Order details / lower sections','Order lines and shipment evidence remain accessible in the scrolling body.'],
  'order-intake-top':['New order','Separated dialog header and form section headings. No fields or business steps removed.'],
  'order-footer':['New order / actions','The existing submit action stays outside the scrolling form, without covering the last fields.'],
  'work-return':['My Work','Compact desktop rows with column headings. The sidebar remains visible after returning to a record.'],
  'po-list-return':['Purchase orders','The sidebar stays in the viewport while the PO list and amendment form scroll.'],
  'my-work':['My Work / overview','The main work views, filters and request list at the top of the page.'],
  'pick-pack':['Pick & Pack / overview','The fulfillment queue retains its existing status filters and actions.'],
  'purchase-order':['Purchase order / overview','The record header, section navigation and existing PO actions.'],
};
for(const key of Object.keys(screens)) for(const width of [1440,390]) await access(path.join(root,`layout-refined/${key}-${width}.png`));
const options=Object.entries(screens).map(([key,[title]])=>`<option value="${key}">${title}</option>`).join('');
await writeFile(path.join(root,'layout.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intra layout refinement</title><style>
*{box-sizing:border-box}body{margin:0;background:#e8ecef;color:#1a2731;font:14px/1.5 "Segoe UI",Arial,sans-serif}header{background:#fff;border-bottom:1px solid #b8c4cc;padding:16px 24px}h1{margin:0;font-size:23px}p{margin:5px 0;color:#496071}a{color:#075ba8}.toolbar{display:flex;align-items:center;gap:20px;flex-wrap:wrap;position:sticky;top:0;z-index:1;padding:12px 24px;background:#fff;border-bottom:1px solid #b8c4cc}label{display:flex;gap:8px;align-items:center}select{font:inherit;min-height:44px;max-width:100%;border:1px solid #99aab7;border-radius:4px;padding:8px}main{padding:16px 24px}img{display:block;width:100%;max-width:1440px;margin:0 auto}.mobile img{width:390px;max-width:100%}.caption{margin:0 auto 12px;max-width:1440px}details{margin-top:20px;border-top:1px solid #b8c4cc;padding:12px 0}summary{cursor:pointer;font-weight:600;min-height:44px;padding:10px 0}:focus-visible{outline:3px solid #075ba8;outline-offset:3px}.status{color:#076253;font-weight:600}li{margin:6px 0}</style></head><body>
<header><h1>Clearer layouts, same workflow</h1><p class="status">Isolated preview / Not deployed to live UAT</p></header>
<div class="toolbar"><label>Screen<select id="screen">${options}</select></label><label>View<select id="width"><option value="1440">Desktop</option><option value="390">Mobile</option></select></label><a id="original" target="_blank" rel="noopener">Open full-size screenshot</a></div>
<main><p class="caption" id="caption"></p><a id="full" target="_blank" rel="noopener"><img id="capture" alt=""></a><details><summary>Verification and scope</summary><ul><li>Six browser cases: Operations Associate, Employee and Procurement Lead, each at desktop and mobile sizes.</li><li>Checked sidebar positioning after scroll, hide/show persistence, clipboard links, list return context, modal horizontal fit, Escape/focus return and separate action footers.</li><li>Existing Warehouse, Procurement and My Work regression suites were rerun. No operational records were submitted by the screenshot harness.</li><li>Shared Sheet styling applies to other consumers, but this is not screenshot certification of every dialog or every user role.</li></ul><p><a href="layout-refined/results.json">Browser results</a> / <a href="layout-warehouse-refined.log">Warehouse</a> / <a href="layout-procurement-refined.log">Procurement</a> / <a href="layout-work-refined.log">My Work</a> / <a href="qol.html">Previous preview</a></p></details></main>
<script>const captions=${JSON.stringify(screens)};const s=document.getElementById('screen'),w=document.getElementById('width');function render(){const src='layout-refined/'+s.value+'-'+w.value+'.png';document.getElementById('capture').src=src;document.getElementById('capture').alt=captions[s.value][0]+' / '+w.selectedOptions[0].text;document.getElementById('caption').textContent=captions[s.value][1];document.getElementById('full').href=src;document.getElementById('original').href=src;document.getElementById('full').className=w.value==='390'?'mobile':'';}s.onchange=render;w.onchange=render;render();</script></body></html>`);
const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
const browser=await require('@playwright/test').chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(pathToFileURL(path.join(root,'layout.html')).href);
  for(const key of Object.keys(screens)) for(const width of ['1440','390']) {
    await page.locator('#screen').selectOption(key);await page.locator('#width').selectOption(width);
    await page.waitForFunction(()=>document.images[0].complete&&document.images[0].naturalWidth>0);
    const expected=`layout-refined/${key}-${width}.png`;
    if(await page.locator('#original').getAttribute('href')!==expected || await page.locator('#full').getAttribute('href')!==expected) throw new Error('Full-size link does not match the selected image');
  }
  console.log(`Verified all ${Object.keys(screens).length*2} screenshot selections and full-size links.`);
} finally {await browser.close();}
