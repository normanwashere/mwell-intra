import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('audit.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'eventsCoordinatorReadbackWorkflow');
assert(node);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

for (const width of [1440, 390]) {
  test(`actual event handoff selects Product 1 beside another product and remove buttons (${width})`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(`<h1>Test event</h1><button id="request">Request warehouse stock</button>
      <dialog aria-label="Request warehouse stock">
        <label for="department">Department</label><select id="department"><option value="marketing">Marketing</option></select>
        <label for="purpose">Business purpose</label><input id="purpose">
        <label for="center">Cost center</label><select id="center"><option value="CC-4100">Marketing</option></select>
        <label for="product-1">Product 1</label><select id="product-1"><option value="test-watch">Test watch</option></select>
        <button aria-label="Remove product 1" disabled>Remove</button>
        <label for="product-2">Product 2</label><select id="product-2"><option value="test-material">Test material</option></select>
        <button aria-label="Remove product 2">Remove</button>
        <button id="submit">Submit for approval</button>
      </dialog>`);
    await page.evaluate(() => {
      document.querySelector('#request').onclick = () => document.querySelector('dialog').showModal();
      document.querySelector('#submit').onclick = () => document.querySelector('dialog').remove();
    });
    let readbacks = 0;
    const db = { schema(value) { assert.equal(value, 'warehouse'); return this; },
      from(value) { assert.equal(value, 'department_stock_requests'); return this; },
      select() { return this; }, eq() { return this; },
      async limit() { readbacks += 1; return { data: [{ id: 'request-1', status: 'pending_approval' }] }; } };
    const run = new Function('baseUrl', 'waitForMeaningfulRoute', 'createAuditDatabaseClient',
      `${node.getText(ast)}; return eventsCoordinatorReadbackWorkflow;`)('https://uat.example.test', async () => {}, () => db);
    page.goto = async () => null;
    page.reload = async () => null;
    try {
      const state = { eventId: 'event-1', eventName: 'Test event', marker: 'QA' };
      const result = await run(page, state);
      assert.equal(result.ok, true);
      assert.equal(state.fulfillmentRequestId, 'request-1');
      assert.equal(readbacks, 1);
      assert.equal(await page.getByRole('dialog').count(), 0);
    } finally { await context.close(); }
  });
}
