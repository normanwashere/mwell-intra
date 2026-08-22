import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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
  const evidenceDir = resolve(process.cwd(), '../../docs/qa/evidence');
  mkdirSync(evidenceDir, { recursive: true });

  const vendorContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  await installControlledRpc(vendorContext, fixture, 'vendor');
  const vendor = await vendorContext.newPage();
  await signIn(vendor, 'vendor');
  await expect(vendor.getByRole('main', { name: 'Vendor PO acknowledgements' })).toBeVisible();
  await vendor.getByLabel('Acknowledgement reference for PO-CONTROLLED-009').fill('ACK-CONTROLLED-009');
  await vendor.getByRole('button', { name: 'Acknowledge purchase order' }).click();
  await expect(vendor.getByText('acknowledged', { exact: true })).toBeVisible();
  await vendor.screenshot({ path: resolve(evidenceDir, `task-9-vendor-ack-${testInfo.project.name}.png`), fullPage: true });
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
  await procurement.screenshot({ path: resolve(evidenceDir, `task-9-quality-recovery-${testInfo.project.name}.png`), fullPage: true });
  await procurementContext.close();
});
