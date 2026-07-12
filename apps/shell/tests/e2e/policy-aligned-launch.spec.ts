import { expect, test, type Page } from '@playwright/test';

const SESSION_KEY = 'intra.memory-session.v1';

async function installSession(
  page: Page,
  profileId: string,
  roles: Record<string, string[]>,
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: { profileId, roles } },
  );
}

async function expectStableViewport(page: Page) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    smallTargets: Array.from(
      document.querySelectorAll('button, a, input, select'),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.position !== 'fixed' &&
        rect.height < 32
      );
    }).length,
  }));
  expect(result.overflow).toBe(false);
  expect(result.smallTargets).toBeLessThan(8);
}

test('memory sign-in persists the selected profile before redirecting', async ({
  page,
}) => {
  await page.goto('/login?redirect=%2F');
  await page.getByLabel('Email').fill('ops@mwell.demo');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY),
    )
    .toContain('demo-operations');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('body')).toContainText('Marco');
});

test('Platform Admin does not inherit Legal, Procurement, or Warehouse operating authority', async ({
  page,
}) => {
  await installSession(page, 'demo-admin', {
    core: ['platform_admin', 'staff'],
  });
  await page.goto('/procurement/approvals');
  await expect(page.getByText('No procurement access')).toBeVisible();
  await page.goto('/legal');
  await expect(page.getByText('No legal access')).toBeVisible();
  await page.goto('/warehouse/receiving');
  await expect(page.getByText(/No warehouse access/i)).toBeVisible();
  await page.goto('/admin/users');
  await expect(
    page.getByRole('heading', { name: /Admin|Users/i }).first(),
  ).toBeVisible();
  await expectStableViewport(page);
});

test('external vendor cannot enter internal Legal or Procurement workspaces', async ({
  page,
}) => {
  await installSession(page, 'demo-vendor', { core: ['vendor_portal'] });
  await page.goto('/legal');
  await expect(page.getByText('No legal access')).toBeVisible();
  await page.goto('/procurement');
  await expect(page.getByText('No procurement access')).toBeVisible();
  await page.goto('/vendor');
  await expect(
    page.getByRole('heading', { name: /Vendor|Acme/i }).first(),
  ).toBeVisible();
  await expectStableViewport(page);
});

test('Platform Admin can configure department DOA without gaining approval authority', async ({
  page,
}) => {
  await installSession(page, 'demo-admin', {
    core: ['platform_admin', 'staff'],
  });
  await page.goto('/admin/doa');
  await expect(
    page.getByRole('heading', { name: /Delegation of Authority/i }),
  ).toBeVisible();
  await expect(page.getByText(/department/i).first()).toBeVisible();
  await expectStableViewport(page);
});

test('Legal Admin can configure DOA but Legal Reviewer cannot', async ({
  page,
}) => {
  await installSession(page, 'demo-legal', {
    core: ['staff'],
    legal: ['admin'],
  });
  await page.goto('/admin/doa');
  await expect(
    page.getByRole('heading', { name: /Delegation of Authority/i }),
  ).toBeVisible();
  await expectStableViewport(page);

  await page.evaluate((key) => sessionStorage.removeItem(key), SESSION_KEY);
  await installSession(page, 'demo-legal', {
    core: ['staff'],
    legal: ['legal_reviewer'],
  });
  await page.goto('/admin/doa');
  await expect(
    page.getByRole('heading', { name: 'Access denied' }),
  ).toBeVisible();
});

test('Finance cannot author POs and requester cannot self-confirm sourcing', async ({
  page,
}) => {
  await installSession(page, 'demo-procurement-finance', {
    core: ['staff'],
    procurement: ['finance'],
  });
  await page.goto('/procurement/purchase-orders');
  await expect(
    page.getByRole('link', { name: /Author from approved request/i }),
  ).toHaveCount(0);

  await page.goto('/procurement/requests/new');
  await expect(
    page.getByText(/Access denied|not available for your role/i),
  ).toBeVisible();
  await expectStableViewport(page);
});
