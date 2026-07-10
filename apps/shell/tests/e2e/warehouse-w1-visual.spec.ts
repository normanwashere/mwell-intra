import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { auditWarehouseLayout } from '../helpers/warehouseLayoutAudit';
import {
  installWarehouseSession,
  ROLE_ROUTES,
  routeSlug,
  WAREHOUSE_ROLES,
  type AuditTheme,
  type WarehouseRole,
} from '../helpers/warehouseFixtures';

const themes: readonly AuditTheme[] = ['light', 'dark'];
const runId = process.env.W1_RUN_ID ?? 'local';

async function auditRoute(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  role: WarehouseRole,
  theme: AuditTheme,
  route: string,
) {
  await installWarehouseSession(page, role, theme);
  await page.goto(route, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
  await expect(page.locator('body')).not.toContainText(/configuration missing|no warehouse access|access denied/i);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForTimeout(250);
  const assertLayout = async (state: 'top' | 'bottom') => {
    const audit = await auditWarehouseLayout(page, { minimumTarget: 44 });
    expect(audit.overflowElements, `${route} ${state} overflowing elements at ${testInfo.project.name}`).toEqual([]);
    expect(audit.scrollWidth, `${route} ${state} document overflow at ${testInfo.project.name}`).toBeLessThanOrEqual(audit.viewportWidth + 2);
    expect(audit.overlaps, `${route} ${state} sticky/mobile overlaps`).toEqual([]);
    expect(audit.clippedControls, `${route} ${state} clipped controls`).toEqual([]);
    expect(audit.deadEnds, `${route} ${state} dead ends`).toEqual([]);
    expect(audit.undersizedTargets, `${route} ${state} undersized targets`).toEqual([]);
  };
  await assertLayout('top');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length })), `${route} axe violations`).toEqual([]);
  const output = path.resolve(
    'test-results',
    'warehouse-w1',
    runId,
    role,
    theme,
    testInfo.project.name,
    `repeat-${testInfo.repeatEachIndex + 1}`,
  );
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, `${routeSlug(route)}-top.png`),
    fullPage: false,
    animations: 'disabled',
  });
  await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-testid="warehouse-scroll-region"]');
    if (region && region.scrollHeight > region.clientHeight + 2) region.scrollTo({ top: region.scrollHeight, behavior: 'instant' });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  await page.waitForTimeout(100);
  await assertLayout('bottom');
  await page.screenshot({
    path: path.join(output, `${routeSlug(route)}-bottom.png`),
    fullPage: false,
    animations: 'disabled',
  });
}

test.describe('warehouse W1 strict visual matrix', () => {
  for (const role of WAREHOUSE_ROLES) {
    for (const theme of themes) {
      test(`${role} dashboard in ${theme}`, async ({ page }, testInfo) => {
        await auditRoute(page, testInfo, role, theme, '/warehouse');
      });
    }
  }

  for (const route of ROLE_ROUTES.warehouse_admin.slice(1)) {
    test(`warehouse admin route ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, 'warehouse_admin', 'light', route);
    });
  }
});
