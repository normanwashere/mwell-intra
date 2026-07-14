import { expect, test, type Page } from '@playwright/test';

const SESSION_KEY = 'intra.memory-session.v1';

const sessions = {
  dual: {
    profileId: 'demo-finance',
    roles: {
      core: ['staff'],
      warehouse: ['finance'],
      procurement: ['finance'],
    },
  },
  procurement: {
    profileId: 'demo-procurement-finance',
    roles: { core: ['staff'], procurement: ['finance'] },
  },
  warehouse: {
    profileId: 'demo-finance',
    roles: { core: ['staff'], warehouse: ['finance'] },
  },
} as const;

async function installSession(
  page: Page,
  session: (typeof sessions)[keyof typeof sessions],
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: session },
  );
}

test('dual-scope Finance combines both source systems without duplicating commands', async ({
  page,
}, testInfo) => {
  await installSession(page, sessions.dual);
  await page.goto('/finance');

  await expect(page.getByRole('heading', { name: 'Payment readiness' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cross-module activity' })).toBeVisible();
  await expect(page.getByText('Warehouse Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Procurement Finance', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Procurement records/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Warehouse inventory/i })).toBeVisible();

  await page.getByRole('tab', { name: 'Returns' }).click();
  await expect(page.getByRole('tab', { name: 'Returns' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.locator('span.chip:visible', { hasText: /^Warehouse return$/ }),
  ).toHaveCount(1);
  await expect(
    page.locator('span.chip:visible', { hasText: /^Warehouse receipt$/ }),
  ).toHaveCount(0);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  ).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(`finance-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test('single-scope Finance exposes only source links owned by that role', async ({ page }) => {
  await installSession(page, sessions.procurement);
  await page.goto('/finance');
  await expect(page.getByText('Procurement Finance', { exact: true })).toBeVisible();
  await expect(page.getByText('Warehouse Finance', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Procurement records/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Warehouse inventory/i })).toHaveCount(0);
  await expect(
    page.locator('span.chip:visible', { hasText: /^Warehouse receipt$/ }),
  ).toHaveCount(0);
  await expect(
    page.locator('span.chip:visible', { hasText: /^Warehouse return$/ }),
  ).toHaveCount(0);

  const warehousePage = await page.context().newPage();
  await installSession(warehousePage, sessions.warehouse);
  await warehousePage.goto('/finance');
  await expect(
    warehousePage.getByText('Warehouse Finance', { exact: true }),
  ).toBeVisible();
  await expect(
    warehousePage.getByText('Procurement Finance', { exact: true }),
  ).toHaveCount(0);
  await expect(
    warehousePage.getByRole('link', { name: /Warehouse inventory/i }),
  ).toBeVisible();
  await expect(
    warehousePage.getByRole('link', { name: /Procurement records/i }),
  ).toHaveCount(0);
  await expect(
    warehousePage.getByRole('link', { name: /Review inventory value/i }),
  ).toBeVisible();
  await expect(warehousePage.getByText('No payment packs yet')).toBeVisible();
  await expect(
    warehousePage.locator('span.chip:visible', { hasText: /^Purchase order$/ }),
  ).toHaveCount(0);
  await warehousePage.close();
});
