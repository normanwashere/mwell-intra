import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  actor,
  ControlledProcurementRpcFixture,
  installControlledRpc,
  type ActorKey,
} from '../helpers/controlled-procurement-rpc';

type ControlledSession = {
  actorKey: ActorKey;
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
  failedControlledRequests: string[];
  controlledResponses: string[];
  close: () => Promise<void>;
};
const evidenceDirectory = resolve(process.cwd(), '../../docs/qa/evidence');

async function settleCleanup(operation: Promise<void>) {
  await Promise.race([
    operation,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  // Browser contexts can retain a background Supabase refresh during teardown.
  // The close was initiated above; do not let that background request hide test evidence.
}

async function signIn(page: Page, actorKey: ActorKey, redirect: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
}

async function controlledSession(browser: Browser, fixture: ControlledProcurementRpcFixture, actorKey: ActorKey, redirect: string, testInfo: TestInfo, traceName: string): Promise<ControlledSession> {
  const context: BrowserContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedControlledRequests: string[] = [];
  const controlledResponses: string[] = [];
  const captureTrace = traceName === 'legal-decider' || traceName === 'closure-approver';
  let closed = false;
  await installControlledRpc(context, fixture, actorKey);
  if (captureTrace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on('pageerror', (cause) => {
    const diagnostic = `${cause.message}\n${cause.stack ?? ''}`;
    pageErrors.push(diagnostic);
    console.error(`Task 10 ${actorKey} page error: ${diagnostic}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const diagnostic = `${message.text()}${message.location().url ? `\n${message.location().url}:${message.location().lineNumber}` : ''}`;
    consoleErrors.push(diagnostic);
    console.error(`Task 10 ${actorKey} console error: ${diagnostic}`);
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? '';
    // Context teardown deliberately cancels in-flight background refreshes.
    // Keep genuine transport and authorization failures as journey failures.
    if (errorText.includes('net::ERR_ABORTED')) return;
    if (request.url().includes('/rest/v1/') || request.url().includes('/auth/v1/')) failedControlledRequests.push(`${request.method()} ${request.url()} ${errorText}`);
  });
  page.on('response', (response) => {
    if (!response.url().includes('/rest/v1/rpc/')) return;
    const url = new URL(response.url());
    const diagnostic = `${response.status()} ${url.pathname}${url.search}`;
    controlledResponses.push(diagnostic);
    if (response.status() >= 400) failedControlledRequests.push(diagnostic);
  });
  await signIn(page, actorKey, redirect);
  return {
    actorKey,
    page,
    pageErrors,
    consoleErrors,
    failedControlledRequests,
    controlledResponses,
    close: async () => {
      if (closed) return;
      closed = true;
      mkdirSync(evidenceDirectory, { recursive: true });
      if (captureTrace) {
        await settleCleanup(context.tracing.stop({ path: resolve(evidenceDirectory, `task-10-${traceName}-${testInfo.project.name}.zip`) }));
      }
      await settleCleanup(context.close());
    },
  };
}

test('Task 10 controlled signed-in authority journey proves Legal recovery through independent governed closure', async ({ browser }, testInfo) => {
  test.skip(!['desktop-1440', 'mobile-390'].includes(testInfo.project.name), 'Retain controlled authority evidence at the required desktop and mobile viewports.');
  test.setTimeout(180_000);
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  const requestPath = `/procurement/requests/${fixture.requestId}`;
  const poPath = '/procurement/purchase-orders/controlled-po-task-10';
  const sessions: ControlledSession[] = [];
  const progress: string[] = [];
  const mark = (stage: string) => { progress.push(stage); console.log(`Task 10 ${testInfo.project.name}: ${stage}`); };
  const openSession = async (actorKey: ActorKey, redirect: string, traceName: string) => {
    const session = await controlledSession(browser, fixture, actorKey, redirect, testInfo, traceName);
    sessions.push(session);
    return session;
  };

  try {
  const legalMaker = await openSession('legalMaker', '/legal/cases', 'legal-maker');
  await expect(legalMaker.page.getByRole('region', { name: 'Legal VMO eligibility authority workspace' })).toBeVisible();
  await legalMaker.page.getByLabel('PO win rate').fill('0.2');
  await legalMaker.page.getByLabel('Delivery commitment rate').fill('1');
  await legalMaker.page.getByLabel('Document timeliness rate').fill('1');
  await legalMaker.page.getByLabel('Returns or rejections').fill('0');
  await legalMaker.page.locator('#probation-evidence').fill('private/review-10.pdf');
  await legalMaker.page.locator('#probation-notice').fill('private/review-10-notice.pdf');
  await legalMaker.page.getByRole('button', { name: 'Record probation evidence' }).click();
  await expect(legalMaker.page.getByText('Legal/VMO authority record saved.')).toBeVisible();
  await legalMaker.page.getByLabel('Temporary clearance scope').fill('goods');
  await legalMaker.page.locator('#clearance-effective').fill('2026-08-22T00:00');
  await legalMaker.page.locator('#clearance-expires').fill('2026-09-22T00:00');
  await legalMaker.page.getByLabel('Amount limit').fill('1000');
  await legalMaker.page.locator('#clearance-evidence').fill('private/clearance-10.pdf');
  await legalMaker.page.locator('#clearance-notice').fill('private/clearance-10-notice.pdf');
  await legalMaker.page.getByRole('button', { name: 'Open clearance for independent decision' }).click();
  await expect(legalMaker.page.getByText('Legal/VMO authority record saved.')).toBeVisible();
  await legalMaker.close();
  mark('legal maker recorded probation and clearance');

  const legalDecider = await openSession('legalDecider', '/legal/cases', 'legal-decider');
  await expect(legalDecider.page.getByRole('region', { name: 'Legal VMO eligibility authority workspace' })).toBeVisible();
  await legalDecider.page.getByLabel('Clearance ID').fill('controlled-clearance-10');
  await legalDecider.page.getByLabel('Expected revision').last().fill('1');
  await legalDecider.page.getByRole('button', { name: 'Record independent clearance decision' }).click();
  await expect(legalDecider.page.getByText('Legal/VMO authority record saved.')).toBeVisible();
  await expect(legalDecider.page.getByRole('region', { name: 'Vendor eligibility projection' })).toContainText(/temporary clearance/i);
  mkdirSync(evidenceDirectory, { recursive: true });
  await legalDecider.page.screenshot({ path: resolve(evidenceDirectory, `task-10-legal-recovery-${testInfo.project.name}.png`), fullPage: true });
  await legalDecider.close();
  mark('independent Legal clearance activated');

  const procurement = await openSession('procurement', requestPath, 'procurement');
  await expect(procurement.page.getByRole('region', { name: 'Governed competitive sourcing' })).toBeVisible();
  await procurement.page.getByLabel('Vendor to invite').selectOption('vendor-1');
  await procurement.page.getByRole('button', { name: 'Record invitation' }).click();
  await expect(procurement.page.getByText('Controlled vendor invitation recorded')).toBeVisible();
  await expect(procurement.page.getByText('Approved', { exact: true })).toBeVisible();
  await procurement.page.goto(poPath);
  expect(procurement.pageErrors, `PO route page errors\n${procurement.controlledResponses.join('\n')}`).toEqual([]);
  await expect(procurement.page.getByText('PO-CONTROLLED-010')).toBeVisible();
  const issueButton = procurement.page.getByRole('button', { name: 'Issue to vendor' }).first();
  await expect(issueButton).toBeEnabled();
  await issueButton.click();
  await expect(procurement.page.getByText('PO PO-CONTROLLED-010 issued')).toBeVisible();
  await expect(procurement.page.getByText('PO package and monitoring')).toBeVisible();
  await procurement.close();
  mark('Procurement invited and issued PO');

  const requester = await openSession('operations', poPath, 'requester');
  await expect(requester.page.getByRole('heading', { name: 'Goods acceptance' })).toBeVisible();
  await expect(requester.page.getByText('QC accepted 1')).toBeVisible();
  await requester.page.getByRole('button', { name: 'Record goods acceptance' }).click();
  await expect(requester.page.getByText('Goods acceptance recorded')).toBeVisible();
  await requester.close();
  mark('requester recorded goods acceptance');

  const paymentPreparer = await openSession('procurement', poPath, 'payment-preparer');
  await expect(paymentPreparer.page.getByText('Acceptance and payment readiness')).toBeVisible();
  await paymentPreparer.page.getByLabel('Invoice / SI number').fill('SI-CONTROLLED-010');
  await paymentPreparer.page.getByLabel('Invoice amount').fill('1000');
  await paymentPreparer.page.getByLabel('Tax amount').fill('100');
  await paymentPreparer.page.getByLabel('Withholding amount').fill('20');
  await paymentPreparer.page.getByLabel('Invoice date').fill('2026-08-23');
  await paymentPreparer.page.getByLabel('Due date').fill('2026-09-23');
  await paymentPreparer.page.getByLabel('Invoice, OR, or SI private reference').fill('private/invoice-10.pdf');
  await paymentPreparer.page.getByLabel('Delivery or milestone private reference').fill('private/acceptance-10.pdf');
  await paymentPreparer.page.getByLabel('Tax and withholding private reference').fill('private/tax-10.pdf');
  await paymentPreparer.page.getByRole('button', { name: 'Validate match and send to Finance' }).click();
  await expect(paymentPreparer.page.getByText('Payment evidence sent to Finance')).toBeVisible();
  await expect(paymentPreparer.page.getByText('Ready for Finance')).toBeVisible();
  await paymentPreparer.close();
  mark('Procurement sent payment evidence');

  const finance = await openSession('finance', poPath, 'finance');
  await expect(finance.page.getByText('Acceptance and payment readiness')).toBeVisible();
  await finance.page.getByLabel('Finance review note').fill('Controlled three-way match accepted.');
  await finance.page.getByRole('button', { name: 'Accept for payment' }).click();
  await expect(finance.page.getByText('Finance accepted')).toBeVisible();
  await finance.page.getByLabel('Payment reference').fill('CONTROLLED-RELEASE-10');
  await finance.page.getByRole('button', { name: 'Post payment release' }).click();
  await expect(finance.page.getByText('Finance released')).toBeVisible();
  await finance.close();
  mark('Finance accepted and released payment');

  const closureRequester = await openSession('procurement', poPath, 'closure-requester');
  await expect(closureRequester.page.getByLabel('Governed closure reason')).toBeVisible();
  await closureRequester.page.getByLabel('Governed closure reason').fill('Controlled obligations complete.');
  await closureRequester.page.getByRole('button', { name: 'Request governed closure' }).click();
  await expect(closureRequester.page.getByText('Request governed closure')).toBeVisible();
  await closureRequester.close();
  mark('Procurement requested closure');

  const approver = await openSession('deptHead', poPath, 'closure-approver');
  await expect(approver.page.getByRole('region', { name: 'Independent closure approval' })).toContainText('Controlled obligations complete.');
  await approver.page.getByRole('button', { name: 'Approve governed closure' }).click();
  await expect(approver.page.getByText('Independent governed closure approved')).toBeVisible();
  await expect(approver.page.getByRole('region', { name: 'Independent closure approval' })).toContainText('Governed closure approved by an independent final approver.');
  await expect(approver.page.getByText('Closed', { exact: true })).toBeVisible();
  await expect(approver.page.getByText('Closure', { exact: true }).locator('..')).toContainText('closed');
  await expect(approver.page.getByText('Issue controls satisfied before closure')).toBeVisible();
  await expect(approver.page.getByText('Package closed')).toBeVisible();
  await expect(approver.page.getByText('QC:').locator('..')).toContainText('accepted');
  await expect(approver.page.getByText('Ready to commit')).toHaveCount(0);
  await expect(approver.page.getByText('issue', { exact: true })).toHaveCount(0);
  await expect(approver.page.getByText('not_received', { exact: true })).toHaveCount(0);
  await expect(approver.page.getByRole('button', { name: 'Approve governed closure' })).toHaveCount(0);
  await approver.page.screenshot({ path: resolve(evidenceDirectory, `task-10-governed-closure-${testInfo.project.name}.png`), fullPage: true });
  await approver.close();
  mark('independent approver completed closure');

  expect(fixture.callsNamed('record_vendor_probation_review').map((call) => call.actor)).toEqual(['controlled-legal-maker']);
  expect(fixture.callsNamed('decide_vendor_temporary_clearance').map((call) => call.actor)).toEqual(['controlled-legal-decider']);
  expect(fixture.callsNamed('invite_sourcing_vendors').map((call) => call.actor)).toEqual(['controlled-procurement']);
  expect(fixture.callsNamed('issue_purchase_order').map((call) => call.actor)).toEqual(['controlled-procurement']);
  expect(fixture.callsNamed('record_acceptance_pack').map((call) => call.actor)).toEqual(['controlled-operations']);
  expect(fixture.callsNamed('review_payment_readiness').map((call) => call.actor)).toEqual(['controlled-finance']);
  expect(fixture.callsNamed('release_payment').map((call) => call.actor)).toEqual(['controlled-finance']);
  expect(fixture.callsNamed('approve_purchase_order_closure').map((call) => call.actor)).toEqual(['controlled-department-head']);
  expect(fixture.task10).toMatchObject({ vendorCurrent: true, acceptance: true, prepared: true, accepted: true, released: true, closureRequested: true, closed: true });
  for (const session of sessions) {
    expect(session.pageErrors, `${session.actorKey} browser page errors\n${session.controlledResponses.join('\n')}`).toEqual([]);
    expect(session.consoleErrors, `${session.actorKey} browser console\n${session.controlledResponses.join('\n')}`).toEqual([]);
    expect(session.failedControlledRequests, `${session.actorKey} controlled network\n${session.controlledResponses.join('\n')}`).toEqual([]);
  }
  } finally {
    await testInfo.attach('task-10-controlled-journey-progress', {
      body: JSON.stringify({ progress, sessions: sessions.map((session) => ({ actor: session.actorKey, pageErrors: session.pageErrors, consoleErrors: session.consoleErrors, failedControlledRequests: session.failedControlledRequests, controlledResponses: session.controlledResponses })) }, null, 2),
      contentType: 'application/json',
    });
    for (const session of sessions.reverse()) {
      await session.close();
    }
  }
});
