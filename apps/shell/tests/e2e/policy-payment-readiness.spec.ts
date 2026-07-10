import { expect, test, type Page } from '@playwright/test';

const SESSION_KEY = 'intra.memory-session.v1';
const PO_KEY = 'intra.procurement.v2.purchase_orders';

const sessions = {
  requester: { profileId: 'demo-logistics', roles: { core: ['staff'], procurement: ['requester'] } },
  procurement: { profileId: 'demo-procurement', roles: { core: ['staff'], procurement: ['procurement_officer'] } },
  finance: { profileId: 'demo-procurement-finance', roles: { core: ['staff'], procurement: ['finance'] } },
} as const;

async function setSession(page: Page, session: (typeof sessions)[keyof typeof sessions]) {
  await page.evaluate(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: session },
  );
}

test('PO acceptance and Finance readiness persist across the governed role flow', async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value));
    },
    { key: SESSION_KEY, value: sessions.procurement },
  );
  await page.goto('/procurement/purchase-orders');
  await expect.poll(() => page.evaluate((key) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
    return rows.length;
  }, PO_KEY)).toBeGreaterThan(0);
  const poId = await page.evaluate((key) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; vendorName: string; status: string }>;
    return rows.find((row) => row.vendorName.includes('North Star') && row.status === 'closed')?.id;
  }, PO_KEY);
  expect(poId).toBeTruthy();
  await setSession(page, sessions.requester);
  await page.goto(`/procurement/purchase-orders/${poId}`);

  await expect(page.getByRole('heading', { name: 'Acceptance and payment readiness' })).toBeVisible();
  await page.getByRole('button', { name: 'Record technical acceptance' }).click();
  await expect(page.getByText('Technical acceptance recorded')).toBeVisible();
  await expect(page.getByText('Acceptance recorded', { exact: true })).toBeVisible();

  await setSession(page, sessions.procurement);
  await page.reload();
  await page.getByLabel('PO, receipt/acceptance, and invoice amounts match').check();
  await page.getByLabel('Invoice, OR, or SI private reference').fill('private/invoice-si.pdf');
  await page.getByLabel('Delivery or milestone private reference').fill('private/warehouse-acceptance.pdf');
  await page.getByLabel('Tax and withholding private reference').fill('private/tax-support.pdf');
  await page.getByRole('button', { name: 'Send to Finance' }).click();
  await expect(page.getByText('Payment evidence sent to Finance')).toBeVisible();

  await setSession(page, sessions.finance);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Accept for payment' })).toBeEnabled();
  await page.getByLabel('Finance review note').fill('Three-way match and tax support verified.');
  await page.getByRole('button', { name: 'Accept for payment' }).click();
  await expect(page.getByText('Payment pack accepted')).toBeVisible();
  await expect(page.getByText('Finance accepted')).toBeVisible();

  const persisted = await page.evaluate(({ key, id }) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; acceptancePack?: unknown; paymentReadiness?: { status: string } }>;
    return rows.find((row) => row.id === id);
  }, { key: PO_KEY, id: poId });
  expect(persisted?.acceptancePack).toBeTruthy();
  expect(persisted?.paymentReadiness?.status).toBe('accepted');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
