import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'apps/shell/test-results/warehouse-w1');

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(full));
    else if (/\.png$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const images = (await collect(root)).sort();
if (images.length === 0) throw new Error(`No warehouse W1 screenshots found under ${root}`);
const cards = images.map((file) => {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  return `<figure><a href="${relative}"><img src="${relative}" alt="${relative}" loading="lazy"></a><figcaption>${relative}</figcaption><label>Review <select><option>Pending</option><option>Pass</option><option>Fail</option></select></label><label>Defect <input aria-label="Defect for ${relative}"></label></figure>`;
}).join('\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Warehouse W1 visual review</title><style>body{font:14px system-ui;margin:20px;color:#17233b}header{position:sticky;top:0;background:#fff;padding:12px 0;z-index:2}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}figure{margin:0;border:1px solid #ccd6e5;padding:10px;border-radius:8px}img{display:block;width:100%;height:300px;object-fit:contain;background:#eef3f8}figcaption{margin:8px 0;overflow-wrap:anywhere}label{display:block;margin-top:6px}input,select{min-height:36px;width:100%}</style></head><body><header><h1>Warehouse W1 visual review</h1><p>${images.length} screenshots. Reviewer: <input> Date: <input type="date"></p></header><main>${cards}</main></body></html>`;
const output = path.join(root, 'contact-sheet.html');
await writeFile(output, html, 'utf8');
console.log(`Wrote ${output} with ${images.length} screenshots.`);
