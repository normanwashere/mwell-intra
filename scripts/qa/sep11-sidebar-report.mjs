import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = path.resolve('outputs/sep11-hierarchy-preview');
const report = JSON.parse(await readFile(path.join(root, 'sidebar/results.json'), 'utf8'));
if (report.results.length !== 6 || report.results.some(row => !row.passed)) throw new Error('Incomplete sidebar verification');
for (const screen of ['pick-pack', 'my-work', 'purchase-order']) {
  for (const state of ['', '-nav-hidden']) await access(path.join(root, `sidebar/${screen}-1440${state}.png`));
}
await writeFile(path.join(root, 'sidebar.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intra sidebar preview</title>
<style>*{box-sizing:border-box}body{margin:0;background:#eef1f3;color:#172832;font:15px/1.5 "Segoe UI",Arial,sans-serif}header{padding:20px 28px;background:white;border-bottom:1px solid #c4cdd4}h1{font-size:25px;margin:4px 0}p{margin:6px 0;color:#455d6d}a{color:#075ba8}.tools{display:flex;align-items:center;gap:28px;padding:14px 28px;border-bottom:1px solid #c4cdd4;background:white}label{display:flex;gap:10px;align-items:center}select{min-height:44px;padding:8px;border:1px solid #aebcc5;border-radius:4px;font:inherit}input{height:20px;width:20px;accent-color:#075ba8}main{padding:20px 28px;max-width:1496px;margin:auto}img{display:block;width:100%;border:1px solid #c4cdd4}small{display:block;padding:10px 0;color:#455d6d}:focus-visible{outline:3px solid #075ba8;outline-offset:3px}@media(max-width:650px){.tools{flex-wrap:wrap}main{padding:12px}}</style></head>
<body><header><a href="index.html">Back to hierarchy comparison</a><h1>Desktop sidebar</h1><p>Actual preview screenshots. The menu button in the app's top bar hides or shows the sidebar and remembers your choice on this browser.</p></header>
<div class="tools"><label>Screen <select id="screen"><option value="pick-pack">Pick &amp; Pack</option><option value="my-work">My Work</option><option value="purchase-order">PO detail</option></select></label><label><input type="checkbox" id="shown" checked>Side navigation visible</label></div>
<main><a id="full" target="_blank" rel="noopener"><img id="capture" alt="App preview with sidebar"></a><small>Preview only. Mobile navigation is unchanged. <a href="sidebar/results.json">Browser results</a></small></main>
<script>const screen=document.getElementById('screen'),shown=document.getElementById('shown');function render(){const src='sidebar/'+screen.value+'-1440'+(shown.checked?'':'-nav-hidden')+'.png';document.getElementById('capture').src=src;document.getElementById('capture').alt=screen.selectedOptions[0].text+' with sidebar '+(shown.checked?'shown':'hidden');document.getElementById('full').href=src;}screen.onchange=render;shown.onchange=render;render();</script></body></html>`);
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const browser = await require('@playwright/test').chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, 'sidebar.html')).href);
  for (const screen of ['pick-pack', 'my-work', 'purchase-order']) {
    await page.locator('#screen').selectOption(screen);
    for (const shown of [true, false]) {
      await page.locator('#shown').setChecked(shown);
      await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
console.log('Wrote sidebar comparison; all six screenshot states verified.');
