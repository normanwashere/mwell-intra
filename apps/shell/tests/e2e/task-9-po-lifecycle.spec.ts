import { expect, test, type Page } from '@playwright/test';
import { actor, ControlledProcurementRpcFixture, installControlledRpc } from '../helpers/controlled-procurement-rpc';

async function signIn(page: Page, actorKey: 'vendor' | 'unrelatedVendor' | 'procurement') {
  const destination = actorKey === 'procurement' ? '/procurement/purchase-orders/controlled-po-task-9' : '/vendor/purchase-orders';
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
}

test('Task 9 controlled lifecycle covers vendor acknowledgement, procurement delivery, monitoring, and quality recovery', async ({ browser }, testInfo) => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask9PurchaseOrder();

  const vendorContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  await installControlledRpc(vendorContext, fixture, 'vendor');
  const vendor = await vendorContext.newPage();
  await signIn(vendor, 'vendor');
  await expect(vendor.getByRole('main', { name: 'Vendor PO acknowledgements' })).toBeVisible();
  const acknowledge = vendor.getByRole('button', { name: 'Acknowledge revision 2', exact: true });
  await expect(acknowledge).toBeDisabled();
  await vendor.getByLabel('Acknowledgement reference for PO-CONTROLLED-009').fill('ACK-CONTROLLED-009');
  await expect(acknowledge).toBeDisabled();
  await vendor.getByText('Read purchase order', { exact: true }).click();
  await expect(vendor.getByText('Controlled clinical supply', { exact: true })).toBeVisible();
  await expect(vendor.getByText('Expected delivery: 2026-09-01', { exact: true })).toBeVisible();
  await expect(acknowledge).toBeEnabled();
  await acknowledge.click();
  await expect(vendor.getByText('acknowledged', { exact: true })).toBeVisible();
  await expect(vendor.getByText('Revision 3', { exact: true })).toBeVisible();
  const [ackCall] = fixture.callsNamed('acknowledge_purchase_order');
  expect(fixture.callsNamed('acknowledge_purchase_order')).toHaveLength(1);
  expect(ackCall).toMatchObject({ actor: actor('vendor').id, schema: 'procurement', payload: {
    purchase_order_id: 'controlled-po-task-9', expected_revision: 2,
    acknowledgement_reference: 'ACK-CONTROLLED-009', document_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  } });
  await vendor.reload();
  await expect(vendor.getByText('acknowledged', { exact: true })).toBeVisible();
  await expect(vendor.getByRole('button', { name: /^Acknowledge revision/ })).toHaveCount(0);
  await vendor.screenshot({ path: testInfo.outputPath(`task-9-controlled-vendor-ack-${testInfo.project.name}.png`), fullPage: true });
  await vendorContext.close();

  const unrelatedContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  await installControlledRpc(unrelatedContext, fixture, 'unrelatedVendor');
  const unrelatedVendor = await unrelatedContext.newPage();
  await signIn(unrelatedVendor, 'unrelatedVendor');
  await expect(unrelatedVendor.getByText('No issued purchase orders require acknowledgement.')).toBeVisible();
  await unrelatedContext.close();

  const procurementContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  await installControlledRpc(procurementContext, fixture, 'procurement');
  const procurement = await procurementContext.newPage();
  await signIn(procurement, 'procurement');
  await expect(procurement.getByRole('region', { name: 'PO commitment readiness' })).toBeVisible();
  await procurement.getByLabel('Vendor delivery notice reference').fill('DELIVERY-CONTROLLED-009');
  await procurement.getByRole('button', { name: 'Record delivery notice' }).click();
  await expect(procurement.getByText('Delivery notice recorded')).toBeVisible();
  await expect(procurement.getByText('Maintain vendor notice, RMA, credit, and payment hold')).toBeVisible();
  await procurement.screenshot({ path: testInfo.outputPath(`task-9-controlled-quality-recovery-${testInfo.project.name}.png`), fullPage: true });
  await procurementContext.close();
});
