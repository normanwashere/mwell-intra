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
  await expect(page.getByLabel('Accepted milestone value')).toHaveValue('750000');
  await page.getByRole('button', { name: 'Record milestone acceptance' }).click();
  await expect(page.getByText('Milestone acceptance recorded')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Active acceptance packs' })).toContainText('1 active acceptance pack');

  await setSession(page, sessions.procurement);
  await page.reload();
  await page.getByLabel('Invoice / SI number').fill('SI-UAT-0001');
  await page.getByLabel('Invoice amount').fill('750000');
  await page.getByLabel('Invoice date').fill('2026-08-04');
  await page.getByLabel('Due date').fill('2026-09-03');
  await page.getByLabel('Tax amount').fill('90000');
  await page.getByLabel('Withholding amount').fill('15000');
  await page.getByLabel('Invoice, OR, or SI private reference').fill('private/invoice-si.pdf');
  await page.getByLabel('Delivery or milestone private reference').fill('private/warehouse-acceptance.pdf');
  await page.getByLabel('Tax and withholding private reference').fill('private/tax-support.pdf');
  await page.getByRole('button', { name: 'Validate match and send to Finance' }).click();
  await expect(page.getByText('Payment evidence sent to Finance')).toBeVisible();

  await setSession(page, sessions.finance);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Accept for payment' })).toBeEnabled();
  await page.getByLabel('Finance review note').fill('Three-way match and tax support verified.');
  await page.getByRole('button', { name: 'Accept for payment' }).click();
  await expect(page.getByText('Payment pack accepted')).toBeVisible();
  await expect(page.getByText('Finance accepted')).toBeVisible();

  await page.getByLabel('Release amount').fill('300000');
  await page.getByLabel('Payment reference').fill('BANK-UAT-0001');
  await page.getByRole('button', { name: 'Post payment release' }).click();
  await expect(page.getByText('Payment release posted')).toBeVisible();
  await expect(page.getByText(/remaining.*450,000/i)).toBeVisible();

  await page.getByLabel('Release amount').fill('450000');
  await page.getByLabel('Payment reference').fill('BANK-UAT-0002');
  await page.getByRole('button', { name: 'Post payment release' }).click();
  await expect(page.getByText('Finance released')).toBeVisible();

  const persisted = await page.evaluate(({ key, id }) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
      id: string;
      status: string;
      acceptancePack?: { acceptanceType: string; acceptedAmount?: number };
      paymentReadiness?: { status: string; invoiceNumber?: string; releasedAmount?: number };
    }>;
    return rows.find((row) => row.id === id);
  }, { key: PO_KEY, id: poId });
  expect(persisted?.acceptancePack).toMatchObject({ acceptanceType: 'milestone', acceptedAmount: 750000 });
  expect(persisted?.paymentReadiness).toMatchObject({
    status: 'released',
    invoiceNumber: 'SI-UAT-0001',
    releasedAmount: 750000,
  });
  expect(persisted?.status).toBe('closed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
