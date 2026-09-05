import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { before, after, test } from 'node:test';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const ts = require('typescript');
const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('audit.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'waitForExcessSaveOutcome');
assert.ok(helper);
const waitForOutcome = new Function(`${helper.getText(ast)}; return waitForExcessSaveOutcome;`)();
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(run) {
  const context = await browser.newContext();
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent('<div role="alert">Unrelated background error</div><div role="dialog" aria-label="Disposition"><p role="alert" hidden>Stale hidden error</p><button>Save</button></div>');
  try { await run(page, page.getByRole('dialog', { name: 'Disposition', includeHidden: true })); }
  finally { await context.close(); }
}

test('visible server error fails promptly with exact text and leaves dialog open', async () => {
  await fixture(async (page, dialog) => {
    const message = 'approved_amendment_id: amendment does not cover custody (400)';
    await dialog.evaluate((element, text) => {
      setTimeout(() => { const alert = document.createElement('p'); alert.role = 'alert'; alert.textContent = text; element.append(alert); }, 50);
    }, message);
    const start = Date.now();
    await assert.rejects(waitForOutcome(page, dialog, 5000), { message: `Excess custody disposition failed: ${message}` });
    assert.ok(Date.now() - start < 2000, 'does not wait for the detached timeout');
    assert.equal(await dialog.isVisible(), true);
  });
});

test('successful detach passes despite hidden and unrelated background alerts', async () => {
  await fixture(async (page, dialog) => {
    await dialog.evaluate(element => { setTimeout(() => element.remove(), 50); });
    await waitForOutcome(page, dialog, 2000);
    assert.equal(await dialog.count(), 0);
  });
});

test('already detached success passes', async () => {
  await fixture(async (page, dialog) => {
    await dialog.evaluate(element => element.remove());
    await waitForOutcome(page, dialog, 1000);
  });
});

test('hidden attached dialog and absent inline error cannot fake success', async () => {
  await fixture(async (page, dialog) => {
    await dialog.evaluate(element => { element.style.display = 'none'; });
    await assert.rejects(waitForOutcome(page, dialog, 200), /did not close the dialog or report an inline error/);
    assert.equal(await dialog.count(), 1);
  });
});

test('excess workflow retains database checkpoints after the outcome wait', () => {
  const workflow = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'task3SupervisorExcessFinalDisposition').getText(ast);
  assert.match(workflow, /Record final disposition[\s\S]*?\.click\(\);\s*await waitForExcessSaveOutcome\(page, custodyDialog\);\s*await verifyCheckpoint/);
  assert.match(workflow, /status: "accepted_amendment"/);
  assert.match(workflow, /name: "Final excess custody disposition",\s*includeHidden: true/);
  assert.match(workflow, /expected: \{ quantity: 2, received_quantity: 2 \}/);
});
