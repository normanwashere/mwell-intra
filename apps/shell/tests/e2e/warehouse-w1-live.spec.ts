import { expect, test } from '@playwright/test';

const required = [
  'PLAYWRIGHT_BASE_URL',
  'W1_LOGISTICS_EMAIL',
  'W1_LOGISTICS_PASSWORD',
  'W1_FINANCE_EMAIL',
  'W1_FINANCE_PASSWORD',
] as const;

test('live Warehouse boundary is configured for mutation verification', async ({ page }) => {
  const missing = required.filter((name) => !process.env[name]);
  expect(missing, `Missing live W1 environment variables: ${missing.join(', ')}`).toEqual([]);
  expect(process.env.AUDIT_MUTATIONS, 'Set AUDIT_MUTATIONS=true only for the designated test project.').toBe('true');
  await page.goto('/login?redirect=%2Fwarehouse', { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(process.env.W1_LOGISTICS_EMAIL!);
  await page.getByLabel('Password').fill(process.env.W1_LOGISTICS_PASSWORD!);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/warehouse/);
  await expect(page.getByText(/no warehouse access|invalid login/i)).toHaveCount(0);
});
