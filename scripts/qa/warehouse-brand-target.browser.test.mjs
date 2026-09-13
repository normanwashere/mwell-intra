import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { after, before, test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const warehouseRequire = createRequire(new URL('../../modules/warehouse/package.json', import.meta.url));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('@playwright/test');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const config = require('tailwindcss/loadConfig')(path.join(root, 'apps/shell/tailwind.config.ts'));
const read = name => readFile(path.join(root, name), 'utf8');
const current = await read('modules/warehouse/src/components/AppShell.tsx');
const baseline = execFileSync('git', ['show', '48ca3a751e2983699cc87eb6e6ebca572e65d55a:modules/warehouse/src/components/AppShell.tsx'], { cwd: root, encoding: 'utf8' });
const logoModule = {};
const logoJs = ts.transpileModule(await read('modules/warehouse/src/components/Logo.tsx'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('React', 'require', 'exports', logoJs)(React, warehouseRequire, logoModule);

// Actual brand-row JSX and Logo, isolated from authentication and business state.
function brandRow(source) {
  const ast = ts.createSourceFile('AppShell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'a'
      && node.openingElement.attributes.properties.some(a => a.name?.getText(ast) === 'aria-label' && a.initializer?.text === 'Mwell Intra home')) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1);
  const row = matches[0].parent;
  assert.equal(row.openingElement.tagName.getText(ast), 'div');
  const aside = row.parent;
  assert.equal(aside.openingElement.tagName.getText(ast), 'aside');
  const asideClass = aside.openingElement.attributes.properties.find(a => a.name?.getText(ast) === 'className').initializer.text;
  const js = ts.transpileModule(`return (${row.getText(ast)});`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText;
  const element = new Function('React', 'Logo', js)(React, logoModule.Logo);
  return `<aside class="${asideClass}">${renderToStaticMarkup(element)}<div data-nav-start>Navigation starts here</div></aside>`;
}
const html = `<main class="flex gap-8"><section data-version="baseline">${brandRow(baseline)}</section><section data-version="candidate">${brandRow(current)}</section></main>`;
const { css } = await postcss([tailwind({ ...config, content: [{ raw: `${html}\n${current}`, extension: 'tsx' }] })])
  .process(await read('apps/shell/app/globals.css'), { from: undefined });
const styles = `${await read('packages/ui/src/styles.css')}\n${css}\n${await read('apps/shell/app/hierarchy-preview.css')}`;
const logo = await readFile(path.join(root, 'apps/shell/public/mwell-wordmark.png'));
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const width of [320, 390, 768, 1280, 1440]) for (const dark of [false, true]) {
  test(`source brand target preserves layout at ${width}, ${dark ? 'dark' : 'light'}`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => route.request().url() === 'https://brand-fixture.invalid/mwell-wordmark.png'
      ? route.fulfill({ contentType: 'image/png', body: logo }) : route.abort());
    const page = await context.newPage();
    try {
      await page.setContent(`<html class="${dark ? 'dark' : ''}"><head><base href="https://brand-fixture.invalid/"><style>${styles}\nbody{margin:0;font-family:Arial,sans-serif;background:var(--app);color:var(--ink)}[data-nav-start]{padding:12px}</style></head><body>${html}</body></html>`);
      const before = page.locator('[data-version="baseline"] a');
      const after = page.locator('[data-version="candidate"] a');
      if (width < 768) {
        assert.equal(await before.isVisible(), false);
        assert.equal(await after.isVisible(), false);
        return;
      }
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      const dimensions = link => link.evaluate(element => {
        const r = element.getBoundingClientRect();
        const p = element.parentElement.getBoundingClientRect();
        const logo = element.querySelector('img').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, rowHeight: p.height, logoHeight: logo.height,
          nextTop: element.parentElement.nextElementSibling.getBoundingClientRect().top };
      });
      const old = await dimensions(before), next = await dimensions(after);
      assert.equal(old.height, 28, 'Baseline reproduces the actual reported target');
      assert.equal(next.height, 44);
      assert.equal(next.rowHeight, old.rowHeight, 'Brand row must not grow');
      assert.equal(next.nextTop, old.nextTop, 'Navigation must not shift');
      assert.equal(next.logoHeight, old.logoHeight, 'Logo artwork must not resize');
      assert.equal(await after.getAttribute('href'), '/');
      assert.equal(await after.evaluate(element => {
        const r = element.getBoundingClientRect();
        return [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]]
          .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
      }), true);
      await page.evaluate(() => document.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (link) { event.preventDefault(); document.body.dataset.destination = link.getAttribute('href'); }
      }));
      await after.click();
      assert.equal(await page.locator('body').getAttribute('data-destination'), '/');
      await page.locator('body').evaluate(element => delete element.dataset.destination);
      await after.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('body').getAttribute('data-destination'), '/');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.WMS_BRAND_TARGET_SCREENSHOTS) {
        await mkdir(process.env.WMS_BRAND_TARGET_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.WMS_BRAND_TARGET_SCREENSHOTS, `brand-${width}-${dark ? 'dark' : 'light'}.png`) });
      }
    } finally { await context.close(); }
  });
}
