import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const marketing = JSON.parse(await readFile(new URL('../../modules/learning/src/marketing-reservation-assessment.json', import.meta.url), 'utf8'));
const marketingAnswers = ['respect-availability', 'hold-not-issue', 'event-product-purpose', 'reservation-only', 'reconcile-before-retry'];
export const ASSESSMENT_ANSWERS = new Map([
  ['What must be recorded before serialized stock can be received?', 'Delivery date, batch, and every unit serial'],
  ['What should happen when received stock is damaged or unidentified?', 'Keep it in controlled quality custody'],
  ...marketing.questions.map((question, index) => {
    const option = question.options.find(option => option.id === marketingAnswers[index]);
    assert(option, `Marketing assessment answer requires review: ${question.id}`);
    return [question.prompt, option.label];
  }),
]);

async function waitForAdvance(page, heading, timeout) {
  await page.waitForFunction(previous => {
    const title = document.querySelector('#training-coach-title');
    return !title || title.textContent.trim() !== previous || [...title.closest('[role="dialog"]').querySelectorAll('[role="alert"]')].some(el => el.textContent.trim() === 'Learning requirement is not in progress');
  }, heading, { timeout });
}

export async function waitForAssessmentResult(page, title, timeout = 15_000) {
  await page.waitForFunction(title => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(el => el.getClientRects().length);
    if (dialogs.some(el => el.innerText.includes('Assessment passed'))) return true;
    if (dialogs.length) return false;
    return [...document.querySelectorAll('li[id^="onboarding-requirement-"]')].some(row =>
      row.querySelector('h3')?.textContent.trim() === title && /\bComplete\b/.test(row.innerText));
  }, title, { timeout });
}

