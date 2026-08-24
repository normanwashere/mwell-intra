import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function expectFocusedBelowStickyChrome(target: Locator) {
  await expect(target).toBeFocused();
  const metrics = await target.evaluate((element) => {
    const targetRect = element.getBoundingClientRect();
    const occlusionBottom = [...document.querySelectorAll('body *')].reduce((bottom, candidate) => {
      if (candidate === element || candidate.contains(element)) return bottom;
      const style = getComputedStyle(candidate);
      if (!['fixed', 'sticky'].includes(style.position) || style.visibility === 'hidden' || style.display === 'none') return bottom;
      const rect = candidate.getBoundingClientRect();
      const overlapsTarget = rect.right > targetRect.left + 1 && rect.left < targetRect.right - 1;
      const declaredTop = Number.parseFloat(style.top);
      const isAtStickyTop = Number.isFinite(declaredTop) && rect.top <= declaredTop + 1;
      return overlapsTarget && isAtStickyTop && rect.bottom > 0 ? Math.max(bottom, rect.bottom) : bottom;
    }, 0);
    return { targetTop: targetRect.top, occlusionBottom };
  });
  expect(metrics.targetTop, `target must clear sticky chrome ending at ${metrics.occlusionBottom}px`).toBeGreaterThanOrEqual(metrics.occlusionBottom + 12);
}

async function expectTouchSafeGroup(controls: Locator[], label: string) {
  const boxes = await Promise.all(controls.map(async (control, index) => {
    await expect(control, `${label} control ${index + 1} must be visible`).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${label} control ${index + 1} needs a rendered touch target`).not.toBeNull();
    expect(box?.width, `${label} control ${index + 1} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height, `${label} control ${index + 1} height`).toBeGreaterThanOrEqual(44);
    return box!;
  }));
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    const horizontalGap = Math.max(0, Math.max(previous.x, current.x) - Math.min(previous.x + previous.width, current.x + current.width));
    const verticalGap = Math.max(0, Math.max(previous.y, current.y) - Math.min(previous.y + previous.height, current.y + current.height));
    expect(horizontalGap >= 6 || verticalGap >= 6, `${label} adjacent controls need a 6px gap`).toBe(true);
  }
}

const operationalSearchCases = [
  ['three-way match', 'finance-readiness-evidence'],
  ['approve request', 'procurement-request-approval'],
  ['report damaged item', 'stock-receiving-putaway'],
  ['reset password', 'platform_administrator'],
  ['cycle count', 'inventory-count-variance'],
  ['DOA', 'department-doa-activation'],
  ['delegation of authority', 'department-doa-activation'],
  ['receive stock', 'stock-receiving-putaway'],
  ['pick and pack', 'ecommerce-fulfillment-delivery'],
  ['invalid login', 'platform_administrator'],
  ['access denied', 'platform_administrator'],
  ['vendor renewal', 'vendor-accreditation-renewal'],
  ['renew vendor', 'vendor-accreditation-renewal'],
  ['RFQ', 'procurement-request-approval'],
  ['refund', 'returns-replacements-refunds-rma'],
  ['lost event stock', 'event-stock-custody'],
  ['cycle count variance', 'inventory-count-variance'],
] as const;

test('search certifies operational answers and canonical destinations', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const searchbox = page.getByRole('searchbox');

  for (const [query, guideId] of operationalSearchCases) {
    await searchbox.fill(query);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(query).replaceAll('%20', '\\+')}|q=${encodeURIComponent(query)}`));
    const results = page.locator('#search-results [data-search-result]');
    await expect(results.first(), `${query} should return a result`).toBeVisible();
    const topThreeGuideIds = await results.evaluateAll((links) => links.slice(0, 3).map((link) => (link as HTMLElement).dataset.guideId));
    expect(topThreeGuideIds, `${query} should surface ${guideId} in the first three results`).toContain(guideId);

    const destination = page.locator(`#search-results [data-search-result][data-guide-id="${guideId}"]`).first();
    await expect(destination).toHaveAttribute('data-result-type', /^(Task|Step|Decision|Role|Troubleshooting)$/);
    await expect(destination.locator('.search-result-context')).not.toHaveText('');
    await expect(destination.locator('.search-result-reason')).not.toHaveText('');
    await expect(destination.locator('.search-result-excerpt')).not.toHaveText('');
    await expect(destination).toHaveAttribute('href', new RegExp(`^#mode=(?:tasks|roles)&guide=${guideId}&heading=`));

    const rankedResults = await results.evaluateAll((links) => links.map((link) => ({
      guideId: (link as HTMLElement).dataset.guideId,
      type: (link as HTMLElement).dataset.resultType,
    })));
    const expectedIndex = rankedResults.findIndex((result) => result.guideId === guideId);
    const firstSystemIndex = rankedResults.findIndex((result) => result.type === 'System reference');
    expect(rankedResults[0]?.type, `${query} should start with an operational record`).not.toBe('System reference');
    if (firstSystemIndex >= 0) expect(expectedIndex, `${query} should rank its operational answer ahead of System evidence`).toBeLessThan(firstSystemIndex);
  }

  await page.reload();
  await expect(searchbox).toHaveValue('cycle count variance');
  await expect(page.locator('#search-results [data-guide-id="inventory-count-variance"]').first()).toBeVisible();

  await searchbox.fill('DOA');
  const doaResults = page.locator('#search-results [data-search-result]');
  expect(await doaResults.count(), 'DOA results should be logically deduplicated').toBeLessThanOrEqual(8);
  expect(await doaResults.evaluateAll((links) => new Set(links.map((link) => `${(link as HTMLElement).dataset.resultType}:${(link as HTMLElement).dataset.guideId}:${(link as HTMLElement).dataset.heading}`)).size)).toBe(await doaResults.count());

  await searchbox.fill('report damaged item');
  const destination = page.locator('#search-results [data-guide-id="stock-receiving-putaway"]').first();
  await page.evaluate(() => { (window as typeof window & { __sameDocument?: string }).__sameDocument = 'preserved'; });
  await destination.click();
  expect(await page.evaluate(() => (window as typeof window & { __sameDocument?: string }).__sameDocument)).toBe('preserved');
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway&heading=[^&]+&q=report\+damaged\+item&scope=all$/);
  const headingId = new URL(page.url()).hash.match(/heading=([^&]+)/)?.[1];
  expect(headingId).toBeTruthy();
  await expectFocusedBelowStickyChrome(page.locator(`#stock-receiving-putaway-${headingId} h3`));
});

