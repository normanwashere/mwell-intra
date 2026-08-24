import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('navigates canonical and legacy routes, restores per-guide state, and recovers invalid links', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('mwell-intra-handbook:v2', JSON.stringify({
      activeTab: 'workflows',
      activeArticle: 'guide-stock-receiving-putaway',
      expandedIds: ['stock-receiving-putaway:policy-basis'],
      tabScroll: { workflows: 420 },
      query: '',
      scope: 'tab',
      theme: 'dark',
    }));
    history.replaceState({}, '', location.pathname);
  });
  await page.reload();
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway&scope=mode$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('mwell-intra-handbook:v2'))).toBeNull();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('mwell-intra-handbook:v3') ?? '{}'));
  expect(migrated.activeRoute).toEqual({ modeId: 'tasks', guideId: 'stock-receiving-putaway', headingId: null });
  expect(migrated.guideScroll['stock-receiving-putaway']).toBe(420);
  expect(migrated.disclosures['stock-receiving-putaway']).toContain('stock-receiving-putaway:policy-basis');

  await page.goto('/#mode=roles&guide=operations_associate');
  await expect(page.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('article[data-guide-id="operations_associate"] h1')).toBeFocused();

  await page.goto('/#mode=tasks&guide=stock-receiving-putaway&heading=steps');
  const stepsHeading = page.locator('#stock-receiving-putaway-steps > h2');
  await expect(stepsHeading).toBeFocused();
  await expect.poll(() => stepsHeading.evaluate((heading) => heading.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);

  await page.goto('/#tab=start&article=doc-manual-mwell-intra-user-manual-md&heading=doc-manual-mwell-intra-user-manual-md-warehouse-flow');
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway&heading=flow$/);
  await expect(page.locator('#route-notice')).toContainText(/link has moved/i);

  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
  await page.evaluate(() => { (window as typeof window & { __sameDocument?: string }).__sameDocument = 'preserved'; });
  const policy = page.locator('article[data-guide-id="stock-receiving-putaway"] details[data-guide-section="policy-basis"]');
  if (await policy.getAttribute('open') === null) await policy.locator('summary').click();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.waitForTimeout(150);
  const relatedGuide = page.locator('article[data-guide-id="stock-receiving-putaway"] a[data-related-link]').first();
  await relatedGuide.click();
  expect(await page.evaluate(() => (window as typeof window & { __sameDocument?: string }).__sameDocument)).toBe('preserved');
  await page.goBack();
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway$/);
  await expect(policy).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);

  await page.goto('/#mode=tasks&guide=missing-guide');
  await expect(page).toHaveURL(/#mode=home&guide=home$/);
  await expect(page.locator('#route-notice')).toContainText(/could not find/i);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('never creates page-level horizontal overflow', async ({ page }) => {
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('keeps contents and table of contents reachable through the 1180px boundary', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') test.skip();

  for (const width of [1024, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
    const contents = page.getByRole('button', { name: 'Contents', exact: true });
    const toc = page.getByRole('button', { name: 'On this page', exact: true });
    await expect(contents).toBeVisible();
    await expect(toc).toBeVisible();
    await toc.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'On this page' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toc).toBeFocused();
  }
});

test('keeps every mobile toolbar control touch-safe', async ({ page }, testInfo) => {
  if (!['mobile-430', 'mobile-390', 'mobile-360', 'mobile-320'].includes(testInfo.project.name)) test.skip();

  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const controls = await Promise.all(['Contents', 'On this page', 'Toggle color theme', 'Print'].map(async (name) => {
    const control = page.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${name} needs a rendered touch target`).not.toBeNull();
    expect(box?.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(44);
    expect(box?.x, `${name} left edge`).toBeGreaterThanOrEqual(8);
    expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(viewportWidth - 8);
    return box!;
  }));
  for (let index = 0; index < controls.length; index += 1) {
    for (let sibling = index + 1; sibling < controls.length; sibling += 1) {
      const first = controls[index];
      const second = controls[sibling];
      const horizontalGap = Math.max(0, Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width));
      const verticalGap = Math.max(0, Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height));
      expect(horizontalGap >= 6 || verticalGap >= 6, 'toolbar controls need a usable gap').toBe(true);
    }
  }
});

test('completes the keyboard-only handbook journey without drawer or diagram traps', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  await page.getByRole('tab', { name: 'Tasks' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Roles' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Roles' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Tasks' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'System' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();

  const tasksTab = page.getByRole('tab', { name: 'Tasks' });
  await tasksTab.focus();
  await page.keyboard.press('Enter');
  if ((page.viewportSize()?.width ?? 1440) <= 1180) {
    const contentsTrigger = page.getByRole('button', { name: 'Contents', exact: true });
    await contentsTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Contents' })).toBeVisible();
  }
  const procurementGuide = page.locator('#panel-workflows a[data-guide-id="procurement-request-approval"]');
  await procurementGuide.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('article[data-guide-id="procurement-request-approval"] h1')).toBeFocused();
  const policyDisclosure = page.locator('article[data-guide-id="procurement-request-approval"] details[data-guide-section="policy-basis"]');
  const policySummary = policyDisclosure.locator('summary');
  await expect(policyDisclosure).not.toHaveAttribute('open', '');
  await policySummary.focus();
  await expect(policySummary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(policyDisclosure).toHaveAttribute('open', '');

  if ((page.viewportSize()?.width ?? 1440) <= 1180) {
    for (const [triggerName, dialogName] of [['Contents', 'Contents'], ['On this page', 'On this page']] as const) {
      const trigger = page.getByRole('button', { name: triggerName, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog', { name: dialogName });
      await expect(drawer).toBeVisible();
      const close = drawer.getByRole('button', { name: /close/i });
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await drawer.evaluate((element) => {
        const candidates = [...element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((candidate) => candidate.getClientRects().length > 0);
        candidates.at(-1)?.focus();
      });
      await page.keyboard.press('Tab');
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
  }

  await page.goto('/#mode=system&guide=source-references&heading=source-user-manual');
  const workflow = page.locator('[data-workflow-id="procurement-to-payment"]').first();
  const decisions = workflow.getByRole('button', { name: 'Decisions', exact: true });
  await decisions.focus();
  await page.keyboard.press('Enter');
  await expect(decisions).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(workflow.getByRole('region', { name: /workflow stages/i })).toBeFocused();

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

test('limits every print scope without mutating disclosures', async ({ page }) => {
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  const activeArticle = page.locator('article[data-document]:not([hidden])');
  const closedDetails = activeArticle.locator('details:not([open])').first();
  const wasClosed = await closedDetails.count().then(Boolean);
  const articles = page.locator('article[data-document]');
  const articleCount = await articles.count();
  const workflowArticleCount = await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.tab === 'workflows').length);
  const printButton = page.getByRole('button', { name: 'Print' });
  await printButton.focus();
  await page.keyboard.press('ArrowDown');
  await expect(printButton).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(page.getByRole('dialog', { name: 'Print options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current article' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(printButton).toBeFocused();

  for (const [buttonName, scope, expectedCount] of [
    ['Current article', 'article', 1],
    ['Active tab', 'tab', workflowArticleCount],
    ['Complete handbook', 'all', articleCount],
  ] as const) {
    await printButton.focus();
    await page.keyboard.press('ArrowDown');
    const option = page.getByRole('button', { name: buttonName, exact: true });
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-print-scope', scope);
    expect(await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.printInScope === 'true').length)).toBe(expectedCount);
    if (scope === 'article') await expect(activeArticle).toHaveAttribute('data-print-in-scope', 'true');
    if (scope === 'tab') expect(await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.printInScope === 'true').every((article) => article.dataset.tab === 'workflows'))).toBe(true);
    if (scope === 'all') expect(await articles.evaluateAll((elements) => elements.every((article) => article.dataset.printInScope === 'true'))).toBe(true);
    if (wasClosed) await expect(closedDetails).not.toHaveAttribute('open', '');
  }

  await page.emulateMedia({ media: 'screen' });
  await printButton.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Current article', exact: true }).focus();
  await page.keyboard.press('Enter');
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
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  await expect(page.getByRole('region', { name: /workflow stages/i }).first()).toBeVisible();
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-light.png`, fullPage: true });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-dark.png`, fullPage: true });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.evaluate(() => document.documentElement.dataset.printScope = 'article');
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-print.png`, fullPage: true });
});
