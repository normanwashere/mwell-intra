import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(root, 'docs/audits/2026-08-28-AUG27-WMS-REMEDIATION.md');
const output = source.replace(/\.md$/, '.html');
const escape = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const inlineImage = (path) => {
  const extension = extname(path).slice(1);
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) throw new Error(`Unsupported evidence: ${path}`);
  return `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${readFileSync(path).toString('base64')}`;
};
const headings = [];
const parser = new Marked({
  renderer: {
    heading({ depth, tokens }) {
      const content = this.parser.parseInline(tokens);
      if (depth === 1) return `<h1>${content}</h1>`;
      const id = `section-${headings.length + 1}`;
      headings.push({ id, label: content.replace(/<[^>]+>/g, '') });
      return `<h${depth} id="${id}" tabindex="-1">${content}</h${depth}>`;
    },
    image({ href, text }) {
      const path = resolve(dirname(source), href);
      const withinEvidence = relative(resolve(root, 'docs/evidence'), path);
      if (withinEvidence.startsWith('..') || isAbsolute(withinEvidence)) {
        throw new Error(`Evidence must be within docs/evidence: ${href}`);
      }
      return `<figure><button class="evidence" aria-label="Enlarge: ${escape(text)}"><img src="${inlineImage(path)}" alt="${escape(text)}" loading="lazy"></button><figcaption>${escape(text)}</figcaption></figure>`;
    },
  },
});
const article = parser.parse(readFileSync(source, 'utf8'));
const logo = inlineImage(resolve(root, 'apps/shell/public/mwell-wordmark.png'));
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>August 27 feedback response | mWell Intra UAT</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#172432;background:#f4f6f8;line-height:1.6;letter-spacing:0}
*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{cursor:pointer}
header{padding:18px 32px;background:#fff;border-bottom:1px solid #dce3e8;display:flex;align-items:center;gap:14px}
header img{width:115px;height:42px;object-fit:contain}header strong{font-size:18px}header span{margin-left:auto;color:#326253;font-size:13px}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1500px;margin:auto}
aside{position:sticky;top:0;height:100vh;padding:24px 20px;overflow:auto;border-right:1px solid #dce3e8;background:#fff}
aside label{font-weight:700;font-size:13px}input{width:100%;padding:10px 12px;border:1px solid #8796a3;border-radius:5px;margin:6px 0 10px}
nav a{display:block;color:#364c5c;text-decoration:none;border-left:3px solid transparent;padding:9px 12px;font-size:14px;line-height:1.4}
nav a:hover,nav a:focus-visible{background:#e9f3f9;border-color:#0076bd;color:#004575}
#search-status{font-size:12px;color:#5c6974;min-height:20px}main{padding:32px 42px 80px;min-width:0;max-width:1170px}
h1{font-size:30px;line-height:1.2;margin:0 0 18px;max-width:760px}h2{font-size:23px;line-height:1.3;margin:42px 0 16px;padding:20px 0 0;border-top:2px solid #cfdce5;scroll-margin-top:20px}
p,li{max-width:920px;font-size:16px}p{margin:14px 0}a{color:#0062a0}code{background:#e6edf2;padding:2px 5px;overflow-wrap:anywhere;font-size:13px}strong{color:#152b3d}
figure{margin:24px 0 30px;background:#fff;border:1px solid #d4dfe6;border-radius:6px;overflow:hidden}
.evidence{display:block;border:0;background:#e9edf0;padding:0;width:100%;text-align:center}
.evidence img{display:block;max-width:100%;max-height:650px;width:auto;height:auto;margin:auto;object-fit:contain}
figcaption{padding:12px 16px;font-size:14px;color:#415563;border-top:1px solid #d4dfe6}
dialog{padding:0;border:0;border-radius:6px;background:#fff;max-width:96vw;max-height:95vh}dialog::backdrop{background:#10202bdd}
dialog .toolbar{display:flex;gap:20px;align-items:center;padding:10px 16px;border-bottom:1px solid #d4dfe6}dialog .toolbar p{margin:0;font-size:14px;flex:1}
dialog button{width:44px;height:44px;border:1px solid #becbd4;border-radius:4px;background:#fff;font-size:24px}dialog img{display:block;max-width:94vw;max-height:82vh;object-fit:contain;margin:auto}
.actions{margin:22px 0;display:flex;gap:12px}.actions button{background:#fff;border:1px solid #8796a3;border-radius:4px;padding:8px 14px;font-size:14px}
mark{background:#fff0a6;color:#19272e}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #0084cb;outline-offset:3px}
@media(max-width:850px){.layout{grid-template-columns:210px minmax(0,1fr)}main{padding:24px}header{padding:16px}}
@media(max-width:620px){.layout{display:block}aside{position:static;height:auto;border-bottom:1px solid #dce3e8}header span{display:none}nav{display:grid;grid-template-columns:1fr 1fr}h1{font-size:26px}}
@media print{aside,header,.actions,dialog{display:none}.layout{display:block}main{padding:0;max-width:none}figure{break-inside:avoid}.evidence img{max-height:500px}h2{break-after:avoid}}
</style></head><body>
<header><img src="${logo}" alt="mWell"><strong>Intra / Feedback response</strong><span>UAT evidence | 28 August 2026</span></header>
<div class="layout"><aside><label for="search">Search this response</label><input id="search" type="search" placeholder="e.g. serial, quarantine"><p id="search-status" role="status"></p>
<nav aria-label="Report sections">${headings.map(({ id, label }) => `<a href="#${id}">${escape(label)}</a>`).join('')}</nav>
<div class="actions"><button id="print">Print / PDF</button></div></aside><main id="report">${article}</main></div>
<dialog aria-label="Screenshot evidence"><div class="toolbar"><p id="caption"></p><button aria-label="Close enlarged screenshot" autofocus>&times;</button></div><img alt=""></dialog>
<script>
const report = document.querySelector('#report');
const dialog = document.querySelector('dialog');
document.querySelectorAll('.evidence').forEach(button => button.addEventListener('click', () => {
  const source = button.querySelector('img');
  dialog.querySelector('img').src = source.src;
  dialog.querySelector('img').alt = source.alt;
  document.querySelector('#caption').textContent = source.alt;
  dialog.showModal();
}));
dialog.querySelector('button').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
document.querySelector('#print').addEventListener('click', () => window.print());
document.querySelector('#search').addEventListener('input', event => {
  report.querySelectorAll('mark').forEach(mark => mark.replaceWith(document.createTextNode(mark.textContent)));
  report.normalize();
  const term = event.target.value.trim().toLowerCase();
  if (term.length < 2) { document.querySelector('#search-status').textContent = ''; return; }
  const walker = document.createTreeWalker(report, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  nodes.forEach(node => {
    const text = node.textContent; const lower = text.toLowerCase();
    let cursor = 0, index = lower.indexOf(term); if (index < 0) return;
    const fragment = document.createDocumentFragment();
    while (index >= 0) {
      fragment.append(text.slice(cursor, index)); const mark = document.createElement('mark');
      mark.textContent = text.slice(index, index + term.length); fragment.append(mark); count++;
      cursor = index + term.length; index = lower.indexOf(term, cursor);
    }
    fragment.append(text.slice(cursor)); node.replaceWith(fragment);
  });
  document.querySelector('#search-status').textContent = count + ' matches';
});
</script></body></html>`;
writeFileSync(output, html);
console.log(`Wrote ${output} with ${headings.length} navigable sections and embedded evidence.`);