test('search offers accessible no-result recovery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox').fill('zzzz no handbook answer');
  const recovery = page.locator('#empty');
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  await expect(recovery).toContainText(/try a related term/i);
  await expect(recovery.getByRole('link', { name: /receive stock/i })).toBeVisible();
  await expect(recovery.getByRole('link', { name: /role guides/i })).toBeVisible();
  await expect(recovery.getByRole('link', { name: /system/i })).toBeVisible();
  expect(await recovery.evaluate((element) => element.parentElement?.id)).toBe('contents-rail');
  if ((page.viewportSize()?.width ?? 1440) <= 1180) {
    await expect(page.locator('#contents-rail')).toContainText(/no direct answer found/i);
    await expect(page.locator('#contents-rail')).not.toHaveAttribute('aria-modal');
  }
  await recovery.getByRole('link', { name: /receive stock/i }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('receive stock');
  await expect(page.locator('#search-results [data-guide-id="stock-receiving-putaway"]').first()).toBeVisible();
});

test('search includes governance System intent without displacing operational answers', async ({ page }) => {
  await page.goto('/');
  const cases = [
    ['DOA', 'department-doa-activation', 'administration-configuration'],
    ['delegation of authority', 'department-doa-activation', 'administration-configuration'],
    ['policy', 'procurement-request-approval', 'security-governance'],
    ['security', 'platform_administrator', 'security-governance'],
  ] as const;

  for (const [query, operationalGuideId, systemGuideId] of cases) {
    await page.getByRole('searchbox').fill(query);
    const results = page.locator('#search-results [data-search-result]');
    await expect(results.first()).toBeVisible();
    await expect(page.locator(`#search-results [data-result-type="System reference"][data-guide-id="${systemGuideId}"]`).first()).toBeVisible();
    const topThree = await results.evaluateAll((links) => links.slice(0, 3).map((link) => (link as HTMLElement).dataset.guideId));
    expect(topThree, `${query} should retain an operational answer in the top three`).toContain(operationalGuideId);
  }
});

