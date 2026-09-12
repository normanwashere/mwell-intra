import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { finishGuidedDialog, ASSESSMENT_ANSWERS, waitForAssessmentResult, receivingAction } from './orientation-driver.mjs';
const { chromium } = createRequire(new URL('../../apps/shell/package.json', import.meta.url))('@playwright/test');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

test('waits for a rejected choice to settle before choosing the next, without waiting for absent alerts', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="dialog"><h2 id="training-coach-title">Review the Procurement handoff</h2><div role="group"><button>Receive now</button><button>Return the handoff</button><button>Override approval</button></div><p role="alert" hidden></p></div>');
    await page.evaluate(() => {
      window.answers = [];
      const buttons = [...document.querySelectorAll('button')];
      buttons.forEach((button, index) => button.onclick = () => {
        window.answers.push(index);
        buttons.forEach(b => b.disabled = true);
        if (index === 0) {
          const alert = document.querySelector('[role="alert"]');
          alert.hidden = false; alert.textContent = 'Return for missing approvals.';
          setTimeout(() => buttons.forEach(b => b.disabled = false), 200);
        } else if (index === 1) {
          setTimeout(() => { document.querySelector('[role="dialog"]').innerHTML = '<h2 id="training-coach-title">Guided practice complete</h2><button onclick="this.parentElement.remove()">Finish review</button>'; }, 200);
        }
      });
    });
    await finishGuidedDialog(page, { timeout: 1500 });
    assert.deepEqual(await page.evaluate(() => window.answers), [0, 1]);
  } finally { await page.close(); }
});

test('waits for each Continue transition rather than submitting a checkpoint twice', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="dialog"><h2 id="training-coach-title">First</h2><button>Continue</button></div>');
    await page.evaluate(() => {
      window.clicks = 0;
      document.querySelector('button').onclick = () => {
        window.clicks++;
        setTimeout(() => { document.querySelector('[role="dialog"]').innerHTML = '<h2 id="training-coach-title">Complete</h2><button onclick="this.parentElement.remove()">Finish review</button>'; }, 200);
      };
    });
    await finishGuidedDialog(page, { timeout: 1500 });
    assert.equal(await page.evaluate(() => window.clicks), 1);
  } finally { await page.close(); }
});

test('fails when a valid response never advances, rather than treating the dialog as complete', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="dialog"><h2 id="training-coach-title">Stuck</h2><button>Continue</button></div>');
    await assert.rejects(finishGuidedDialog(page, { timeout: 200 }), /Timeout/);
  } finally { await page.close(); }
});

test('answers all current Marketing questions without expanding Warehouse authority', () => {
  assert.equal(ASSESSMENT_ANSWERS.size, 7);
  assert.match(ASSESSMENT_ANSWERS.get('An event needs 10 units. Only 8 are available to reserve after existing commitments. What should Marketing do?'), /Reserve no more than 8/);
  assert.equal(ASSESSMENT_ANSWERS.get('Does passing Marketing reservation training authorize Marketing to issue stock, process return custody, release quality holds, or approve adjustments?'), 'No. It certifies reservation only, and the active Marketing role grant is still required');
  assert.equal(ASSESSMENT_ANSWERS.get('An unknown assessment'), undefined);
});

test('accepts assessment auto-close only with matching completed requirement readback', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<ol><li id="onboarding-requirement-test"><h3>Marketing test</h3><span>Not started</span></li><li id="onboarding-requirement-other"><h3>Other</h3><span>Complete</span></li></ol>');
    await assert.rejects(waitForAssessmentResult(page, 'Marketing test', 200), /Timeout/);
    await page.locator('#onboarding-requirement-test span').evaluate(el => el.textContent = 'Complete');
    await waitForAssessmentResult(page, 'Marketing test', 200);
  } finally { await page.close(); }
});

test('receiving uses the UAT product value and case-insensitive visible condition label, only in training mode', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: `<section aria-label="Training mode"><label for="product">Product</label><select id="product"><option value="">Select</option><option value="uat-uuid">mWell Smart Watch</option></select><button onclick="document.getElementById('condition').disabled=false">Attach practice delivery photo</button><button id="condition" disabled style="text-transform:capitalize" onclick="window.chosen=true">damaged</button></section>` }));
    await page.goto('https://fixture.test/warehouse/receiving?training=warehouse-receiving-v1');
    await receivingAction(page, 'Identify the received item');
    assert.equal(await page.getByLabel('Product').inputValue(), 'uat-uuid');
    await receivingAction(page, 'Attach delivery evidence');
    assert.equal(await page.evaluate(() => window.chosen), true);
    await page.goto('https://fixture.test/warehouse/receiving');
    await assert.rejects(receivingAction(page, 'Identify the received item'), /warehouse-receiving-v1/);
  } finally { await page.close(); }
});
