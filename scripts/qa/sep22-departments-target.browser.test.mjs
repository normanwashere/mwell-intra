import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const esbuild = require('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const config = require('tailwindcss/loadConfig')(path.join(root, 'apps/shell/tailwind.config.ts'));
const sourcePath = 'apps/shell/app/admin/departments/page.tsx';
const baselineCommit = '46b0b85664aee50efd2f334cfdb90ee70b9a6061';
const read = name => readFile(path.join(root, name), 'utf8');
const sources = {
  baseline: execFileSync('git', ['show', `${baselineCommit}:${sourcePath}`], { cwd: root, encoding: 'utf8' }),
  candidate: await read(sourcePath),
};
const bundle = await esbuild.build({
  stdin: { contents: "export { Button } from './src/Button'; export { Badge } from './src/primitives';", resolveDir: path.join(root, 'packages/ui') },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
});
const ui = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(uiRequire, ui, ui.exports);

// Render the actual cost-center section, not a hand-copied table or a live route.
function renderSection(source, populated) {
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      attribute.name?.getText(ast) === 'aria-label' && attribute.initializer?.text === 'Department hierarchy table')) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, 'the target region must be unique');
  const section = matches[0].parent;
  assert.equal(section.openingElement.tagName.getText(ast), 'section');
  const js = ts.transpileModule(`return (${section.getText(ast)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    ...ui.exports, isLive: true, openCostCenter: () => {},
    departments: [{ code: 'operations', name: 'Operations' }],
    costCenters: populated ? [{ id: 'synthetic-cost-center', department_code: 'operations',
      cost_center_code: 'CC-SYNTHETIC', name: 'Synthetic operations', is_active: true }] : [],
  };
  const element = new Function('React', ...Object.keys(context), js)(React, ...Object.values(context));
  return renderToStaticMarkup(element);
}

const { css } = await postcss([tailwind({ ...config, content: [
  ...Object.values(sources).map(raw => ({ raw, extension: 'tsx' })),
  { raw: 'p-4 mb-6 text-2xl font-bold', extension: 'html' },
] })]).process(await read('apps/shell/app/globals.css'), { from: undefined });
// next/font is not loaded in this network-blocked component fixture.
const styles = `${await read('packages/ui/src/styles.css')}\n${css}\n:root{--font-poppins:Arial,sans-serif;--font-jbmono:monospace}`;
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const width of [320, 360, 390, 768, 1440]) for (const populated of [false, true]) {
  const state = populated ? 'populated' : 'header-only';
  test(`Departments scroll target retains accessible geometry at ${width}, ${state}`, async t => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const requests = [], errors = [], geometry = {};
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      for (const [version, source] of Object.entries(sources)) {
        await page.setContent(`<html><head><title>Departments offline ${version} fixture</title><style>${styles}</style></head><body><main class="p-4"><h1 class="mb-6 text-2xl font-bold">Departments</h1>${renderSection(source, populated)}</main></body></html>`);
        assert.equal(page.url(), 'about:blank');
        assert.equal(await page.title(), `Departments offline ${version} fixture`);
        const region = page.getByRole('region', { name: 'Department hierarchy table' });
        assert.equal(await region.getAttribute('tabindex'), '0');
        assert.equal(await region.locator('tbody tr').count(), populated ? 1 : 0);
        geometry[version] = await region.boundingBox();
        if (process.env.DEPARTMENTS_TARGET_SCREENSHOTS) {
          await mkdir(process.env.DEPARTMENTS_TARGET_SCREENSHOTS, { recursive: true });
          await page.locator('main').screenshot({ path: path.join(process.env.DEPARTMENTS_TARGET_SCREENSHOTS, `departments-${version}-${width}-${state}.png`) });
        }
        await region.focus();
        assert.equal(await region.evaluate(element => element === document.activeElement), true);
        assert.equal(await region.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return [[bounds.left + 1, bounds.top + 1], [bounds.right - 1, bounds.bottom - 1]]
            .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
        }), true, 'the region remains hit-testable');
        if (width < 640) {
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('[aria-label="Department hierarchy table"]').scrollLeft > 0);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      t.diagnostic(JSON.stringify({ width, state, geometry }));
      if (!populated) {
        assert.equal(geometry.baseline.height, 42, 'pinned CI source reproduces the reported 42px target');
        if (width === 390) assert.equal(geometry.baseline.width, 358);
      } else {
        assert.equal(geometry.candidate.height, geometry.baseline.height, 'populated rows must not grow');
      }
      assert.equal(geometry.candidate.width, geometry.baseline.width, 'target width must not change');
      assert.ok(geometry.candidate.width >= 44 && geometry.candidate.height >= 44,
        `candidate target is ${geometry.candidate.width} x ${geometry.candidate.height}`);
      assert.equal(requests.length, 0, 'offline fixture must make no network requests');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