export async function receivingAction(page, heading) {
  const url = new URL(page.url());
  assert.equal(url.pathname, '/warehouse/receiving');
  assert.equal(url.searchParams.get('training'), 'warehouse-receiving-v1');
  await page.getByRole('region', { name: 'Training mode', exact: true }).waitFor();
  const minimize = page.getByRole('button', { name: 'Minimize training coach', exact: true });
  if (await minimize.isVisible()) await minimize.click();
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const expand = async () => {
    const button = page.getByRole('button', { name: 'Expand training coach', exact: true });
    if (await button.isVisible()) await button.click();
  };
  switch (heading) {
    case 'Confirm the purchase order': await click('Use practice order'); break;
    case 'Record delivery details':
      await page.getByLabel('Actual delivery date', { exact: true }).fill(new Date().toISOString().slice(0, 10));
      await click('Confirm delivery date'); break;
    case 'Identify the received item': {
      const product = page.getByLabel('Product', { exact: true });
      const options = await product.locator('option').evaluateAll(items => items.map(item => ({ value: item.value, label: item.textContent })));
      const watch = options.filter(option => /smart\s*watch/i.test(option.label));
      assert.equal(watch.length, 1, 'Receiving practice requires one seeded Smart Watch product');
      await product.selectOption(watch[0].value); break;
    }
    case 'Record the supplier batch':
      await page.getByLabel('Batch number', { exact: true }).fill('TRAIN-CI-BATCH');
      await click('Confirm batch number'); break;
    case 'Capture unit traceability':
      for (const serial of ['TRAIN-CI-0001', 'TRAIN-CI-0002']) {
        await page.getByLabel('Enter practice serial or sheet barcode', { exact: true }).fill(serial);
        await click('Record');
      }
      await expand(); await click('Confirm traceability'); break;
    case 'Choose controlled custody': await page.getByLabel('Put away to', { exact: true }).selectOption('TRAIN-QA-STAGING'); break;
    case 'Attach delivery evidence': await click('Attach practice delivery photo'); await click(/^damaged$/i); break;
    case 'Review the simulated receipt':
      // Recovery is a required curriculum checkpoint, not an optional shortcut.
      await expand();
      await page.getByRole('dialog').getByRole('button', { name: 'Resume later', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('region', { name: 'Training mode', exact: true }).getByRole('button', { name: 'Resume', exact: true }).click();
      await expand();
      await page.getByRole('dialog').getByRole('heading', { name: 'Receipt practice paused', exact: true }).waitFor();
      await click('Resume receipt');
      await page.getByRole('dialog').getByRole('heading', { name: 'Review the simulated receipt', exact: true }).waitFor();
      if (await minimize.isVisible()) await minimize.click();
      await click('Receive 2 item(s)'); break;
    case 'Receipt practice paused': await expand(); await click('Resume receipt'); break;
    default: throw new Error(`No audited receiving action for ${heading}`);
  }
  await expand();
}

export async function finishGuidedDialog(page, { timeout = 15_000 } = {}) {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout });
  for (let step = 0; step < 20; step += 1) {
    if (!(await dialog.isVisible())) return;
    const heading = (await dialog.locator('#training-coach-title').textContent()).trim();
    console.log(`    STEP ${heading}`);
    if (await dialog.getByText('Learning requirement is not in progress', { exact: true }).isVisible()) {
      await dialog.getByRole('button', { name: 'Exit training', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout });
      if (new URL(page.url()).pathname === '/warehouse/receiving') {
        await page.goto(new URL('/onboarding?next=%2Fwork', page.url()).href);
        await page.getByRole('heading', { name: 'Role onboarding', exact: true }).waitFor({ timeout });
      }
      return;
    }
    const finish = dialog.getByRole('button', { name: 'Finish review', exact: true });
    if (await finish.isVisible()) {
      await finish.click(); await dialog.waitFor({ state: 'hidden', timeout }); return;
    }
    if (new URL(page.url()).searchParams.get('training') === 'warehouse-receiving-v1') {
      if (heading === 'Receiving practice complete') {
        await dialog.getByText(/No live stock was changed/).waitFor({ timeout });
        await dialog.getByRole('button', { name: 'Exit training', exact: true }).click();
        await page.goto(new URL('/onboarding?next=%2Fwork', page.url()).href);
        await page.getByRole('heading', { name: 'Role onboarding', exact: true }).waitFor({ timeout });
        return;
      }
      await receivingAction(page, heading);
      await waitForAdvance(page, heading, timeout); continue;
    }
    const choices = dialog.getByRole('group').getByRole('button');
    const labels = await choices.allTextContents();
    if (labels.length) {
      let advanced = false;
      for (const label of labels) {
        // Do not skip an answer while the previous server evaluation is settling.
        const candidate = dialog.getByRole('button', { name: label.trim(), exact: true });
        const previousAlerts = (await dialog.getByRole('alert').allTextContents()).join('\n');
        await candidate.click({ timeout });
        await page.waitForFunction(({ previousHeading, previousAlerts }) => {
          const active = document.querySelector('#training-coach-title')?.closest('[role="dialog"]');
          if (!active || active.querySelector('#training-coach-title').textContent.trim() !== previousHeading) return true;
          const alerts = [...active.querySelectorAll('[role="alert"]')].map(el => el.textContent).join('\n');
          const enabled = [...active.querySelectorAll('[role="group"] button')].every(button => !button.disabled);
          return enabled && Boolean(alerts) && alerts !== previousAlerts;
        }, { previousHeading: heading, previousAlerts }, { timeout });
        if (!(await dialog.isVisible())) return;
        if ((await dialog.locator('#training-coach-title').textContent()).trim() !== heading) { advanced = true; break; }
      }
      assert(advanced, `No governed choice advanced training step ${heading}.`);
      continue;
    }
    const next = dialog.getByRole('button', { name: 'Continue', exact: true });
    await next.click({ timeout });
    await waitForAdvance(page, heading, timeout);
  }
  throw new Error('Role orientation exceeded the bounded step count.');
}
