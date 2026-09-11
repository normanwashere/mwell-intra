import { test, expect } from '@playwright/test';
import { buildSeed, type FulfillmentOrder } from '@intra/data-kit';
import { installWarehouseSession } from '../helpers/warehouseFixtures';

test.skip(({ baseURL }) => !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Local synthetic data only. Not a live transaction certification.');

test('conflict inspection, order context, return reference and alerts preserve the workflow', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const theme = info.project.name === 'desktop-1280' ? 'dark' : 'light';
  await installWarehouseSession(page, 'logistics_supervisor', theme);
  const data = buildSeed();
  const order: FulfillmentOrder = {
    id: 'local-context-order', source: 'department_request', externalReference: 'REQ-MKT-2026-0011', requestingDepartment: 'Marketing',
    status: 'completed', deliveryMethod: 'internal_handover', createdBy: 'local-requester', createdAt: '2026-09-09T01:00:00Z', updatedAt: '2026-09-11T02:00:00Z',
    lines: [{ productId: 'smart-watch', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: ['MW-WATCH-0011'], pickBinId: 'bin-pasig-a1' }],
    packaging: [], shipmentEvents: [], orderNotes: 'For the client welcome kit. Collect from the warehouse desk.',
    pickedAt: '2026-09-10T02:00:00Z', packedAt: '2026-09-10T03:00:00Z', releasedAt: '2026-09-11T01:00:00Z',
    acknowledgedAt: '2026-09-11T02:00:00Z', handoverRecipientName: 'Sample Marketing Recipient', handoverReference: 'HANDOVER-0011',
  };
  data.fulfillmentOrders = [order, ...(['received', 'picking', 'packing', 'ready', 'released'] as const).map((status, index) => ({
    ...order, id: `queue-fixture-${status}`, externalReference: `SAMPLE-QUEUE-${index + 1}`, status,
    pickedAt: undefined, packedAt: undefined, releasedAt: undefined, acknowledgedAt: undefined,
    handoverRecipientName: undefined, handoverReference: undefined,
  }))];
  data.departmentStockRequests = [{ id: 'request-context', fulfillmentOrderId: order.id, requestingDepartment: 'Marketing', requestedBy: 'local-requester', requestedByName: 'Sample Requester',
    requestedAt: '2026-09-08T01:00:00Z', requiredDate: '2026-09-12', purpose: 'Client welcome kit', costCenter: 'MKT-CLIENT-2026', expenseTreatment: 'expense', status: 'approved', lines: order.lines }];
  data.customerReturnCases = [{ id: 'RETURN-0011', sourceOrderId: order.id, productId: 'smart-watch', serialNumber: 'MW-WATCH-0011', defectDescription: 'Screen does not turn on after charging.',
    requestingDepartment: 'customer_service', status: 'decision_required', resolution: 'pending', createdBy: 'local-cs', createdAt: '2026-09-11T03:00:00Z' }];
  await page.addInitScript(seed => {
    localStorage.setItem('mwell-intra-warehouse:data:v2', JSON.stringify(seed));
    const request = indexedDB.open('mwell-intra-warehouse', 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('outbox')) request.result.createObjectStore('outbox', { keyPath: 'id' }); };
    request.onsuccess = () => {
      const tx = request.result.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put({ id: 'LOCAL-CONFLICT-11', method: 'relocate', status: 'conflict', createdAt: '2026-09-11T03:00:00Z',
        error: 'Insufficient stock', input: { actor: 'logistics@mwell.demo', idempotencyKey: 'local-context', productId: 'smart-watch', fromBinId: 'bin-pasig-a1', toBinId: 'bin-pasig-b1', quantity: 2, serialNumbers: ['MW-WATCH-0011'], secret: 'MUST-NOT-RENDER' } });
      tx.oncomplete = () => request.result.close();
    };
  }, data);
  const capture = async (name: string) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    await expect.poll(() => page.locator('[role="dialog"]').evaluateAll(elements => elements.every(element => {
      const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1;
    }))).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
  };
  await page.goto('/warehouse/fulfillment?tab=orders');
  const counters = page.getByRole('group', { name: 'Order counters' });
  await expect(counters).toBeVisible({ timeout: 60000 });
  const counterBoxes = await counters.getByRole('button').evaluateAll(elements => elements.map(element => ({ top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height })));
  expect(counterBoxes).toHaveLength(6);
  if ((page.viewportSize()?.width ?? 0) >= 1024) expect(new Set(counterBoxes.map(box => Math.round(box.top))).size).toBe(1);
  expect(counterBoxes.every(box => box.height >= 44)).toBe(true);
  for (const [label, status] of [['Waiting allocation', 'received'], ['Picking', 'pick_queue'], ['Packing', 'packing'], ['Ready for release', 'ready'], ['Released follow-up', 'released']] as const) {
    const counter = counters.getByRole('button', { name: new RegExp(label) });
    await expect(counter).toContainText('1');
    await counter.click();
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue(status);
    await expect(page.getByRole('button', { name: 'View order details' })).toHaveCount(1);
  }
  await counters.getByRole('button', { name: /Active work/ }).click();
  await capture('orders-counters');
  const conflict = page.getByRole('button', { name: /1 conflict.*View details/ });
  await conflict.click();
  let dialog = page.getByRole('dialog', { name: 'Sync conflicts' });
  await expect(dialog).toContainText('Move stock between bins');
  await expect(dialog).toContainText('Why it needs attention');
  await expect(dialog).not.toContainText('MUST-NOT-RENDER');
  await capture('conflict-details');
  await page.keyboard.press('Escape');
  await expect(conflict).toBeFocused();
  await expect(conflict).toContainText('1 conflict');
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByLabel('Search orders', { exact: true }).fill(order.externalReference);
  await page.getByRole('button', { name: 'View order details' }).click();
  dialog = page.getByRole('dialog', { name: `Order details / ${order.externalReference}` });
  await expect(dialog).toContainText('Sample Requester');
  await expect(dialog).toContainText('MKT-CLIENT-2026');
  await expect(dialog).toContainText('Not applicable to internal requests');
  await expect(dialog.getByRole('heading', { name: 'Shipment timeline' })).toHaveCount(0);
  await capture('order-details');
  await dialog.getByText('Picked serials (1)', { exact: true }).click();
  await expect(dialog.getByText('MW-WATCH-0011', { exact: true })).toBeVisible();
  await dialog.getByRole('region', { name: 'Order activity' }).scrollIntoViewIfNeeded();
  await capture('order-activity');
  await page.keyboard.press('Escape');
  await page.goto('/warehouse/fulfillment?tab=returns');
  await expect(page.getByRole('list', { name: 'Customer return cases' })).toContainText('REQ-MKT-2026-0011');
  await page.getByRole('button', { name: 'Record resolution' }).click();
  dialog = page.getByRole('dialog', { name: 'Resolve return case' });
  await expect(dialog.getByRole('region', { name: 'Return case context' })).toContainText('REQ-MKT-2026-0011');
  await expect(dialog.getByRole('button', { name: 'Save resolution' })).toBeDisabled();
  await capture('return-context');
  await dialog.getByLabel('Resolution', { exact: true }).selectOption('vendor_return');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Customer return cases' })).toContainText('Pending');
  await page.getByRole('button', { name: /Module alerts/ }).click();
  dialog = page.getByRole('dialog', { name: 'Notifications' });
  await expect(dialog).toBeVisible();
  await capture('warehouse-alerts');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
