import { expect, test } from '@playwright/test';
import { installWarehouseSession, WAREHOUSE_ROLES } from '../helpers/warehouseFixtures';

test.describe('warehouse W1 memory workflows', () => {
  for (const role of WAREHOUSE_ROLES) {
    test(`${role} reaches an authorized daily-work surface`, async ({ page }) => {
      await installWarehouseSession(page, role);
      await page.goto('/warehouse', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/access denied|no warehouse access/i)).toHaveCount(0);
    });
  }

  test('core platform admin is denied without a warehouse assignment', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('intra.memory-session.v1', JSON.stringify({
        profileId: 'demo-admin',
        roles: { core: ['platform_admin', 'staff'] },
      }));
    });
    await page.goto('/warehouse', { waitUntil: 'networkidle' });
    await expect(page.getByText(/no warehouse access/i)).toBeVisible();
  });

  test('logistics puts away a serialized unit and the result survives reload', async ({ page }) => {
    await installWarehouseSession(page, 'logistics_supervisor');
    await page.goto('/warehouse/storage', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /put away/i }).click();
    const dialog = page.getByRole('dialog', { name: /put away stock/i });
    await dialog.getByLabel('Enter stock code manually').fill('SMART-WATCH-SN0001');
    await dialog.getByRole('button', { name: 'Add stock' }).click();
    await expect(dialog.getByRole('status')).toContainText(/scan accepted/i);
    await dialog.getByLabel('Enter destination bin manually').fill('PASIG-A-01');
    await dialog.getByRole('button', { name: 'Add bin' }).click();
    await dialog.getByRole('button', { name: /confirm putaway/i }).click();
    await expect(page.getByText(/put away into pasig-a-01/i)).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^scan$/i }).click();
    const binDialog = page.getByRole('dialog', { name: /scan a storage area/i });
    await binDialog.getByLabel('Enter barcode manually').fill('PASIG-A-01');
    await binDialog.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('dialog', { name: /bin pasig-a-01/i })).toContainText(/mWellness Smart Watch/i);
  });

  test('return scan rejects an in-stock serial and accepts the issued event unit', async ({ page }) => {
    await installWarehouseSession(page, 'operations');
    await page.goto('/warehouse/returns', { waitUntil: 'networkidle' });
    await page.getByLabel('Related event (optional)').selectOption('evt-vip');
    await page.getByLabel('Product').selectOption('smart-watch');
    await page.getByLabel('Enter barcode manually').fill('SMART-WATCH-SN0001');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(/cannot be returned/i);
    await page.getByLabel('Enter barcode manually').fill('SMART-WATCH-VIP001');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('p[role="status"]')).toContainText(/scan accepted/i);
    await expect(page.getByLabel('Serial number')).toHaveValue('SMART-WATCH-VIP001');
  });

  test('device count records presence and blocks an unexpected serial', async ({ page }) => {
    await installWarehouseSession(page, 'finance');
    await page.goto('/warehouse/cycle-counts', { waitUntil: 'networkidle' });
    await page.getByLabel('Category').selectOption('device');
    await page.getByLabel('Enter barcode manually').fill('UNKNOWN-UNIT');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(/not recognized/i);
    await page.getByLabel('Enter barcode manually').fill('ECG-RING-6-SN0003');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByLabel(/Scanned serials ECG Ring \(Size 6\)/i)).toHaveValue('ECG-RING-6-SN0003');
  });
});
