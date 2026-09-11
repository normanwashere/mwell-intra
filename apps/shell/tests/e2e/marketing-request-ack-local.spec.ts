import { test, expect } from '@playwright/test';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { installWarehouseSession } from '../helpers/warehouseFixtures';

test.skip(({ baseURL }) => !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Synthetic local data only; not live certification.');

test('Marketing acknowledges an issued request without switching workspaces', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installWarehouseSession(page, 'marketing', info.project.name === 'desktop-1280' ? 'dark' : 'light');
  const data = buildSeed();
  const order: FulfillmentOrder = {
    id: 'local-marketing-ack', source: 'department_request', externalReference: 'REQ-MKT-0011',
    status: 'released', deliveryMethod: 'internal_handover', createdBy: 'marketing@mwell.demo',
    createdAt: '2026-09-10T01:00:00Z', updatedAt: '2026-09-11T01:00:00Z',
    releasedAt: '2026-09-11T01:00:00Z', releasedBy: 'logistics@mwell.demo',
    handoverRecipientName: 'Kai Mendoza', handoverRecipientDepartment: 'Marketing',
    lines: [{ productId: 'smart-watch', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: ['SAMPLE-WATCH-11'] }],
    packaging: [], shipmentEvents: [],
  };
  data.fulfillmentOrders = [order];
  data.departmentStockRequests = [{
    id: 'local-marketing-request', fulfillmentOrderId: order.id, requestingDepartment: 'Marketing',
    requestedBy: 'marketing@mwell.demo', requestedByName: 'Kai Mendoza', requestedAt: '2026-09-10T01:00:00Z',
    requiredDate: '2026-09-11', purpose: 'Giveaway for Ms A.', costCenter: 'CC-4100',
    expenseTreatment: 'expense', status: 'issued', lines: [{ productId: 'smart-watch', quantity: 1 }],
  }];
  await page.addInitScript(seed => {
    if (!localStorage.getItem('marketing-ack-fixture-installed')) {
      localStorage.setItem('mwell-intra-warehouse:data:v2', JSON.stringify(seed));
      localStorage.setItem('marketing-ack-fixture-installed', '1');
    }
  }, data);
  const capture = async (name: string) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    await expect.poll(() => page.locator('[role="dialog"]').evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    }))).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
  };
  await page.goto('/warehouse/fulfillment?tab=requests');
  const requests = page.getByRole('list', { name: 'Department stock requests' });
  const acknowledge = requests.getByRole('button', { name: 'Acknowledge receipt', exact: true });
  await expect(acknowledge).toBeVisible({ timeout: 60000 });
  await acknowledge.scrollIntoViewIfNeeded();
  await capture('request-action');
  await acknowledge.click();
  const dialog = page.getByRole('dialog', { name: 'Acknowledge receipt / REQ-MKT-0011' });
  await expect(dialog.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
  await dialog.getByLabel('Acknowledgment reference', { exact: true }).fill('UNSAVED');
  await page.keyboard.press('Escape');
  await expect(acknowledge).toBeFocused();
  await requests.getByRole('button', { name: 'View request' }).click();
  const review = page.getByRole('dialog', { name: 'Review request' });
  await review.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await expect(dialog.getByLabel('Acknowledgment reference', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: 'Acknowledge receipt', exact: true })).toBeFocused();
  await review.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
  await dialog.getByLabel('Acknowledgment reference', { exact: true }).fill('MKT-ACK-0011');
  await expect(dialog.getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'synthetic-acceptance.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64') });
  await expect(dialog.getByRole('button', { name: 'Confirm receipt' })).toBeEnabled();
  await capture('receipt-form');
  await dialog.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(review).toContainText('Receipt acknowledged');
  await page.keyboard.press('Escape');
  await expect(requests).toContainText('MKT-ACK-0011');
  await expect(acknowledge).toHaveCount(0);
  await capture('receipt-confirmed');
  await page.reload();
  await expect(requests).toContainText('MKT-ACK-0011', { timeout: 30000 });
  await expect(acknowledge).toHaveCount(0);
  expect(errors).toEqual([]);
});
