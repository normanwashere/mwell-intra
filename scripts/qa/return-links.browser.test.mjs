import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const warehouseRequire = createRequire(new URL('../../modules/warehouse/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Link, MemoryRouter } = warehouseRequire('react-router-dom');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const loadConfig = require('tailwindcss/loadConfig');
const config = loadConfig(fileURLToPath(new URL('../../apps/shell/tailwind.config.ts', import.meta.url)));
const sources = await Promise.all(['ReturnsPage', 'FulfillmentPage'].map(async name => {
  const source = await readFile(new URL(`../../modules/warehouse/src/pages/${name}.tsx`, import.meta.url), 'utf8');
  return ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}));

// Render the actual page reference paragraph and generate its utilities with the shell preset.
// This is a local layout fixture, not a live page or workflow certification.
function renderReference(ast, destination, context, component = 'Link') {
  const matches = [];
  function visit(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening?.tagName.getText(ast) === component) {
      const attribute = opening.attributes.properties.find(attribute => attribute.name?.getText(ast) === (component === 'Link' ? 'to' : 'id'));
      const expression = attribute?.initializer?.expression?.getText(ast);
      if (component === 'Link' ? expression?.includes(destination) : expression === destination) matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, `unique source ${component} reference for ${destination}`);
  let paragraph = matches[0].parent;
  while (paragraph && !(ts.isJsxElement(paragraph) && paragraph.openingElement.tagName.getText(ast) === 'p')) paragraph = paragraph.parent;
  assert.ok(paragraph, 'reference retains its real paragraph layout and wrapping');
  const js = ts.transpileModule(`return (${paragraph.getText(ast)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const element = new Function('React', 'Link', ...Object.keys(context), js)(React, Link, ...Object.values(context));
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, element));
}

function physicalReturnComponent(canOpenReturns) {
  const declarations = sources[1].statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PhysicalReturnReference');
  assert.equal(declarations.length, 1, 'unique source PhysicalReturnReference implementation');
  const js = ts.transpileModule(`${declarations[0].getText(sources[1])}\nreturn PhysicalReturnReference;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('React', 'Link', 'useWarehouse', js)(React, Link, () => ({
    canOpenRoute: route => {
      assert.equal(route, 'returns', 'reference checks its destination read access');
      return canOpenReturns;
    },
  }));
}

function references(kind = 'mobile390', { canOpenReturns = true, hasSourceRecords = true } = {}) {
  const short = kind === 'short';
  const desktop = kind === 'desktop1440';
  const encoded = kind === 'encoded';
  const r = {
    sourceOrderId: encoded ? 'source/order ?#%' : 'source-order',
    returnCaseId: short ? 'c' : encoded ? 'case/return ?#%' : desktop ? 'fea31f02-fe3b-4cd9-bd65-8ea6b42e6ce7' : '3af625a8-7141-445a-9011-2b37e0b0ad8a',
  };
  const physical = { id: short ? 'r' : encoded ? 'ret/physical ?#%' : desktop ? 'ret-9653612b-bf28-48ae-81dc-faf310924e88' : 'ret-6b0eb97c-85ed-4943-a50d-0055c9bf4436' };
  const externalReference = short ? 'X' : `WMS-ECOM-177f0c97-a6de-4ee4-82b1-37a09f4f5e37-${kind}`;
  const data = { fulfillmentOrders: hasSourceRecords ? [{ id: r.sourceOrderId, externalReference }] : [], customerReturnCases: hasSourceRecords ? [{ id: r.returnCaseId }] : [] };
  const PhysicalReturnReference = physicalReturnComponent(canOpenReturns);
  return [
    { label: 'Original order', markup: renderReference(sources[0], 'encodeURIComponent(r.sourceOrderId)', { r, data }), href: `/fulfillment?tab=orders&order=${encodeURIComponent(r.sourceOrderId)}`, unavailableReferences: [r.sourceOrderId, externalReference] },
    { label: 'Customer case', markup: renderReference(sources[0], 'encodeURIComponent(r.returnCaseId)', { r, data }), href: `/fulfillment?tab=returns#return-case-${encodeURIComponent(r.returnCaseId)}`, unavailableReferences: [r.returnCaseId] },
    { label: 'Physical return', markup: renderReference(sources[1], 'physical.id', { physical, PhysicalReturnReference }, 'PhysicalReturnReference'), href: `/returns#return-${encodeURIComponent(physical.id)}` },
    { label: 'Order details physical return', markup: renderReference(sources[1], 'record.id', { record: physical, PhysicalReturnReference }, 'PhysicalReturnReference'), href: `/returns#return-${encodeURIComponent(physical.id)}` },
  ];
}

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const width of [320, 360, 390, 768, 1280, 1440]) {
  test(`source-rendered return references have reachable 44px targets (${width})`, async () => {
    const links = [...references(), ...references('desktop1440'), ...references('short'), ...references('encoded')];
    const html = `<main><h1>Return reference targets</h1>${links.map(({ markup }, index) => `<section data-reference="${index}">${markup}</section>`).join('')}</main>`;
    const { css } = await postcss([tailwind({ ...config, content: [{ raw: html, extension: 'html' }] })]).process('@tailwind base; @tailwind utilities;', { from: undefined });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    try {
      await page.setContent(`<style>${css}\nbody{font-family:Arial,sans-serif;background:#f0f2f4;color:#15212a}main{max-width:960px;margin:auto;padding:16px}h1{font-size:20px;margin-bottom:16px}section{max-width:420px;padding:12px;margin-bottom:12px;border:1px solid #ccd1d5;background:white}</style>${html}`);
      await page.evaluate(() => document.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (link) { event.preventDefault(); document.body.dataset.clicked = link.getAttribute('href'); }
      }));
      for (let index = 0; index < links.length; index += 1) {
        const link = page.locator(`[data-reference="${index}"] a`);
        assert.equal(await link.getAttribute('href'), links[index].href);
        await link.scrollIntoViewIfNeeded();
        const rect = await link.boundingBox();
        assert.ok(rect.width >= 44 && rect.height >= 44, `${links[index].label}: ${rect.width} x ${rect.height}`);
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width, 'target stays inside the viewport');
        assert.equal(await link.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return [
            [bounds.left + 2, bounds.top + 2], [bounds.right - 2, bounds.top + 2],
            [bounds.left + 2, bounds.bottom - 2], [bounds.right - 2, bounds.bottom - 2],
          ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
        }), true, 'the padded target is actually hit-testable, not only a large union box');
        await link.click();
        assert.equal(await page.locator('body').getAttribute('data-clicked'), links[index].href);
        await page.locator('body').evaluate(body => delete body.dataset.clicked);
        await link.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('body').getAttribute('data-clicked'), links[index].href);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.WMS_RETURN_LINK_SCREENSHOTS) {
        await mkdir(process.env.WMS_RETURN_LINK_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: join(process.env.WMS_RETURN_LINK_SCREENSHOTS, `return-links-${width}.png`), fullPage: true });
      }
    } finally { await context.close(); }
  });

  test(`source-rendered return references deny inaccessible destinations and hide unavailable sources (${width})`, async () => {
    const denied = references('encoded', { canOpenReturns: false, hasSourceRecords: false });
    const html = `<main>${denied.map(({ markup }, index) => `<section data-reference="${index}">${markup}</section>`).join('')}</main>`;
    const { css } = await postcss([tailwind({ ...config, content: [{ raw: html, extension: 'html' }] })]).process('@tailwind base; @tailwind utilities;', { from: undefined });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    try {
      await page.setContent(`<style>${css}\nmain{padding:16px}section{max-width:420px;padding:12px}</style>${html}`);
      assert.equal(await page.locator('a, [role="link"]').count(), 0, 'denied destinations do not offer navigation');
      for (let index = 0; index < denied.length; index += 1) {
        const text = await page.locator(`[data-reference="${index}"]`).textContent();
        if (denied[index].unavailableReferences) {
          assert.ok(text.includes('Reference unavailable'));
          for (const reference of denied[index].unavailableReferences) {
            assert.equal(text.includes(reference), false, 'unavailable source identities do not leak');
            assert.equal(html.includes(encodeURIComponent(reference)), false, 'unavailable source routes do not leak');
          }
        } else {
          assert.ok(text.includes('ret/physical ?#%'), 'already-visible intake reference is retained');
          assert.ok(text.includes('Warehouse returns team owns custody and inspection follow-up.'), 'denied route identifies the next owner');
          assert.equal(html.includes(denied[index].href), false, 'denied physical return route is absent');
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { await context.close(); }
  });
}
