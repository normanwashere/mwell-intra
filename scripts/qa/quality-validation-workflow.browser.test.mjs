import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { before, after, test } from 'node:test';
import { CURRENT_LIVE_SCENARIOS, WORKFLOW_SCENARIO_EVIDENCE } from './live-e2e-scenarios.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const definition = name => {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `actual ${name} declaration exists`);
  return node.getText(ast);
};
const names = ['warehouseQualityValidationWorkflow', 'routeReadinessSnapshot', 'describeRouteStructureProblems', 'waitForMeaningfulRoute'];
const definitions = names.map(definition).join('\n');
const compile = text => new Function('baseUrl', `${text}\nreturn warehouseQualityValidationWorkflow;`)('https://quality.fixture.test');
const workflow = compile(definitions);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture({ width = 390, empty = false, bypass = '', nested = false } = {}, run) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(1500);
  const captures = [];
  const html = `<main><h1>Quality control</h1>${empty ? '<p>No inspections waiting</p>' : `
    <details id="receipt"><summary>Receipt group</summary>
    ${nested ? '<details id="serial"><summary>Serial subgroup</summary>' : ''}
    <button id="inspect">Inspect</button>${nested ? '</details>' : ''}</details>
    <dialog aria-label="Inspect stock"><label>Disposition<select><option value="accepted">Accepted</option><option value="hold">Hold</option></select></label>
    <button id="submit" ${bypass === 'evidence' ? '' : 'disabled'}>Submit inspection</button><button id="close">Close</button></dialog>
    <script>
      document.querySelector('#inspect').onclick=()=>document.querySelector('dialog').showModal();
      document.querySelector('select').onchange=()=>{if(${JSON.stringify(bypass)}==='hold')document.querySelector('#submit').disabled=false;};
      document.querySelector('#submit').onclick=()=>document.body.dataset.submitted='true';
      document.querySelector('#close').onclick=()=>document.querySelector('dialog').close();
    </script>`}</main>`;
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  try { await run(page, async label => { captures.push(label); }, captures); }
  finally { await context.close(); }
}

for (const width of [390, 1440]) {
  test(`actual quality workflow expands nested closed groups and validates without submitting (${width})`, async () => {
    await fixture({ width, nested: true }, async (page, captureState, captures) => {
      const result = await workflow(page, { captureState });
      assert.equal(result.ok, true);
      assert.equal(result.validationState, 'evidence-and-hold-required');
      assert.equal(result.mutationPerformed, false);
      assert.equal(await page.locator('details:not([open])').count(), 0);
      assert.equal(await page.getByRole('dialog').count(), 0, 'Close dismissed the dialog');
      assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
      assert.deepEqual(captures, ['Quality evidence-required dialog', 'Quality hold validation']);
    });
  });
}

test('empty quality queue reports only empty validation, never an inspection mutation', async () => {
  await fixture({ empty: true }, async (page, captureState, captures) => {
    const result = await workflow(page, { captureState });
    assert.equal(result.ok, true);
    assert.equal(result.validationState, 'empty-queue');
    assert.equal(result.mutationPerformed, false);
    assert.deepEqual(captures, []);
  });
});

for (const bypass of ['evidence', 'hold']) {
  test(`actual quality workflow still rejects ${bypass} validation bypass`, async () => {
    await fixture({ bypass }, async (page, captureState) => {
      await assert.rejects(workflow(page, { captureState }), bypass === 'evidence'
        ? /bypassed required evidence/ : /bypassed reason and evidence/);
      assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    });
  });
}

test('old visible-only Inspect lookup cannot certify the collapsed fixture', async () => {
  const oldLookup = compile(definitions.replace('includeHidden: true', 'includeHidden: false'));
  await fixture({}, async (page, captureState) => {
    assert.equal((await oldLookup(page, { captureState })).ok, false);
  });
});

test('quality mutation transitions belong only to the actual supervisor transaction evidence', () => {
  const quality = WORKFLOW_SCENARIO_EVIDENCE.filter(item => item.scenarioId === 'warehouse-quality-and-return');
  for (const name of ['warehouse quality validation', 'warehouse return validation']) {
    assert.deepEqual(quality.find(item => item.workflow === name)?.checkpoints, []);
  }
  const transaction = definition('task3SupervisorTransactions');
  const workflowName = 'Task 3 supervisor quarantine and variance transactions';
  assert.ok(transaction.includes(`name: "${workflowName}"`));
  const owner = quality.find(item => item.workflow === workflowName);
  assert.deepEqual(owner?.checkpoints, ['inspection-created', 'vendor-return-visible']);
  assert.deepEqual(owner?.actors, ['operations_lead']);
  assert.match(transaction, /"inspect_quality"/);
  assert.match(transaction, /if \(!validPublicQuality\.ok\)/);
  assert.match(transaction, /await verifyCheckpoint\([\s\S]*?table: "quality_inspections"/);
  assert.match(transaction, /await verifyCheckpoint\([\s\S]*?table: "vendor_returns"[\s\S]*?status: "ready"/);
  for (const transition of owner.checkpoints) {
    assert.equal(quality.filter(item => item.checkpoints.includes(transition)).length, 1);
  }
  const scenario = CURRENT_LIVE_SCENARIOS.find(item => item.id === 'warehouse-quality-and-return');
  assert.deepEqual(scenario.checkpoints, ['inspection-created', 'hold-or-release-recorded', 'vendor-return-visible']);
});
