import { readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root=path.resolve('outputs/sep11-hierarchy-preview');
const report=JSON.parse(await readFile(path.join(root,'qol-final/results.json'),'utf8'));
if(report.results.length!==6 || report.results.some(row=>!row.passed)) throw new Error('Incomplete browser verification');
const screens={'order-copy':'Order reference and link','order-footer':'Existing pinned order actions','work-return':'Return to My Work','po-copy':'PO reference and link','po-list-return':'Return to filtered PO list'};
for(const screen of Object.keys(screens)) for(const width of [1440,390]) await access(path.join(root,`qol-final/${screen}-${width}.png`));
const options=Object.entries(screens).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
await writeFile(path.join(root,'qol.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intra workflow convenience preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f3;color:#172832;font:15px/1.5 "Segoe UI",Arial,sans-serif}header{padding:20px 28px;background:#fff;border-bottom:1px solid #c4cdd4}h1{font-size:25px;margin:4px 0}p{margin:6px 0;color:#455d6d}.status{font-size:13px;color:#075b51}a{color:#075ba8}.tools{display:flex;align-items:center;gap:24px;padding:14px 28px;background:white;border-bottom:1px solid #c4cdd4;flex-wrap:wrap}label{display:flex;gap:10px;align-items:center}select{min-height:44px;padding:8px;border:1px solid #aebcc5;border-radius:4px;font:inherit;max-width:100%}main{padding:20px 28px;max-width:1496px;margin:auto}img{display:block;width:100%;border:1px solid #c4cdd4}.mobile img{width:390px;max-width:100%;margin:auto}details{padding:12px 0;margin-bottom:16px;border-bottom:1px solid #c4cdd4}summary{cursor:pointer;min-height:44px;padding:10px 0;font-weight:600}li{margin:8px 0}:focus-visible{outline:3px solid #075ba8;outline-offset:3px}@media(max-width:650px){header,.tools{padding:16px}main{padding:12px}label{flex-wrap:wrap}}</style></head><body>
<header><a href="sidebar.html">Sidebar preview</a><h1>Everyday workflow improvements</h1><p>Scoped changes to navigation, record sharing and exit warnings. Existing business steps remain in place.</p><p class="status">Preview only / Live UAT unchanged / Six browser cases passed</p></header>
<div class="tools"><label>Screen<select id="screen">${options}</select></label><label>Viewport<select id="width"><option value="1440">Desktop</option><option value="390">Mobile</option></select></label></div>
<main><details><summary>What was checked and what is still limited</summary><ul>
<li>My Work returns to its previous view and scroll position. PO list returns preserve the status filter, sorting and scroll position.</li>
<li>Copy reference and copy link use the accessible order or PO's canonical address. Sharing does not grant access.</li>
<li>Existing order action footers remain separate from the scrolling form body. No duplicate submit controls were added.</li>
<li>Request warnings cover its Cancel link and browser exit; failed local order-draft saves prompt before sheet close. This is not a universal guard for every SPA Back action or every app form.</li>
<li>190 Warehouse, 314 Procurement and 55 My Work checks passed. Final preview build and six desktop/mobile browser cases passed. Browser capture did not submit operational transactions.</li>
</ul><p><a href="qol-final/results.json">Browser evidence</a> / <a href="qol-warehouse-final.log">Warehouse tests</a> / <a href="qol-procurement-final.log">Procurement tests</a> / <a href="qol-work.log">My Work tests</a></p></details>
<a id="full" target="_blank" rel="noopener"><img id="capture" alt="Workflow convenience preview"></a></main>
<script>const screen=document.getElementById('screen'),width=document.getElementById('width');function render(){const src='qol-final/'+screen.value+'-'+width.value+'.png';document.getElementById('capture').src=src;document.getElementById('capture').alt=screen.selectedOptions[0].text+' '+width.selectedOptions[0].text;document.getElementById('full').href=src;document.getElementById('full').className=width.value==='390'?'mobile':'';}screen.onchange=render;width.onchange=render;render();</script></body></html>`);
const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
const browser=await require('@playwright/test').chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(pathToFileURL(path.join(root,'qol.html')).href);
  for(const screen of Object.keys(screens))for(const width of ['1440','390']){
    await page.locator('#screen').selectOption(screen);await page.locator('#width').selectOption(width);
    await page.waitForFunction(()=>document.images[0].complete&&document.images[0].naturalWidth>0);
  }
  console.log('Verified ten evidence images and gallery controls.');
} finally {await browser.close();}
