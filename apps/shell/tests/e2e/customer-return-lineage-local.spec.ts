import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { buildSeed } from '@intra/data-kit';
import { installWarehouseSession } from '../helpers/warehouseFixtures';

test.skip(({ baseURL }) => !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local memory regression only.');

const reference = 'RETURN-ORIGINAL-59853da8-c33e-4d6b-891e-customer-shipment';
const caseId = '59853da8-c33e-4d6b-891e-7150f5e5a099';
const physicalId = 'local-physical-return';

async function install(page: Page) {
  await installWarehouseSession(page, 'warehouse_operator');
  const data = buildSeed();
  data.fulfillmentOrders = [{ id: 'original', externalReference: reference, source: 'ecommerce', status: 'released',
    lines: [{ productId: 'shirt-l', quantity: 2, pickedQuantity: 2, pickedSerialNumbers: [] }],
    packaging: [], shipmentEvents: [], deliveryMethod: 'shipment', createdBy: 'warehouse@mwell.demo',
    createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z' }];
  data.customerReturnCases = Array.from({ length: 9 }, (_, index) => ({
    id: index === 8 ? caseId : `other-case-${index}`, sourceOrderId: 'original', productId: 'shirt-l',
    defectDescription: `Reported damage ${index}`, requestingDepartment: 'customer_service',
    status: 'submitted' as const, resolution: 'pending' as const, createdBy: 'warehouse@mwell.demo', createdAt: '2026-09-13T00:00:00Z',
  }));
  data.customerReturnCases.push({ ...data.customerReturnCases[0]!, id: 'unlinked-case', sourceOrderId: undefined });
  data.returns = [{ id: physicalId, source: 'customer', sourceOrderId: 'original', returnCaseId: caseId,
    actor: 'warehouse@mwell.demo', createdAt: '2026-09-13T00:00:00Z', lines: [{ productId: 'shirt-l', quantity: 1, reason: 'defective', disposition: 'quarantine' }] }];
  await page.addInitScript(seed => {
    if (!localStorage.getItem('return-lineage-installed')) {
      localStorage.setItem('mwell-intra-warehouse:data:v2', JSON.stringify(seed));
      localStorage.setItem('return-lineage-installed', '1');
    }
  }, data);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
}

test('case link opens unsent intake, Back retains context, and a different draft is protected', async ({ page }, info) => {
  test.setTimeout(120_000); await install(page);
  await page.goto(`/warehouse/fulfillment?tab=returns#return-case-${caseId}`);
  const record = page.locator(`[id="return-case-${caseId}"]`);
  await expect(record).toBeFocused({ timeout: 60_000 });
  await expect(record).toBeInViewport();
  await capture(page, info, 'case-focused');
  const before = await page.evaluate(() => localStorage.getItem('mwell-intra-warehouse:data:v2'));
  await record.getByRole('link', { name: 'Receive physical return' }).click();
  await expect(page.getByLabel('Customer return case', { exact: true })).toHaveValue(caseId);
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('shirt-l');
  await page.getByLabel('Original order', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'linked-intake-unsent');
  expect(await page.getByLabel('Customer return case', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value))).not.toContain('unlinked-case');
  await page.goBack();
  await expect(record).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('mwell-intra-warehouse:data:v2'))).toBe(before);
  await record.getByRole('link', { name: 'Receive physical return' }).click();
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await page.getByRole('button', { name: 'Increase', exact: true }).click();
  await page.goBack();
  await page.locator('[id="return-case-other-case-0"]').getByRole('link', { name: 'Receive physical return' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'saved return draft has different context' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep saved draft' }).click();
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Customer return case', { exact: true })).toHaveValue(caseId);
  await page.getByLabel('Original order', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, info, 'existing-draft-retained');
  expect(await page.evaluate(() => localStorage.getItem('mwell-intra-warehouse:data:v2'))).toBe(before);
});

test('physical history and customer case links focus rendered rows after full reload and navigation', async ({ page }, info) => {
  test.setTimeout(120_000); await install(page);
  await page.goto(`/warehouse/returns#return-${physicalId}`);
  const physical = page.locator(`[id="return-${physicalId}"]`);
  await expect(physical).toBeFocused({ timeout: 60_000 });
  await expect(physical).toBeInViewport();
  await capture(page, info, 'physical-history-focused');
  await physical.getByRole('link', { name: caseId, exact: true }).click();
  const record = page.locator(`[id="return-case-${caseId}"]`);
  await expect(record).toBeFocused(); await expect(record).toBeInViewport();
  await capture(page, info, 'linked-case-focused');
  await record.getByRole('link', { name: physicalId, exact: true }).click();
  await expect(physical).toBeFocused(); await expect(physical).toBeInViewport();
  await page.reload(); await expect(physical).toBeFocused();
  await physical.getByRole('link', { name: reference, exact: true }).click();
  const order = page.getByRole('dialog');
  await expect(order).toBeVisible();
  await order.getByRole('link', { name: 'Receive physical return' }).click();
  await expect(page.getByLabel('Original order', { exact: true })).toHaveValue('original');
  await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
  await page.goBack(); await expect(order).toBeVisible();
  await page.keyboard.press('Escape'); await expect(order).not.toBeVisible();
  await capture(page, info, 'order-back-cancel');
});

test('manual case selection fills only a blank line and preserves changed product data', async ({ page }, info) => {
  test.setTimeout(120_000); await install(page); await page.goto('/warehouse/returns');
  const cases = page.getByLabel('Customer return case', { exact: true });
  await expect(cases).toBeVisible({ timeout: 60_000 });
  await cases.selectOption(caseId);
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('shirt-l');
  await cases.selectOption('');
  await page.getByLabel('Product', { exact: true }).selectOption('smart-watch');
  await cases.selectOption(caseId);
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('smart-watch');
  await expect(page.getByRole('button', { name: 'Record return', exact: true })).toBeDisabled();
  await page.getByRole('alert').filter({ hasText: 'does not match' }).scrollIntoViewIfNeeded();
  await capture(page, info, 'mismatch-preserves-input');
});

test('physical intake and case decision actions retain at least 12px separation', async ({ page }, info) => {
  test.setTimeout(120_000); await install(page);
  await page.goto('/warehouse/fulfillment?tab=returns#return-case-other-case-6');
  const record = page.locator('[id="return-case-other-case-6"]');
  await expect(record).toBeFocused({ timeout: 60_000 });
  const intake = await record.getByRole('link', { name: 'Receive physical return' }).boundingBox();
  const decision = await record.getByRole('button', { name: 'Record resolution' }).boundingBox();
  expect(intake).not.toBeNull(); expect(decision).not.toBeNull();
  const gap = Math.max(decision!.x - intake!.x - intake!.width, decision!.y - intake!.y - intake!.height);
  await capture(page, info, 'case-action-spacing');
  expect(gap).toBeGreaterThanOrEqual(11.5);
});
