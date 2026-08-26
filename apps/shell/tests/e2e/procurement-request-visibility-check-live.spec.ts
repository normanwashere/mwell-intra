import { expect, test } from '@playwright/test';

const password = process.env.AUDIT_PASSWORD;
const records = [
  ['HANDBOOK-T7-R1-REQUEST', 'HANDBOOK T7 R1 assigned approval'],
  ['UAT-AUG24-REQ-0001', 'August 24 WMS goods request for PO 0001'],
  ['UAT-AUG24-REQ-0002', 'August 24 WMS goods request for PO 0002'],
  ['UAT-AUG24-REQ-0003', 'August 24 WMS goods request for PO 0003'],
] as const;

for (const [label, email] of [
  ['Procurement Lead', 'intra.test.procurement.lead@mwell.com.ph'],
  ['Finance Controller', 'intra.test.finance@mwell.com.ph'],
] as const) {
  test(`${label} can list and deep-link all seeded request evidence`, async ({ page }) => {
    expect(password, 'AUDIT_PASSWORD is required for live verification').toBeTruthy();
    const firstPath = `/procurement/requests/${records[0][0]}`;
    await page.goto(`/login?redirect=${encodeURIComponent(firstPath)}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(new RegExp(`${firstPath}$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: records[0][1] })).toBeVisible();

    for (const [id, title] of records) {
      await page.goto(`/procurement/requests/${id}`);
      await expect(page).toHaveURL(new RegExp(`/procurement/requests/${id}$`));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByText('Request not available')).toHaveCount(0);
    }

    await page.goto('/procurement');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase requests' })).toBeVisible();
    for (const [, title] of records) {
      await expect(page.getByText(title, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
  });
}
