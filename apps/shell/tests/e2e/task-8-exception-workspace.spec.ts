import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  actor,
  ControlledProcurementRpcFixture,
  installControlledRpc,
} from '../helpers/controlled-procurement-rpc';

type ExceptionActor = 'procurement' | 'exceptionReviewer' | 'exceptionFinance' | 'exceptionDoa';

async function signIn(page: Page, actorKey: ExceptionActor, redirect: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
}

async function completePettyEvidence(page: Page) {
  await page.getByLabel('Business justification').fill('Critical replenishment is required to keep the controlled clinical workflow available today.');
  await page.getByLabel('Receipt or invoice attached').check();
  await page.getByLabel('Liquidation recorded').check();
}

async function assertActionableInViewport(page: Page, buttonName: string) {
  const button = page.getByRole('button', { name: buttonName });
  await button.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await expect(button).toBeVisible();
  const visibility = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    return {
      inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
      receivesPointer: target === element || element.contains(target),
    };
  });
  expect(visibility.inViewport, `${buttonName} must be fully visible before activation`).toBe(true);
  expect(visibility.receivesPointer, `${buttonName} center point must not be covered by app chrome`).toBe(true);
  return button;
}

test('Task 8 governed exception workspace is usable across independent desktop and mobile lifecycle actors', async ({ browser }, testInfo) => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareExceptionWorkspace();
  fixture.failNextExceptionSubmit();
  const requestPath = `/procurement/requests/${fixture.requestId}`;
  const consoleErrors: string[] = [];
  const evidenceDir = resolve(process.cwd(), '../../docs/qa/evidence');
  mkdirSync(evidenceDir, { recursive: true });

  async function actorPage(actorKey: ExceptionActor) {
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    await installControlledRpc(context, fixture, actorKey);
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${actorKey}: ${message.text()}`);
    });
    await signIn(page, actorKey, requestPath);
    await expect(page.getByRole('region', { name: 'Governed exception workspace' })).toBeVisible();
    return { context, page };
  }

  const submitter = await actorPage('procurement');
  await completePettyEvidence(submitter.page);
  await submitter.page.getByRole('button', { name: 'Submit governed evidence' }).click();
  await expect(submitter.page.getByText('Controlled server validation failed; correct the evidence and try again.')).toBeVisible();
  await submitter.page.getByRole('button', { name: 'Submit governed evidence' }).click();
  await expect(submitter.page.getByText('under review', { exact: true })).toBeVisible();
  await submitter.page.screenshot({ path: resolve(evidenceDir, `task-8-exception-submitter-${testInfo.project.name}.png`), fullPage: true });
  await submitter.context.close();

  const procurement = await actorPage('exceptionReviewer');
  await expect(procurement.page.getByText('Your independent decision')).toBeVisible();
  await procurement.page.getByLabel('Decision note').fill('Procurement independently verified the receipt, liquidation, and policy eligibility.');
  await procurement.page.getByRole('button', { name: 'Approve as Procurement' }).click();
  await expect(procurement.page.getByText('Procurement: approved')).toBeVisible();
  await procurement.context.close();

  const finance = await actorPage('exceptionFinance');
  await expect(finance.page.getByText('Your independent decision')).toBeVisible();
  await finance.page.getByLabel('Decision note').fill('Finance independently verified petty-cash eligibility and liquidation evidence.');
  await finance.page.getByRole('button', { name: 'Approve as Finance' }).click();
  await expect(finance.page.getByText('Finance: approved')).toBeVisible();
  await finance.context.close();

  const doa = await actorPage('exceptionDoa');
  await expect(doa.page.getByText('Your independent decision')).toBeVisible();
  await doa.page.getByLabel('Decision note').fill('The active Operations DOA assignment approves this controlled exception.');
  await doa.page.getByRole('button', { name: 'Approve as DOA' }).click();
  await expect(doa.page.getByText('DOA: approved')).toBeVisible();
  fixture.failNextExceptionWorkspaceLoad();
  await doa.page.getByRole('button', { name: 'Refresh exception workspace' }).click();
  await expect(doa.page.getByText('Controlled workspace refresh failure')).toBeVisible();
  await doa.page.getByRole('button', { name: 'Refresh exception workspace' }).click();
  await expect(doa.page.getByRole('heading', { name: 'Decision history' })).toBeVisible();
  await doa.page.screenshot({ path: resolve(evidenceDir, `task-8-exception-history-${testInfo.project.name}.png`), fullPage: true });
  await doa.context.close();

  fixture.markExceptionStale();
  const recovery = await actorPage('procurement');
  await recovery.page.getByRole('button', { name: 'Refresh exception workspace' }).click();
  await expect(recovery.page.getByText('policy profile changed restart exception')).toBeVisible();
  await expect(recovery.page.getByRole('heading', { name: 'Replace stale exception evidence' })).toBeVisible();
  await recovery.page.getByLabel('Business justification').fill('Replacement petty-cash evidence reflects the current effective policy profile and retained receipt plus liquidation proof.');
  await recovery.page.getByLabel('Receipt or invoice attached').uncheck();
  await recovery.page.getByLabel('Receipt or invoice attached').check();
  await recovery.page.getByLabel('Liquidation recorded').uncheck();
  await recovery.page.getByLabel('Liquidation recorded').check();
  const replacementSubmit = await assertActionableInViewport(recovery.page, 'Submit governed evidence');
  await recovery.page.screenshot({ path: resolve(evidenceDir, `task-8-exception-recovery-${testInfo.project.name}.png`), fullPage: true });
  await replacementSubmit.click();
  await expect(recovery.page.getByText('under review', { exact: true })).toBeVisible();
  await expect(recovery.page.getByText('Evidence submitted: submitted')).toBeVisible();
  await expect(recovery.page.getByText('policy profile changed restart exception')).toHaveCount(0);
  await recovery.page.screenshot({ path: resolve(evidenceDir, `task-8-exception-recovery-submitted-${testInfo.project.name}.png`), fullPage: true });
  await recovery.context.close();

  // These are the two deliberate 400 responses exercised above: submit
  // validation and an explicit refresh failure. Any additional console error
  // is a regression in the rendered lifecycle.
  expect(consoleErrors).toEqual([
    'procurement: Failed to load resource: the server responded with a status of 400 (Bad Request)',
    'exceptionDoa: Failed to load resource: the server responded with a status of 400 (Bad Request)',
  ]);
  expect(fixture.callsNamed('submit_policy_exception_pack').map((call) => call.actor)).toEqual([
    actor('procurement').id,
    actor('procurement').id,
    actor('procurement').id,
  ]);
  expect(fixture.callsNamed('review_policy_exception_pack').map((call) => call.actor)).toEqual([
    actor('exceptionReviewer').id,
    actor('exceptionFinance').id,
    actor('exceptionDoa').id,
  ]);
});
