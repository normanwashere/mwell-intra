import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { actor, ControlledProcurementRpcFixture, installControlledRpc } from '../helpers/controlled-procurement-rpc';

async function rpc(page: Page, actorKey: Parameters<typeof actor>[0], schema: string, name: string, payload: Record<string, unknown>) {
  const result = await page.evaluate(async ({ url, token, schema, name, payload }) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Profile': schema },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }, { url: await page.evaluate(() => window.location.origin), token: `controlled-${actor(actorKey).id}`, schema, name, payload });
  expect(result.status, `${schema}.${name}`).toBe(200);
  return result.body as Record<string, unknown>;
}

async function actorPage(browserContext: BrowserContext, fixture: ControlledProcurementRpcFixture, actorKey: Parameters<typeof actor>[0]) {
  await installControlledRpc(browserContext, fixture, actorKey);
  const page = await browserContext.newPage();
  await page.goto('/');
  return page;
}

test('Task 10 controlled RPC authority journey certifies Legal recovery, Finance payment, and independent closure', async ({ browser }, testInfo) => {
  test.skip(!['desktop-1440', 'mobile-390'].includes(testInfo.project.name), 'Task 10 evidence is retained at one controlled desktop and mobile viewport.');
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  const contexts: BrowserContext[] = [];
  const pageFor = async (actorKey: Parameters<typeof actor>[0]) => {
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    contexts.push(context);
    return actorPage(context, fixture, actorKey);
  };
  {
    const legalMaker = await pageFor('legalMaker');
    await rpc(legalMaker, 'legalMaker', 'legal', 'record_vendor_probation_review', { probation_review_id: 'controlled-review-10', expected_revision: 0, po_win_rate: 0.2, delivery_commitment_rate: 1, return_or_rejection_count: 0, document_timeliness_rate: 1, evidence_reference: 'private/review-10.pdf', notice_reference: 'private/review-10-notice.pdf' });
    const legalDecider = await pageFor('legalDecider');
    await rpc(legalDecider, 'legalDecider', 'legal', 'record_vendor_eligibility_decision', { probation_review_id: 'controlled-review-10', expected_revision: 0, decision: 'pass', evidence_reference: 'private/decision-10.pdf', notice_reference: 'private/decision-10-notice.pdf' });

    const procurement = await pageFor('procurement');
    await rpc(procurement, 'procurement', 'procurement', 'invite_sourcing_vendors', { sourcing_event_id: 'controlled-sourcing-10', vendor_ids: ['vendor-1'] });
    await rpc(procurement, 'procurement', 'procurement', 'issue_purchase_order', { id: 'controlled-po-task-10' });

    const requester = await pageFor('operations');
    await rpc(requester, 'operations', 'procurement', 'record_acceptance_pack', { purchase_order_id: 'controlled-po-task-10', acceptance_type: 'goods', accepted_scope: { lines: [{ po_line_id: 'line-1', quantity: 1 }] }, accepted_amount: 1000, exceptions: [] });
    await rpc(procurement, 'procurement', 'procurement', 'prepare_invoice_payment_readiness', { purchase_order_id: 'controlled-po-task-10', invoice_number: 'SI-CONTROLLED-010', invoice_date: '2026-08-23', invoice_amount: 1000, tax_amount: 100, withholding_amount: 20, invoice_or_si_storage_path: 'private/invoice-10.pdf', milestone_support_storage_path: 'private/acceptance-10.pdf', tax_withholding_support_storage_path: 'private/tax-10.pdf' });
    const finance = await pageFor('finance');
    await rpc(finance, 'finance', 'procurement', 'review_payment_readiness', { id: 'controlled-payment-10', status: 'accepted', note: 'Controlled three-way match accepted.' });
    await rpc(finance, 'finance', 'procurement', 'release_payment', { payment_readiness_pack_id: 'controlled-payment-10', amount: 1000, payment_reference: 'CONTROLLED-RELEASE-10', payment_method: 'bank_transfer', paid_at: '2026-08-23' });
    await rpc(procurement, 'procurement', 'procurement', 'request_purchase_order_closure', { purchase_order_id: 'controlled-po-task-10', expected_revision: 4, closure_reason: 'Controlled obligations complete.' });
    const approver = await pageFor('deptHead');
    await rpc(approver, 'deptHead', 'procurement', 'approve_purchase_order_closure', { closure_request_id: 'controlled-closure-10' });

    await procurement.goto('/procurement/purchase-orders/controlled-po-task-10');
    await expect.poll(() => fixture.task10?.closed).toBe(true);
    const evidenceDir = resolve(process.cwd(), '../../docs/qa/evidence');
    mkdirSync(evidenceDir, { recursive: true });
    await procurement.screenshot({ path: resolve(evidenceDir, `task-10-controlled-authority-${testInfo.project.name}.png`), fullPage: true });
    writeFileSync(resolve(evidenceDir, `task-10-controlled-authority-${testInfo.project.name}.trace.json`), JSON.stringify({ final: fixture.task10, calls: fixture.calls }, null, 2));
    expect(fixture.task10).toMatchObject({ vendorCurrent: true, acceptance: true, prepared: true, accepted: true, released: true, closureRequested: true, closed: true });
  }
});
