import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { installWarehouseSession } from '../helpers/warehouseFixtures';

test.skip(({ baseURL }) => !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Memory-only layout regression, not live certification.');

const reference = 'WMS-ECOM-acd6711b-6480-4bf9-83f0-896c5174974f-mobile390';

async function installData(page: Page, data: ReturnType<typeof buildSeed>) {
  await page.addInitScript(seed => {
    if (!localStorage.getItem('wms-layout-installed')) {
      localStorage.setItem('mwell-intra-warehouse:data:v2', JSON.stringify(seed));
      localStorage.setItem('wms-layout-installed', '1');
    }
  }, data);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
}

test('receipt capture has one visible work surface and returns to its request', async ({ page }, info) => {
  test.setTimeout(120_000);
  await installWarehouseSession(page, 'marketing', info.project.name === 'desktop-1280' ? 'dark' : 'light');
  const data = buildSeed();
  const order: FulfillmentOrder = {
    id: 'local-layout-ack', source: 'department_request', externalReference: reference,
    status: 'released', deliveryMethod: 'internal_handover', createdBy: 'marketing@mwell.demo',
    createdAt: '2026-09-13T01:00:00Z', updatedAt: '2026-09-13T01:00:00Z',
    releasedAt: '2026-09-13T01:00:00Z', releasedBy: 'logistics@mwell.demo',
    handoverRecipientName: 'Kai Mendoza', handoverRecipientDepartment: 'Marketing',
    lines: [{ productId: 'smart-watch', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: ['LAYOUT-WATCH-1'] }],
    packaging: [], shipmentEvents: [],
  };
  data.fulfillmentOrders = [order];
  data.departmentStockRequests = [{
    id: 'local-layout-request', fulfillmentOrderId: order.id, requestingDepartment: 'Marketing',
    requestedBy: 'marketing@mwell.demo', requestedByName: 'Kai Mendoza', requestedAt: '2026-09-13T00:00:00Z',
    requiredDate: '2026-09-13', purpose: 'Marketing giveaway handover', costCenter: 'CC-4100',
    expenseTreatment: 'expense', status: 'issued', lines: [{ productId: 'smart-watch', quantity: 1 }],
  }];
  await installData(page, data);
  await page.goto('/warehouse/fulfillment?tab=requests&request=local-layout-request');
  const review = page.getByRole('dialog', { name: 'Review request', exact: true });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: /^Acknowledge receipt/ });
  await expect(receipt).toBeVisible();
  await capture(page, info, 'receipt-open');
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
  const heading = receipt.getByRole('heading', { level: 2 });
  const headingBox = await heading.boundingBox();
  expect(headingBox?.height).toBeLessThanOrEqual(72);
  await expect(receipt).toContainText(reference);
  await receipt.getByLabel('Acknowledgment reference', { exact: true }).fill('DISCARD-ME');
  await page.keyboard.press('Escape');
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Acknowledge receipt', exact: true })).toBeFocused();
  await review.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await expect(receipt.getByLabel('Acknowledgment reference', { exact: true })).toHaveValue('');
  await receipt.getByLabel('Acknowledgment reference', { exact: true }).fill('LAYOUT-ACK-1');
  await expect(receipt.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
  await receipt.locator('input[type="file"]').setInputFiles({ name: 'synthetic-layout.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64') });
  await expect(receipt.getByRole('button', { name: 'Confirm receipt' })).toBeEnabled();
  await capture(page, info, 'receipt-ready');
  await receipt.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(receipt).not.toBeVisible();
  await expect(review).toContainText('Receipt acknowledged');
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
  await capture(page, info, 'request-completed');
});

