import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { actor, ControlledProcurementRpcFixture, installControlledRpc } from '../helpers/controlled-procurement-rpc';

async function signIn(page: Page, actorKey: 'vendor' | 'procurement') {
  await page.goto(`/login?redirect=${encodeURIComponent('/procurement/purchase-orders/controlled-po-task-9')}`);
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
  await expect(vendor.getByRole('region', { name: 'PO commitment readiness' })).toBeVisible();
  await vendor.getByLabel('Vendor acknowledgement reference').fill('ACK-CONTROLLED-009');
  await vendor.getByRole('button', { name: 'Record vendor acknowledgement' }).click();
  await expect(vendor.getByText('Vendor acknowledgement recorded')).toBeVisible();
  await vendor.screenshot({ path: resolve(evidenceDir, `task-9-vendor-ack-${testInfo.project.name}.png`), fullPage: true });
  await vendorContext.close();

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