test('compact search keeps focus coherent across typing restore activation and Escape', async ({ page }, testInfo) => {
  if (!['mobile-430', 'mobile-390', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
  const searchbox = page.getByRole('searchbox');
  const contents = page.locator('#contents-rail');

  await searchbox.focus();
  await searchbox.pressSequentially('report damaged item');
  await expect(searchbox).toBeFocused();
  await expect(contents).toBeVisible();
  await expect(contents).not.toHaveAttribute('aria-modal');
  await expect(contents).not.toHaveAttribute('role', 'dialog');
  await expect(page.locator('#result-count')).toContainText(/result/);

  await page.keyboard.press('Escape');
  await expect(contents).toBeHidden();
  await expect(searchbox).toBeFocused();

  const contentsTrigger = page.getByRole('button', { name: 'Menu', exact: true });
  await contentsTrigger.click();
  await expect(contents).toHaveAttribute('aria-modal', 'true');
  await expect(contents.getByRole('button', { name: /close menu/i })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(contents).toBeHidden();
  await expect(contentsTrigger).toBeFocused();

  await page.goto('/#mode=tasks&guide=stock-receiving-putaway&heading=step-3&q=report+damaged+item&scope=all');
  await page.reload();
  await expect(contents).toBeVisible();
  await expect(contents).not.toHaveAttribute('aria-modal');
  await expect(page.locator('#stock-receiving-putaway-step-3 h3')).toBeFocused();

  const result = page.locator('#search-results [data-result-type="Step"][data-guide-id="stock-receiving-putaway"]').first();
  await page.evaluate(() => { (window as typeof window & { __sameDocument?: string }).__sameDocument = 'preserved'; });
  await result.click();
  await expect(contents).toBeHidden();
  expect(await page.evaluate(() => (window as typeof window & { __sameDocument?: string }).__sameDocument)).toBe('preserved');
  await expectFocusedBelowStickyChrome(page.locator('#stock-receiving-putaway-step-3 h3'));
});

test('compact search and modal surfaces coordinate visibility focus and shortcuts', async ({ page }, testInfo) => {
  if (!['mobile-430', 'mobile-390', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');

  const searchbox = page.getByRole('searchbox');
  const contents = page.locator('#contents-rail');
  const toc = page.locator('#page-toc');
  const printMenu = page.locator('#print-menu');
  const contentsTrigger = page.getByRole('button', { name: 'Menu', exact: true });
  const tocTrigger = page.getByRole('button', { name: 'In this guide', exact: true });
  const printTrigger = page.locator('[data-print-trigger]');
  const compactSurfaces = page.locator('#contents-rail, #page-toc, #print-menu, [data-screenshot-surface]');
  const expectOneVisibleSurfaceWithoutOverlap = async (expected: ReturnType<typeof page.locator>) => {
    await expect(expected).toBeVisible();
    const geometry = await compactSurfaces.evaluateAll((elements) => {
      const visible = elements.filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
      const overlaps = visible.flatMap((element, index) => visible.slice(index + 1).map((other) => {
        const first = element.getBoundingClientRect();
        const second = other.getBoundingClientRect();
        return Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
          * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      }));
      return { visibleCount: visible.length, overlapArea: overlaps.reduce((total, area) => total + area, 0) };
    });
    expect(geometry).toEqual({ visibleCount: 1, overlapArea: 0 });
  };

  await searchbox.fill('report damaged item');
  await expect(searchbox).toBeFocused();
  await expectOneVisibleSurfaceWithoutOverlap(contents);
  await expect(contents).not.toHaveAttribute('aria-modal');
  await expect(contentsTrigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(contents).toBeHidden();
  await tocTrigger.click();
  await expectOneVisibleSurfaceWithoutOverlap(toc);
  await expect(contents).toBeHidden();
  await expect(contentsTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(tocTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(toc).toHaveAttribute('aria-modal', 'true');
  expect(await toc.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('/');
  expect(await toc.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(searchbox).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toc).toBeHidden();
  await expect(tocTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(tocTrigger).toBeFocused();

  await searchbox.focus();
  await searchbox.fill('cycle count');
  await expectOneVisibleSurfaceWithoutOverlap(contents);
  await contentsTrigger.click();
  await expectOneVisibleSurfaceWithoutOverlap(contents);
  await expect(contents).not.toHaveAttribute('data-search-surface');
  await expect(contents).toHaveAttribute('aria-modal', 'true');
  await expect(contentsTrigger).toHaveAttribute('aria-expanded', 'true');
  expect(await contents.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(contents).toBeHidden();
  await expect(contentsTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(contentsTrigger).toBeFocused();

  await searchbox.focus();
  await searchbox.fill('receive stock');
  await expectOneVisibleSurfaceWithoutOverlap(contents);
  await printTrigger.click();
  await expectOneVisibleSurfaceWithoutOverlap(printMenu);
  await expect(contents).toBeHidden();
  await expect(printMenu).toHaveAttribute('aria-modal', 'true');
  await expect(printTrigger).toHaveAttribute('aria-expanded', 'true');
  expect(await printMenu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(printMenu).toBeHidden();
  await expect(printTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(printTrigger).toBeFocused();
});

test('search suggestions activate canonical route state through history', async ({ page }, testInfo) => {
  if (!['desktop-1440', 'mobile-390'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
  const searchbox = page.getByRole('searchbox');
  const resultStatus = page.locator('#result-count');
  await searchbox.fill('zzzz no handbook answer');
  await expect(searchbox).toBeFocused();
  await expect(resultStatus).toHaveText(/0 results/);
  await expect(page.locator('#empty [role="status"]')).toContainText(/try a related term/i);

  await page.locator('#empty [data-search-suggestion="receive stock"]').click();
  await expect(page).toHaveURL(/#mode=home&guide=home&q=receive\+stock&scope=all$/);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-guide-id="home"]')).toBeVisible();
  await expect(page.locator('#search-results [data-guide-id="stock-receiving-putaway"]').first()).toBeVisible();
  await expect(page.locator('#search-results [data-search-result]').first()).toBeFocused();
  await expect(resultStatus).not.toHaveText(/0 results/);

  await page.goBack();
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway&q=zzzz\+no\+handbook\+answer&scope=all$/);
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('article[data-guide-id="stock-receiving-putaway"]')).toBeVisible();
  await expect(resultStatus).toHaveText(/0 results/);

  await page.goForward();
  await expect(page).toHaveURL(/#mode=home&guide=home&q=receive\+stock&scope=all$/);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-guide-id="home"]')).toBeVisible();
  await expect(resultStatus).not.toHaveText(/0 results/);
});

test('search result types activate and focus their exact canonical destinations', async ({ page }, testInfo) => {
  if (!['desktop-1440', 'mobile-390'].includes(testInfo.project.name)) test.skip();
  const cases = [
    ['receive stock', 'Task', 'stock-receiving-putaway'],
    ['report damaged item', 'Step', 'stock-receiving-putaway'],
    ['lost event stock', 'Decision', 'event-stock-custody'],
    ['Operations Associate', 'Role', 'operations_associate'],
    ['reset password', 'Troubleshooting', 'platform_administrator'],
    ['security', 'System reference', 'security-governance'],
  ] as const;

  for (const [query, type, guideId] of cases) {
    await page.goto('/#mode=home&guide=home');
    const searchbox = page.getByRole('searchbox');
    await searchbox.fill(query);
    await expect(searchbox).toBeFocused();
    const result = page.locator(`#search-results [data-result-type="${type}"][data-guide-id="${guideId}"]`).first();
    await expect(result, `${type} result for ${query}`).toBeVisible();
    const href = await result.getAttribute('href');
    const headingId = new URLSearchParams(href?.replace(/^#/, '')).get('heading');
    expect(headingId).toBeTruthy();
    await page.evaluate(() => { (window as typeof window & { __sameDocument?: string }).__sameDocument = 'preserved'; });
    await result.click();
    expect(await page.evaluate(() => (window as typeof window & { __sameDocument?: string }).__sameDocument)).toBe('preserved');
    await expect(page).toHaveURL(new RegExp(`#mode=(?:tasks|roles|system)&guide=${guideId}&heading=${headingId}`));
    const focusState = await page.evaluate(({ guideId, headingId }) => {
      const anchor = document.getElementById(`${guideId}-${headingId}`);
      const focused = document.activeElement;
      return {
        withinDestination: Boolean(anchor && focused && (anchor === focused || anchor.contains(focused))),
        tagName: focused?.tagName,
      };
    }, { guideId, headingId });
    expect(focusState.withinDestination, `${type} should focus ${guideId}-${headingId}`).toBe(true);
    expect(focusState.tagName).toMatch(/^(H[1-6]|SUMMARY)$/);
  }
});

test('navigates canonical and legacy routes, restores per-guide state, and recovers invalid links', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('mwell-intra-handbook:v2', JSON.stringify({
      activeTab: 'workflows',
      activeArticle: 'doc-process-reference-library-md',
      expandedIds: ['procurement-request-approval:policy-basis'],
      tabScroll: { workflows: 420 },
      query: '',
      scope: 'tab',
      theme: 'dark',
    }));
    history.replaceState({}, '', location.pathname);
  });
  await page.reload();
  await expect(page).toHaveURL(/#mode=tasks&guide=procurement-request-approval&heading=document-controls&scope=mode$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('mwell-intra-handbook:v2'))).toBeNull();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('mwell-intra-handbook:v3') ?? '{}'));
  expect(migrated.activeRoute).toEqual({ modeId: 'tasks', guideId: 'procurement-request-approval', headingId: 'document-controls', query: '', scope: 'mode' });
  expect(migrated.disclosures['procurement-request-approval']).toContain('procurement-request-approval:policy-basis');

  await page.goto('/#mode=roles&guide=operations_associate');
  await expect(page.locator('#mode-roles')).toHaveAttribute('aria-selected', 'true');
  await expectFocusedBelowStickyChrome(page.locator('article[data-guide-id="operations_associate"] h1'));

  await page.goto('/#mode=tasks&guide=stock-receiving-putaway&heading=steps');
  const stepsHeading = page.locator('#stock-receiving-putaway-steps > h2');
  await expectFocusedBelowStickyChrome(stepsHeading);

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
  const relatedUrl = page.url();
  expect(await page.evaluate(() => (window as typeof window & { __sameDocument?: string }).__sameDocument)).toBe('preserved');
  await page.goBack();
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway$/);
  await expect(policy).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.goForward();
  await expect(page).toHaveURL(relatedUrl);
  await page.goBack();
  await expect(page).toHaveURL(/#mode=tasks&guide=stock-receiving-putaway$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect.poll(async () => {
    const before = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.scrollY);
    return Math.abs(after - before);
  }).toBeLessThan(2);
  const scrollBeforeLifecycle = await page.evaluate(() => window.scrollY);
  const lifecyclePage = await page.context().newPage();
  await lifecyclePage.goto('about:blank');
  await lifecyclePage.bringToFront();
  await page.bringToFront();
  const scrollAfterLifecycle = await page.evaluate(() => window.scrollY);
  expect(scrollAfterLifecycle).toBeGreaterThan(300);
  expect(Math.abs(scrollAfterLifecycle - scrollBeforeLifecycle)).toBeLessThan(100);
  await lifecyclePage.close();
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);

  await page.goto('/#mode=tasks&guide=missing-guide');
  await expect(page).toHaveURL(/#mode=home&guide=home$/);
  await expect(page.locator('#route-notice')).toContainText(/could not find/i);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.goto('/#foo=bar');
  await expect(page).toHaveURL(/#mode=home&guide=home$/);
  await expect(page.locator('#route-notice')).toContainText(/could not find/i);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mwell-intra-handbook:v3') ?? '{}').activeRoute)).toMatchObject({ modeId: 'home', guideId: 'home' });
  await page.goto('/');
  await expect(page).toHaveURL(/#mode=home&guide=home$/);
  await expect(page.locator('#route-notice')).toBeHidden();
});

test('restores Home recent guides and updates deduped order after navigation', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') test.skip();
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('mwell-intra-handbook:v3', JSON.stringify({
      activeRoute: { modeId: 'home', guideId: 'home', headingId: null, query: '', scope: 'all' },
      recentGuides: ['stock-receiving-putaway', 'procurement-request-approval', 'stock-receiving-putaway'],
      guideScroll: {}, disclosures: {}, diagramViews: {}, diagramZoom: {}, diagramModes: {}, theme: 'light',
    }));
    history.replaceState({}, '', location.pathname);
  });
  await page.reload();
  const recentIds = () => page.locator('[data-recent-guides] a').evaluateAll((links) => links.map((link) => (link as HTMLElement).dataset.guideId));
  await expect.poll(recentIds).toEqual(['stock-receiving-putaway', 'procurement-request-approval']);

  await page.locator('[data-recent-guides] a[data-guide-id="procurement-request-approval"]').click();
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect.poll(recentIds).toEqual(['procurement-request-approval', 'stock-receiving-putaway']);
  await page.locator('[data-recent-guides] a[data-guide-id="stock-receiving-putaway"]').click();
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect.poll(recentIds).toEqual(['stock-receiving-putaway', 'procurement-request-approval']);
});

test('restores v3 query scope and representative diagram state', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') test.skip();
  const diagramId = 'doc-manual-mwell-intra-user-manual-md:flow:procurement-to-payment:decision';
  await page.goto('/');
  await page.evaluate(({ diagramId }) => {
    localStorage.clear();
    localStorage.setItem('mwell-intra-handbook:v3', JSON.stringify({
      activeRoute: { modeId: 'system', guideId: 'source-references', headingId: 'source-user-manual', query: 'procurement', scope: 'mode' },
      recentGuides: [], guideScroll: {}, disclosures: {},
      diagramViews: { [diagramId]: { left: 24, top: 18 } },
      diagramZoom: { [diagramId]: 1.2 },
      diagramModes: { 'doc-manual-mwell-intra-user-manual-md:flow:procurement-to-payment': 'decision' },
      theme: 'light',
    }));
    history.replaceState({}, '', location.pathname);
  }, { diagramId });
  await page.reload();
  await expect(page).toHaveURL(/#mode=system&guide=source-references&heading=source-user-manual&q=procurement&scope=mode$/);
  await expect(page.getByRole('searchbox')).toHaveValue('procurement');
  await expect(page.getByRole('button', { name: 'This mode' })).toHaveAttribute('aria-pressed', 'true');
  const workflow = page.locator('[data-workflow-id="procurement-to-payment"]').first();
  await expect(workflow.getByRole('button', { name: 'Decisions', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const diagram = page.locator(`[data-diagram-id="${diagramId}"]`);
  await expect(diagram).toBeVisible();
  await expect(diagram).toHaveAttribute('data-diagram-rendered-scale', '1.2');
  await expect.poll(() => diagram.locator('[data-diagram-viewport]').evaluate((viewport) => ({ left: viewport.scrollLeft, top: viewport.scrollTop }))).toEqual({ left: 24, top: 18 });
});

test('keeps the current mode label synchronized across activation history recovery and restore', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') test.skip();
  const label = page.locator('[data-current-mode-label]');

  await page.goto('/#mode=home&guide=home');
  await expect(label).toHaveText('Home');
  await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
  await expect(label).toHaveText('Tasks');
  await page.getByRole('button', { name: 'This mode', exact: true }).click();
  await expect(page.getByRole('button', { name: 'This mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(label).toHaveText('Tasks');
  await page.getByRole('tab', { name: 'Roles', exact: true }).click();
  await expect(label).toHaveText('Roles');
  await page.getByRole('tab', { name: 'System', exact: true }).click();
  await expect(label).toHaveText('System');
  await page.goBack();
  await expect(label).toHaveText('Roles');
  await page.goForward();
  await expect(label).toHaveText('System');

  await page.goto('/#mode=missing&guide=missing');
  await expect(label).toHaveText('Home');
  await page.evaluate(() => {
    localStorage.setItem('mwell-intra-handbook:v3', JSON.stringify({
      activeRoute: { modeId: 'roles', guideId: 'operations_associate', headingId: null, query: '', scope: 'mode' },
      recentGuides: [], guideScroll: {}, disclosures: {}, diagramViews: {}, diagramZoom: {}, diagramModes: {}, theme: 'light',
    }));
    history.replaceState({}, '', location.pathname);
  });
  await page.reload();
  await expect(label).toHaveText('Roles');
  await expect(page.getByRole('button', { name: 'This mode', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('fits visible Mermaid content inside its viewport and preserves dark contrast', async ({ page }, testInfo) => {
  if (!['desktop-1440', 'tablet-768', 'mobile-430', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  const shell = page.locator('article[data-guide-id="procurement-request-approval"] .diagram-shell').first();
  await expect(shell).toHaveAttribute('data-diagram-scale', 'fit');

  const diagramMetrics = async () => shell.evaluate((element) => {
    const viewport = element.querySelector('[data-diagram-viewport]') as HTMLElement;
    const diagram = element.querySelector('.mermaid') as HTMLElement;
    const svg = element.querySelector('svg') as SVGSVGElement;
    const viewportRect = viewport.getBoundingClientRect();
    const diagramRect = diagram.getBoundingClientRect();
    const intersectionArea = (first: DOMRect, second: DOMRect) => Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
      * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    const visibleElements = (selector: string) => [...svg.querySelectorAll(selector)].filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0' && intersectionArea(rect, viewportRect) > 1;
    });
    return {
      viewport: { left: viewportRect.left, top: viewportRect.top, right: viewportRect.right, bottom: viewportRect.bottom },
      diagram: { left: diagramRect.left, top: diagramRect.top, right: diagramRect.right, bottom: diagramRect.bottom, width: diagramRect.width, height: diagramRect.height },
      scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
      visibleLabels: visibleElements('text, foreignObject').length,
      visibleNodes: visibleElements('.node').length,
      svgIntersection: intersectionArea(svg.getBoundingClientRect(), viewportRect),
    };
  });
  const assertFit = async () => {
    const metrics = await diagramMetrics();
    expect(metrics.diagram.left).toBeGreaterThanOrEqual(metrics.viewport.left - 1);
    expect(metrics.diagram.top).toBeGreaterThanOrEqual(metrics.viewport.top - 1);
    expect(metrics.diagram.right).toBeLessThanOrEqual(metrics.viewport.right + 1);
    expect(metrics.diagram.bottom).toBeLessThanOrEqual(metrics.viewport.bottom + 1);
    expect(Math.abs((metrics.diagram.left + metrics.diagram.right) / 2 - (metrics.viewport.left + metrics.viewport.right) / 2)).toBeLessThanOrEqual(10);
    expect(Math.abs((metrics.diagram.top + metrics.diagram.bottom) / 2 - (metrics.viewport.top + metrics.viewport.bottom) / 2)).toBeLessThanOrEqual(10);
    expect(metrics.diagram.width).toBeGreaterThan(40);
    expect(metrics.diagram.height).toBeGreaterThan(40);
    expect(metrics.scroll).toEqual({ left: 0, top: 0 });
    expect(metrics.visibleLabels).toBeGreaterThanOrEqual(4);
    expect(metrics.visibleNodes).toBeGreaterThanOrEqual(4);
    expect(metrics.svgIntersection).toBeGreaterThan(1_000);
  };

  await assertFit();
  const compact = (page.viewportSize()?.width ?? 1440) <= 1180;
  if (compact) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  if (compact) await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertFit();

  const contrast = await shell.evaluate((element) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([red, green, blue]: number[]) => [red, green, blue].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground: string, background: string) => {
      const first = luminance(parse(foreground));
      const second = luminance(parse(background));
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const controls = [...element.querySelectorAll('.diagram-toolbar button, figcaption')].map((control) => {
      const style = getComputedStyle(control);
      return ratio(style.color, style.backgroundColor);
    });
    const node = element.querySelector('.node');
    const nodeLabel = node?.querySelector('.nodeLabel') as HTMLElement | null;
    const nodeShape = node?.querySelector('rect, polygon, path') as SVGElement | null;
    return {
      controls,
      nodeLabelContrast: nodeLabel && nodeShape ? ratio(getComputedStyle(nodeLabel).color, getComputedStyle(nodeShape).fill) : 0,
    };
  });
  expect(contrast.controls.length).toBeGreaterThanOrEqual(5);
  expect(Math.min(...contrast.controls)).toBeGreaterThanOrEqual(4.5);
  expect(contrast.nodeLabelContrast).toBeGreaterThanOrEqual(4.5);
});

test('never creates page-level horizontal overflow', async ({ page }) => {
  for (const route of [
    '/#mode=home&guide=home',
    '/#mode=tasks&guide=stock-receiving-putaway',
    '/#mode=roles&guide=operations_associate',
    '/#mode=system&guide=source-references&heading=source-user-manual',
  ]) {
    await page.goto(route);
    const layout = await page.evaluate(() => {
      const richContent = [...document.querySelectorAll('.diagram-viewport, .article-body table, .article-body pre')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            overflowX: getComputedStyle(element).overflowX,
          };
        });
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        viewportWidth: document.documentElement.clientWidth,
        richContent,
      };
    });
    expect(layout.pageOverflow, `${route} must not create page-level horizontal overflow`).toBeLessThanOrEqual(1);
    for (const content of layout.richContent) {
      expect(content.left, `${route} rich content must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
      expect(content.right, `${route} rich content must stay inside the viewport`).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(content.overflowX, `${route} rich content must provide a bounded horizontal viewport`).toMatch(/auto|scroll/);
    }
  }
});

test('desktop uses only header contextual navigation and reading regions', async ({ page }, testInfo) => {
  if (!['desktop-1440', 'desktop-1280'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');

  const stableRegions = page.locator('[data-stable-region]');
  await expect(stableRegions).toHaveCount(3);
  expect(await stableRegions.evaluateAll((regions) => regions.map((region) => region.getAttribute('data-stable-region'))))
    .toEqual(['header', 'navigation', 'reading']);
  await expect(page.locator('#contents-rail')).toBeVisible();
  await expect(page.locator('#page-toc')).toBeHidden();
  await expect(page.getByRole('button', { name: 'In this guide', exact: true })).toBeVisible();
  expect(await page.locator('.handbook-shell').evaluate((shell) => getComputedStyle(shell).gridTemplateColumns.split(' ').length))
    .toBeLessThanOrEqual(2);
});

test('mobile starts with a compact brand search menu row and vertical modes', async ({ page }, testInfo) => {
  if (!['mobile-430', 'mobile-390', 'mobile-360', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');

  const firstRow = page.locator('.topbar-first-row');
  await expect(firstRow.getByText('mwell', { exact: true })).toBeVisible();
  await expect(firstRow.getByRole('searchbox')).toBeVisible();
  const menu = firstRow.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.locator('.tab-rail')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeHidden();

  const firstRowGeometry = await firstRow.locator(':scope > .brand, :scope > .search-wrap, :scope > [data-open-drawer="contents"]').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
  expect(Math.max(...firstRowGeometry.map(({ top }) => top)) - Math.min(...firstRowGeometry.map(({ top }) => top))).toBeLessThanOrEqual(2);
  expect(Math.max(...firstRowGeometry.map(({ bottom }) => bottom)) - Math.min(...firstRowGeometry.map(({ bottom }) => bottom))).toBeLessThanOrEqual(2);

  const activeTaskTop = await page.locator('article[data-guide-id="stock-receiving-putaway"] .article-header h1').evaluate((element) => element.getBoundingClientRect().top);
  expect(activeTaskTop, 'persistent chrome must leave the active task or first action within 180px').toBeLessThanOrEqual(180);

  await menu.click();
  const modes = page.locator('#contents-rail [role="tab"]');
  await expect(modes).toHaveCount(4);
  const modeGeometry = await modes.evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top };
  }));
  expect(new Set(modeGeometry.map(({ left }) => Math.round(left))).size, 'modes must use one-column navigation').toBe(1);
  expect(modeGeometry.every((button, index) => index === 0 || button.top > modeGeometry[index - 1].top)).toBe(true);
});

test('keeps contents and table of contents reachable through the 1180px boundary', async ({ page }, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') test.skip();

  for (const width of [1024, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#mode=tasks&guide=stock-receiving-putaway');
    const contents = page.getByRole('button', { name: 'Menu', exact: true });
    const toc = page.getByRole('button', { name: 'In this guide', exact: true });
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
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const controls = await Promise.all(['Close menu', 'Home', 'Tasks', 'Roles', 'System', 'Toggle color theme', 'Print', 'This mode', 'All guides'].map(async (name) => {
    const control = name === 'Home' || name === 'Tasks' || name === 'Roles' || name === 'System'
      ? page.getByRole('tab', { name, exact: true })
      : page.getByRole('button', { name, exact: true });
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

  await page.keyboard.press('Escape');
  await expectTouchSafeGroup([
    page.getByRole('link', { name: 'Steps', exact: true }),
    page.getByRole('button', { name: 'In this guide', exact: true }),
  ], 'guide jump');
  await expectTouchSafeGroup([
    page.getByRole('button', { name: 'Fit diagram to available space' }),
    page.getByRole('button', { name: 'Show diagram at 100 percent' }),
    page.getByRole('button', { name: 'Zoom diagram out' }),
    page.getByRole('button', { name: 'Zoom diagram in' }),
  ], 'diagram toolbar');

  await page.goto('/#mode=system&guide=source-references&heading=source-user-manual');
  const workflow = page.locator('[data-workflow-id="procurement-to-payment"]').first();
  await expectTouchSafeGroup([
    workflow.getByRole('button', { name: 'Overview', exact: true }),
    workflow.getByRole('button', { name: 'By role', exact: true }),
    workflow.getByRole('button', { name: 'Decisions', exact: true }),
  ], 'diagram perspective');
});

test('mobile task controls expose stable stage navigation without covering content', async ({ page }, testInfo) => {
  if (!['mobile-430', 'mobile-390', 'mobile-360', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway');

  const guideControls = page.locator('article[data-guide-id="stock-receiving-putaway"] .guide-jump-controls');
  const guideHeader = page.locator('article[data-guide-id="stock-receiving-putaway"] .article-header');
  const category = guideHeader.locator('.category');
  const title = guideHeader.locator('h1');
  await expect(title).toBeFocused();
  await expect(guideControls.getByRole('link', { name: 'Steps', exact: true })).toBeVisible();
  await expect(guideControls.getByRole('button', { name: 'In this guide', exact: true })).toBeVisible();
  const guideGeometry = await page.evaluate(() => {
    const header = document.querySelector('article[data-guide-id="stock-receiving-putaway"] .article-header') as HTMLElement;
    const badge = header.querySelector('.category') as HTMLElement;
    const heading = header.querySelector('h1') as HTMLElement;
    const jumps = header.parentElement?.querySelector('.guide-jump-controls') as HTMLElement;
    const stickyBottom = [...document.querySelectorAll('body *')].reduce((bottom, candidate) => {
      if ([header, badge, heading, jumps].some((element) => candidate === element || candidate.contains(element))) return bottom;
      const style = getComputedStyle(candidate);
      if (!['fixed', 'sticky'].includes(style.position) || style.visibility === 'hidden' || style.display === 'none') return bottom;
      const rect = candidate.getBoundingClientRect();
      const declaredTop = Number.parseFloat(style.top);
      return Number.isFinite(declaredTop) && rect.top <= declaredTop + 1 && rect.bottom > 0 ? Math.max(bottom, rect.bottom) : bottom;
    }, 0);
    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    };
    return { stickyBottom, header: rect(header), badge: rect(badge), heading: rect(heading), jumps: rect(jumps), viewportHeight: innerHeight };
  });
  expect(guideGeometry.badge.top).toBeGreaterThanOrEqual(guideGeometry.stickyBottom + 12);
  expect(guideGeometry.heading.top).toBeGreaterThanOrEqual(guideGeometry.badge.bottom);
  expect(guideGeometry.jumps.top).toBeGreaterThanOrEqual(guideGeometry.header.bottom - 1);
  expect(guideGeometry.jumps.bottom).toBeLessThanOrEqual(guideGeometry.viewportHeight);
  const firstStage = page.locator('article[data-guide-id="stock-receiving-putaway"] [data-task-stage]').first();
  const nextStage = firstStage.getByRole('link', { name: /^Next:/ });
  await expect(nextStage).toBeVisible();
  await nextStage.click();
  await expect(page).toHaveURL(/heading=step-2/);
  await expectFocusedBelowStickyChrome(page.locator('#stock-receiving-putaway-step-2 h3'));

  const overlap = await guideControls.evaluate((controls) => {
    const controlsRect = controls.getBoundingClientRect();
    const articleHeader = controls.parentElement?.querySelector('.article-header')?.getBoundingClientRect();
    return articleHeader ? Math.max(0, Math.min(controlsRect.right, articleHeader.right) - Math.max(controlsRect.left, articleHeader.left))
      * Math.max(0, Math.min(controlsRect.bottom, articleHeader.bottom) - Math.max(controlsRect.top, articleHeader.top)) : 0;
  });
  expect(overlap, 'sticky guide controls must not cover the article header').toBe(0);
});

test('mobile and desktop certified screenshot viewer traps focus and returns focus', async ({ page }, testInfo) => {
  if (!['desktop-1440', 'mobile-320'].includes(testInfo.project.name)) test.skip();
  await page.goto('/#mode=tasks&guide=stock-receiving-putaway&heading=steps');
  const guide = page.locator('article[data-guide-id="stock-receiving-putaway"]');
  const trigger = guide.locator('[data-screen-evidence="certified"] [data-open-screenshot-surface]').first();
  await expect(trigger).toBeVisible();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();

  const viewer = page.getByRole('dialog', { name: /screenshot viewer/i });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('img')).toHaveAttribute('src', /^data:image\//);
  await expect(viewer.getByRole('img')).not.toHaveAttribute('alt', '');
  const close = viewer.getByRole('button', { name: /close screenshot/i });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(trigger).toBeFocused();

  await expect(guide.locator('[data-screen-evidence="certified"]')).toHaveCount(4);
  await expect(guide.locator('[data-screen-evidence="pending"]')).toHaveCount(0);
  await expect(guide.locator('[data-screen-evidence="certified"] [data-open-screenshot-surface]')).toHaveCount(4);
});

test('completes the keyboard-only handbook journey without drawer or diagram traps', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  const compact = (page.viewportSize()?.width ?? 1440) <= 1180;
  if (compact) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('tab', { name: 'Tasks' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#mode-tasks')).toHaveAttribute('aria-selected', 'true');
  } else {
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
  }
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();

  const tasksTab = compact ? page.locator('#mode-tasks') : page.getByRole('tab', { name: 'Tasks' });
  if (!compact) {
    await tasksTab.focus();
    await page.keyboard.press('Enter');
  }
  if (compact) {
    const contentsTrigger = page.getByRole('button', { name: 'Menu', exact: true });
    await contentsTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
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

  if (compact) {
    for (const [triggerName, dialogName] of [['Menu', 'Menu'], ['In this guide', 'On this page']] as const) {
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
  const compact = (page.viewportSize()?.width ?? 1440) <= 1180;
  const activeArticle = page.locator('article[data-document]:not([hidden])');
  const closedDetails = activeArticle.locator('details:not([open])').first();
  const wasClosed = await closedDetails.count().then(Boolean);
  const articles = page.locator('article[data-document]');
  const articleCount = await articles.count();
  const taskGuideCount = await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.mode === 'tasks').length);
  const printButton = page.locator('[data-print-trigger]');
  const revealPrintButton = async () => {
    if (compact && !await printButton.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(printButton).toBeVisible();
  };
  await revealPrintButton();
  await printButton.focus();
  await page.keyboard.press('ArrowDown');
  await expect(printButton).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(page.getByRole('dialog', { name: 'Print options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Current guide' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(printButton).toBeFocused();

  for (const [buttonName, scope, expectedCount] of [
    ['Current guide', 'guide', 1],
    ['Current mode', 'mode', taskGuideCount],
    ['Complete handbook', 'all', articleCount],
  ] as const) {
    await revealPrintButton();
    await printButton.focus();
    await page.keyboard.press('ArrowDown');
    const option = page.getByRole('button', { name: buttonName, exact: true });
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-print-scope', scope);
    expect(await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.printInScope === 'true').length)).toBe(expectedCount);
    if (scope === 'guide') await expect(activeArticle).toHaveAttribute('data-print-in-scope', 'true');
    if (scope === 'mode') expect(await articles.evaluateAll((elements) => elements.filter((article) => article.dataset.printInScope === 'true').every((article) => article.dataset.mode === 'tasks'))).toBe(true);
    if (scope === 'all') expect(await articles.evaluateAll((elements) => elements.every((article) => article.dataset.printInScope === 'true'))).toBe(true);
    if (wasClosed) await expect(closedDetails).not.toHaveAttribute('open', '');
  }

  await page.emulateMedia({ media: 'screen' });
  await revealPrintButton();
  await printButton.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Current guide', exact: true }).focus();
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
  test.setTimeout(90_000);
  if (process.env.HANDBOOK_CAPTURE !== '1' || !['desktop-1440', 'tablet-768', 'mobile-430', 'mobile-320'].includes(testInfo.project.name)) test.skip();

  const captureDir = fileURLToPath(new URL('../../../../outputs/handbook-visual-review/', import.meta.url));
  await mkdir(captureDir, { recursive: true });
  await page.goto('/#mode=tasks&guide=procurement-request-approval');
  await expect(page.getByRole('region', { name: 'Task flow diagram' })).toBeVisible();
  const projectViewport = page.viewportSize()!;
  const shell = page.locator('article[data-guide-id="procurement-request-approval"] .diagram-shell').first();
  const fitControl = shell.getByRole('button', { name: 'Fit diagram to available space' });
  const compact = (page.viewportSize()?.width ?? 1440) <= 1180;
  const toggleTheme = async () => {
    if (compact) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle color theme' }).click();
    if (compact) await page.keyboard.press('Escape');
  };
  const settleLayout = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const expandToFullPageViewport = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fullHeight = await page.evaluate(() => Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)));
      if (page.viewportSize()?.height === fullHeight) break;
      await page.setViewportSize({ width: projectViewport.width, height: fullHeight });
      await settleLayout();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const diagramCaptureMetrics = () => shell.evaluate((element) => {
    const viewport = element.querySelector('[data-diagram-viewport]') as HTMLElement;
    const diagram = element.querySelector('.mermaid') as HTMLElement;
    const svg = diagram.querySelector('svg') as SVGSVGElement;
    const viewportRect = viewport.getBoundingClientRect();
    const diagramRect = diagram.getBoundingClientRect();
    const intersectionArea = (first: DOMRect, second: DOMRect) => Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
      * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    const visibleRects = (selector: string) => [...svg.querySelectorAll(selector)].map((candidate) => candidate.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0 && intersectionArea(rect, viewportRect) > 1);
    const labelHeights = visibleRects('.nodeLabel, .edgeLabel').map((rect) => rect.height).sort((first, second) => first - second);
    const background = getComputedStyle(viewport).backgroundColor;
    const luminance = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (first: string, second: string) => {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
    };
    const edge = svg.querySelector('.flowchart-link, .edgePath path') as SVGElement | null;
    const nodeShape = svg.querySelector('.node rect, .node polygon, .node path') as SVGElement | null;
    const nodeLabel = svg.querySelector('.nodeLabel') as HTMLElement | null;
    const edgeColor = edge ? getComputedStyle(edge).stroke : '';
    const nodeColor = nodeShape ? getComputedStyle(nodeShape).fill : '';
    const nodeLabelColor = nodeLabel ? getComputedStyle(nodeLabel).color : '';
    return {
      viewport: { left: viewportRect.left, top: viewportRect.top, right: viewportRect.right, bottom: viewportRect.bottom, area: viewportRect.width * viewportRect.height },
      diagram: { left: diagramRect.left, top: diagramRect.top, right: diagramRect.right, bottom: diagramRect.bottom },
      renderedScale: Number(element.getAttribute('data-diagram-rendered-scale')),
      scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
      visibleLabels: labelHeights.length,
      medianLabelHeight: labelHeights[Math.floor(labelHeights.length / 2)] ?? 0,
      visibleNodes: visibleRects('.node').length,
      visibleEdges: visibleRects('.flowchart-link, .edgePath path').length,
      svgOccupancy: intersectionArea(svg.getBoundingClientRect(), viewportRect) / (viewportRect.width * viewportRect.height),
      canvasLuminance: luminance(background),
      edgeContrast: contrast(edgeColor, background),
      nodeSurfaceContrast: contrast(nodeColor, background),
      nodeLabelContrast: contrast(nodeLabelColor, nodeColor),
    };
  });
  const refitAndAssertDiagram = async (theme: 'light' | 'dark') => {
    await fitControl.click();
    await settleLayout();
    await expect.poll(diagramCaptureMetrics).toMatchObject({ scroll: { left: 0, top: 0 } });
    const metrics = await diagramCaptureMetrics();
    expect(metrics.diagram.left).toBeGreaterThanOrEqual(metrics.viewport.left - 1);
    expect(metrics.diagram.top).toBeGreaterThanOrEqual(metrics.viewport.top - 1);
    expect(metrics.diagram.right).toBeLessThanOrEqual(metrics.viewport.right + 1);
    expect(metrics.diagram.bottom).toBeLessThanOrEqual(metrics.viewport.bottom + 1);
    const isNarrowMobile = projectViewport.width <= 360;
    const minimumReadableScale = isNarrowMobile ? 0.34 : projectViewport.width <= 430 ? 0.49 : 0.5;
    expect(metrics.renderedScale, JSON.stringify(metrics)).toBeGreaterThanOrEqual(minimumReadableScale);
    expect(metrics.visibleLabels).toBeGreaterThanOrEqual(8);
    expect(metrics.medianLabelHeight).toBeGreaterThanOrEqual(isNarrowMobile ? 8 : 11);
    expect(metrics.visibleNodes).toBeGreaterThanOrEqual(8);
    expect(metrics.visibleEdges).toBeGreaterThanOrEqual(6);
    expect(metrics.svgOccupancy).toBeGreaterThanOrEqual(0.08);
    if (theme === 'dark') {
      expect(metrics.canvasLuminance).toBeLessThanOrEqual(0.12);
      expect(metrics.edgeContrast).toBeGreaterThanOrEqual(3);
      expect(metrics.nodeSurfaceContrast).toBeGreaterThanOrEqual(3);
      expect(metrics.nodeLabelContrast).toBeGreaterThanOrEqual(4.5);
    }
  };
  const captureScreenTheme = async (theme: 'light' | 'dark') => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expandToFullPageViewport();
      await refitAndAssertDiagram(theme);
      const fullHeight = await page.evaluate(() => Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)));
      if ((page.viewportSize()?.height ?? 0) >= fullHeight) break;
    }
    await page.screenshot({ path: `${captureDir}${testInfo.project.name}-${theme}.png`, fullPage: true });
    await refitAndAssertDiagram(theme);
  };

  await captureScreenTheme('light');
  await toggleTheme();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await captureScreenTheme('dark');
  await page.setViewportSize(projectViewport);
  await settleLayout();
  await toggleTheme();
  await page.evaluate(() => {
    document.documentElement.dataset.printScope = 'guide';
    window.scrollTo(0, 0);
  });
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${captureDir}${testInfo.project.name}-print.png`, fullPage: true });
});