test('filtered transitions retain one readable confirmation after the order leaves the queue', async ({ page }, info) => {
  test.setTimeout(120_000);
  await installWarehouseSession(page, 'warehouse_operator', info.project.name === 'desktop-1280' ? 'dark' : 'light');
  const data = buildSeed();
  data.storageAreas = [{ id: 'layout-bin', locationId: 'loc-wh', code: 'LAYOUT-01', active: true }];
  data.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', binId: 'layout-bin', quantity: 10 }];
  data.fulfillmentOrders = [{
    id: 'local-layout-filter', source: 'ecommerce', externalReference: reference,
    status: 'received', deliveryMethod: 'shipment', sourceLocationId: 'loc-wh', sourceBinId: 'layout-bin',
    createdBy: 'marketing@mwell.demo', createdAt: '2026-09-13T01:00:00Z', updatedAt: '2026-09-13T01:00:00Z',
    lines: [{ productId: 'shirt-l', quantity: 2 }], packaging: [], shipmentEvents: [],
  }];
  await installData(page, data);
  await page.goto('/warehouse/fulfillment?tab=orders&status=received');
  const row = page.getByRole('listitem', { name: `Order ${reference}`, exact: true });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Allocate stock', exact: true }).click();
  await expect(row).toHaveCount(0);
  const allocation = page.getByRole('status').filter({ hasText: 'Allocation recorded.' });
  await expect(allocation).toHaveCount(1);
  await expect(allocation).toContainText(reference);
  await allocation.scrollIntoViewIfNeeded();
  await capture(page, info, 'filtered-allocation-confirmation');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('allocated');
  await expect(row).toBeVisible();
  await expect(allocation).toHaveCount(1);
  await row.getByRole('button', { name: 'Start picking', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(allocation).toHaveCount(0);
  const picking = page.getByRole('status').filter({ hasText: 'Picking started.' });
  await expect(picking).toHaveCount(1);
  await expect(picking).toContainText(reference);
  await picking.scrollIntoViewIfNeeded();
  await capture(page, info, 'filtered-picking-confirmation');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('picking');
  await row.getByRole('button', { name: 'Confirm scanned pick', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Confirm pick/ })).toBeVisible();
  await expect(picking).toHaveCount(0);
});

test('rapid allocation and picking do not cover the scan form with success notices', async ({ page }, info) => {
  test.setTimeout(120_000);
  await installWarehouseSession(page, 'warehouse_operator', info.project.name === 'desktop-1280' ? 'dark' : 'light');
  const data = buildSeed();
  data.storageAreas = [{ id: 'layout-bin', locationId: 'loc-wh', code: 'LAYOUT-01', active: true }];
  data.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', binId: 'layout-bin', quantity: 10 }];
  data.fulfillmentOrders = [{
    id: 'local-layout-pick', source: 'ecommerce', externalReference: reference,
    status: 'received', deliveryMethod: 'shipment', sourceLocationId: 'loc-wh', sourceBinId: 'layout-bin',
    createdBy: 'marketing@mwell.demo', createdAt: '2026-09-13T01:00:00Z', updatedAt: '2026-09-13T01:00:00Z',
    lines: [{ productId: 'shirt-l', quantity: 2 }], packaging: [], shipmentEvents: [],
  }];
  await installData(page, data);
  await page.goto('/warehouse/fulfillment?tab=orders&status=all');
  const row = page.getByRole('listitem', { name: `Order ${reference}`, exact: true });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Allocate stock', exact: true }).click();
  await row.getByRole('button', { name: 'Start picking', exact: true }).click();
  await row.getByRole('button', { name: 'Confirm scanned pick', exact: true }).click();
  const pick = page.getByRole('dialog', { name: /^Confirm pick/ });
  const bin = pick.getByLabel(/Scanned bin code for/);
  await expect(bin).toBeVisible();
  await capture(page, info, 'rapid-pick-open');
  expect((await pick.getByRole('heading', { level: 2 }).boundingBox())?.height).toBeLessThanOrEqual(32);
  await expect(pick).toHaveAccessibleName(`Confirm pick / ${reference}`);
  await expect(pick.getByRole('button', { name: 'Scan rack or bin', exact: true })).toBeInViewport();
  await pick.locator('summary').filter({ hasText: 'Order reference' }).click();
  await expect(pick.getByText(reference, { exact: true })).toBeVisible();
  await expect(pick.getByRole('button', { name: 'Copy reference', exact: true })).toBeVisible();
  await pick.locator('summary').filter({ hasText: 'Order reference' }).click();
  const notices = page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('status');
  const count = await notices.count();
  expect(count).toBeLessThanOrEqual(1);
  const bounds = await pick.boundingBox();
  expect(bounds).not.toBeNull();
  for (const notice of await notices.all()) {
    expect((await notice.textContent())?.length ?? 0).toBeLessThanOrEqual(100);
    const box = await notice.boundingBox();
    if (box && bounds) expect(box.y + box.height <= bounds.y || box.y >= bounds.y + bounds.height || box.x >= bounds.x + bounds.width || box.x + box.width <= bounds.x).toBe(true);
  }
  await bin.fill('WRONG-BIN');
  await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
  await expect(pick.getByRole('alert')).toContainText(/wrong source bin/i);
  await expect.poll(async () => {
    const alert = await pick.getByRole('alert').boundingBox();
    const header = await pick.locator('.intra-sheet-header').boundingBox();
    const footer = await pick.locator('.intra-sheet-footer').boundingBox();
    return !!alert && !!header && !!footer && alert.y >= header.y + header.height && alert.y + alert.height <= footer.y;
  }).toBe(true);
  await capture(page, info, 'wrong-bin-visible-error');
  const before = await page.evaluate(() => localStorage.getItem('mwell-intra-warehouse:data:v2'));
  await pick.getByRole('button', { name: 'Confirm pick', exact: true }).click();
  await expect(pick.getByRole('alert')).toContainText(/scan the source rack or bin/i);
  await expect(pick).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mwell-intra-warehouse:data:v2'))).toBe(before);
  await capture(page, info, 'wrong-bin-feedback');
});

test('packing success remains inline with independent release responsibility', async ({ page }, info) => {
  test.setTimeout(120_000);
  await installWarehouseSession(page, 'warehouse_operator', info.project.name === 'desktop-1280' ? 'dark' : 'light');
  const data = buildSeed();
  data.fulfillmentOrders = [{
    id: 'local-layout-pack', source: 'ecommerce', externalReference: reference,
    status: 'packing', deliveryMethod: 'shipment', sourceLocationId: 'loc-wh',
    createdBy: 'marketing@mwell.demo', createdAt: '2026-09-13T01:00:00Z', updatedAt: '2026-09-13T01:00:00Z',
    lines: [{ productId: 'shirt-l', quantity: 2, pickedQuantity: 2 }], packaging: [], shipmentEvents: [],
  }];
  await installData(page, data);
  await page.goto('/warehouse/fulfillment?tab=orders&status=packing');
  const row = page.getByRole('listitem', { name: `Order ${reference}`, exact: true });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: 'Pack and add waybill', exact: true }).click();
  const pack = page.getByRole('dialog', { name: `Pack order / ${reference}`, exact: true });
  await pack.getByLabel('Courier', { exact: true }).fill('Synthetic courier');
  await pack.getByLabel('Waybill number', { exact: true }).fill('SYNTHETIC-WAYBILL');
  await pack.getByLabel('Delivery tracking link', { exact: true }).fill('https://example.invalid/tracking');
  await pack.getByRole('button', { name: 'Confirm packing', exact: true }).click();
  await expect(pack).not.toBeVisible();
  await expect(row).toHaveCount(0);
  const notice = page.getByRole('status').filter({ hasText: 'Packing confirmed.' });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(reference);
  await expect(page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('status')).toHaveCount(0);
  await notice.scrollIntoViewIfNeeded();
  await capture(page, info, 'packing-filtered-confirmation');
  await page.getByLabel('Status', { exact: true }).selectOption('ready');
  await expect(row.getByRole('status')).toContainText('Packing confirmed.');
  const responsibility = row.getByText('Awaiting release by a second warehouse operator.', { exact: true });
  await expect(responsibility).toBeVisible();
  await expect(row.getByRole('button', { name: 'Release shipment', exact: true })).toHaveCount(0);
  await responsibility.scrollIntoViewIfNeeded();
  await capture(page, info, 'packing-independent-release');
});
