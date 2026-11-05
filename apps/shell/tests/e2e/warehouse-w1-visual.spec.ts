import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { auditWarehouseLayout } from '../helpers/warehouseLayoutAudit';
import {
  CANONICAL_WORKSPACE_ROUTES,
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
  // The payment table must also fit tablets with non-overlay scrollbars.
  if (route === '/finance' && page.viewportSize()?.width === 768) {
    await page.addStyleTag({ content: 'html { scrollbar-gutter: stable; }' });
  }
  await expect(page).toHaveURL(url => url.pathname.replace(/\/$/, '') === route.replace(/\/$/, ''));
  if (route === '/warehouse/fulfillment') {
    await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'orders');
  }
  await expect(page.locator('body')).not.toContainText(/configuration missing|no (?:warehouse|events|insights) access|access denied/i);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForTimeout(250);
  const header = page.locator('header').filter({ has: page.getByRole('button', { name: /^Warehouse alerts \(/ }) });
  const checkShortPageStability = route === '/warehouse/fulfillment' && role === 'warehouse_admin'
    && page.viewportSize()?.width === 1280 && page.viewportSize()?.height === 800;
  const headerBaseline = checkShortPageStability ? await header.evaluate(async element => {
    await document.fonts.ready;
    return { height: element.getBoundingClientRect().height, maxScroll: document.documentElement.scrollHeight - innerHeight };
  }) : null;
  const minimumTarget = route.startsWith('/warehouse') ? 44 : testInfo.project.name.includes('mobile') ? 44 : 32;
  const assertLayout = async (state: 'top' | 'bottom') => {
    const audit = await auditWarehouseLayout(page, { minimumTarget });
    expect(audit.overflowElements, `${route} ${state} overflowing elements at ${testInfo.project.name}`).toEqual([]);
    expect(audit.scrollWidth, `${route} ${state} document overflow at ${testInfo.project.name}`).toBeLessThanOrEqual(audit.viewportWidth + 2);
    expect(audit.overlaps, `${route} ${state} sticky/mobile overlaps`).toEqual([]);
    expect(audit.clippedControls, `${route} ${state} clipped controls`).toEqual([]);
    expect(audit.deadEnds, `${route} ${state} dead ends`).toEqual([]);
    expect(audit.undersizedTargets, `${route} ${state} undersized targets`).toEqual([]);
  };
  const assertAccessibility = async () => {
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      axe.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      })),
      `${route} axe violations`,
    ).toEqual([]);
  };
  await assertLayout('top');
  if (route === '/warehouse/quality') {
    const group = page.locator('main details').filter({ has: page.locator('input[type="checkbox"]') }).first();
    const initiallyOpen = await group.evaluate(element => (element as HTMLDetailsElement).open);
    if (!initiallyOpen) {
      await group.locator(':scope > summary').click();
    }
    const selection = group.getByRole('checkbox').first();
    const selectionLabel = selection.locator('..');
    await expect(selection).toBeVisible();
    await selectionLabel.scrollIntoViewIfNeeded();
    await selectionLabel.click({ trial: true });
    await selectionLabel.click();
    await expect(selection).toBeChecked();
    await selectionLabel.click();
    await expect(selection).not.toBeChecked();
    await assertLayout('top');
    await assertAccessibility();
    // Keep the route baseline for its top/bottom sweep after the scoped interaction.
    if (!initiallyOpen) await group.locator(':scope > summary').click();
    await expect(group).toHaveJSProperty('open', initiallyOpen);
    await assertLayout('top');
  }
  await assertAccessibility();
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
  if (headerBaseline) {
    await test.step('short-page bottom keeps header and scroll stable across the shrink threshold', async () => {
      // Keep the real short-page fixture in the range where an 8px header shrink used to oscillate.
      expect(headerBaseline.maxScroll).toBeGreaterThan(24);
      expect(headerBaseline.maxScroll).toBeLessThanOrEqual(32);
      const frames = await header.evaluate(async element => {
        const samples = [];
        for (let i = 0; i < 90; i++) {
          await new Promise(requestAnimationFrame);
          samples.push({ height: element.getBoundingClientRect().height, scrollY,
            maxScroll: document.documentElement.scrollHeight - innerHeight });
        }
        return samples;
      });
      await testInfo.attach('short-page-header-stability', {
        body: JSON.stringify({ baseline: headerBaseline, frames }, null, 2), contentType: 'application/json',
      });
      expect(Math.max(...frames.map(frame => Math.abs(frame.height - headerBaseline.height))), 'header height stays fixed').toBeLessThanOrEqual(0.5);
      expect(Math.max(...frames.map(frame => Math.abs(frame.maxScroll - headerBaseline.maxScroll))), 'scroll range stays fixed').toBeLessThanOrEqual(0.5);
      expect(Math.max(...frames.map(frame => Math.abs(frame.scrollY - headerBaseline.maxScroll))), 'page stays at its original bottom').toBeLessThanOrEqual(1);
      await expect(header).toHaveClass(/\bshadow-e1\b/);
    });
  }
  if (route === '/warehouse/fulfillment') {
    const tabs = page.getByRole('tablist', { name: 'Fulfillment workspace', exact: true });
    if (role !== 'warehouse_admin' && await tabs.count() === 0) return;
    await tabs.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await tabs.evaluate(element => {
      const labels = [...element.querySelectorAll<HTMLElement>('[role="tab"]')].map(button => {
        const label = [...button.children].find(child => getComputedStyle(child).display !== 'none');
        if (!label) throw new Error('Fulfillment tab has no visible label');
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect(), box = button.getBoundingClientRect(), css = getComputedStyle(button);
        return {
          name: label.textContent,
          text: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
          padded: {
            left: box.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft),
            right: box.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight),
            top: box.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop),
            bottom: box.bottom - parseFloat(css.borderBottomWidth) - parseFloat(css.paddingBottom),
          },
        };
      });
      return { overflowX: getComputedStyle(element).overflowX, labels };
    });
    await testInfo.attach('fulfillment-tab-label-geometry', {
      body: JSON.stringify(geometry, null, 2), contentType: 'application/json',
    });
    expect(geometry.overflowX).toBe('auto');
    for (const label of geometry.labels) {
      expect.soft(label.text.left, `${label.name} left padding`).toBeGreaterThanOrEqual(label.padded.left - 0.5);
      expect.soft(label.text.right, `${label.name} right padding`).toBeLessThanOrEqual(label.padded.right + 0.5);
      expect.soft(label.text.top, `${label.name} top padding`).toBeGreaterThanOrEqual(label.padded.top - 0.5);
      expect.soft(label.text.bottom, `${label.name} bottom padding`).toBeLessThanOrEqual(label.padded.bottom + 0.5);
    }
    for (let i = 0; i < geometry.labels.length; i++) {
      for (const other of geometry.labels.slice(i + 1)) {
        const label = geometry.labels[i];
        if (Math.min(label.text.bottom, other.text.bottom) - Math.max(label.text.top, other.text.top) > 0.5) {
          const gap = Math.max(other.text.left - label.text.right, label.text.left - other.text.right);
          expect.soft(gap, `${label.name}/${other.name} label separation`).toBeGreaterThanOrEqual(4);
        }
      }
    }
    if (role === 'warehouse_admin') {
      const destinations = [
        ['orders', 'Orders and events'], ['requests', 'Department requests'], ['returns', 'Return cases'],
        ['kits', 'Kits and re-kits'], ['conversion', 'Stock conversion'],
      ] as const;
      await expect(tabs.getByRole('tab')).toHaveCount(destinations.length);
      if (headerBaseline) {
        await tabs.getByRole('tab', { name: 'Orders and events', exact: true }).focus();
        await page.keyboard.press('Tab');
        const requests = tabs.getByRole('tab', { name: 'Department requests', exact: true });
        await expect(requests).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(requests).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'requests');
      }
      for (const [id, name] of destinations) {
        const tab = tabs.getByRole('tab', { name, exact: true });
        await tab.scrollIntoViewIfNeeded();
        await tab.click({ trial: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(url => url.searchParams.get('tab') === id);
      }
      await tabs.getByRole('tab', { name: 'Orders and events', exact: true }).click();
      await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'orders');
    }
  }
}

