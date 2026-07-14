import { expect, test } from '@playwright/test';

const SESSION_KEY = 'intra.memory-session.v1';

test('purchase-order KPI filters fill stable equal grid tracks', async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: SESSION_KEY,
      value: {
        profileId: 'demo-procurement',
        roles: { core: ['staff'], procurement: ['procurement_officer'] },
      },
    },
  );
  await page.goto('/procurement/purchase-orders');

  const filters = page.locator('main button[aria-label$="View details"]');
  await expect(filters).toHaveCount(4);
  await expect(filters.first()).toBeVisible();

  const boxes = await filters.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(
    Math.max(...boxes.map((box) => box.width)) -
      Math.min(...boxes.map((box) => box.width)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...boxes.map((box) => box.height)) -
      Math.min(...boxes.map((box) => box.height)),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  ).toBe(true);
});
