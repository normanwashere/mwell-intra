import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('navigates, searches, restores state, and has no serious accessibility findings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('searchbox').fill('three-way match');
  await page.getByRole('link', { name: /three-way match/i }).first().click();
  const before = page.url();
  await page.reload();
  await expect(page).toHaveURL(before);
  await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true');
  const assertNoSeriousAccessibilityFindings = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  };
  await assertNoSeriousAccessibilityFindings();
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await assertNoSeriousAccessibilityFindings();
});

test('never creates page-level horizontal overflow', async ({ page }) => {
  await page.goto('/#tab=workflows');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('supports keyboard tabs, focused drawers, and keyboard-readable process ribbons', async ({ page }) => {
  await page.goto('/#tab=workflows&article=procurement-to-payment');
  await page.getByRole('tab', { name: 'Workflows' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Release & QA' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Start Here' })).toBeFocused();

  await page.goto('/#tab=workflows&article=doc-manual-mwell-intra-user-manual-md');

  if ((page.viewportSize()?.width ?? 1024) < 1024) {
    await page.getByRole('button', { name: 'On this page', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'On this page' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'On this page', exact: true })).toBeFocused();
  }

  const ribbon = page.getByRole('region', { name: /workflow stages/i }).first();
  await expect(ribbon).toBeVisible();
  await ribbon.focus();
  const dimensions = await ribbon.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  if (dimensions.scrollWidth > dimensions.clientWidth) {
    await page.keyboard.press('End');
    await expect.poll(() => ribbon.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.keyboard.press('Home');
    await expect.poll(() => ribbon.evaluate((element) => element.scrollLeft)).toBe(0);
  }
});

test('limits print output to the selected handbook scope without mutating disclosures', async ({ page }) => {
  await page.goto('/#tab=workflows&article=doc-manual-mwell-intra-user-manual-md');
  const activeArticle = page.locator('article[data-document]:not([hidden])');
  const closedDetails = activeArticle.locator('details:not([open])').first();
  const wasClosed = await closedDetails.count().then(Boolean);
  const printButton = page.getByRole('button', { name: 'Print' });
  await printButton.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Current article' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(printButton).toBeFocused();
  await printButton.click();
  await expect(printButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#print-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Current article' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-print-scope', 'article');
  await expect(activeArticle).toHaveAttribute('data-print-in-scope', 'true');
  if (wasClosed) await expect(closedDetails).not.toHaveAttribute('open', '');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.handbook-shell')).toHaveCSS('display', 'block');
  await expect(activeArticle).toHaveCSS('max-width', 'none');
  const printLayout = await activeArticle.evaluate((article) => ({ article: article.getBoundingClientRect().width, viewport: window.innerWidth }));
  expect(printLayout.article).toBeGreaterThanOrEqual(printLayout.viewport - 1);
  const printOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(printOverflow).toBeLessThanOrEqual(1);
});

test('captures desktop, tablet, and mobile visual review evidence when requested', async ({ page }, testInfo) => {
  if (process.env.HANDBOOK_CAPTURE !== '1' || !['desktop-1440', 'tablet-768', 'mobile-430', 'mobile-320'].includes(testInfo.project.name)) test.skip();

  const captureDir = fileURLToPath(new URL('../../../../outputs/handbook-visual-review/', import.meta.url));
  await mkdir(captureDir, { recursive: true });
  await page.goto('/#tab=workflows&article=doc-manual-mwell-intra-user-manual-md');
  await expect(page.getByRole('region', { name: /workflow stages/i }).first()).toBeVisible();
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-light.png`, fullPage: true });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.evaluate(() => document.documentElement.dataset.printScope = 'article');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-print.png`, fullPage: true });
});