test.describe('warehouse W1 strict visual matrix', () => {
  test('warehouse operator fulfillment keeps ungranted tabs absent', async ({ page }, testInfo) => {
    await auditRoute(page, testInfo, 'warehouse_operator', 'light', '/warehouse/fulfillment');
    const tabs = page.getByRole('tablist', { name: 'Fulfillment workspace', exact: true });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    for (const name of ['Orders and events', 'Return cases', 'Stock conversion']) {
      await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
    }
    for (const [id, name] of [['requests', 'Department requests'], ['kits', 'Kits and re-kits']] as const) {
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveCount(0);
      await page.goto(`/warehouse/fulfillment?tab=${id}`, { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(url => url.searchParams.get('tab') === 'orders');
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveCount(0);
      await expect(tabs.getByRole('tab', { name: 'Orders and events', exact: true })).toHaveAttribute('aria-selected', 'true');
    }
  });

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

  for (const { role, route } of CANONICAL_WORKSPACE_ROUTES) {
    test(`${role} canonical workspace ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, role, 'light', route);
    });
  }

  for (const { role, route, label } of [
    {
      role: 'warehouse_admin' as const,
      route: '/warehouse/fulfillment',
      label: 'governed fulfillment',
    },
    {
      role: 'procurement' as const,
      route: '/warehouse/procurement',
      label: 'replenishment planning',
    },
    {
      role: 'finance' as const,
      route: '/finance',
      label: 'unified Finance close',
    },
    {
      role: 'marketing' as const,
      route: '/events/evt-demo-corporate',
      label: 'event reconciliation',
    },
  ]) {
    test(`${label} workspace ${route}`, async ({ page }, testInfo) => {
      await auditRoute(page, testInfo, role, 'light', route);
    });
  }
});
