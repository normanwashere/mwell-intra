import { expect, test } from '@playwright/test';
import {
  CANONICAL_WORKSPACE_ROUTES,
  installWarehouseSession,
  type WarehouseRole,
} from '../helpers/warehouseFixtures';

const routes: readonly { role: WarehouseRole; route: string }[] = [
  { role: 'warehouse_admin', route: '/warehouse' },
  { role: 'warehouse_admin', route: '/warehouse/inventory' },
  { role: 'warehouse_admin', route: '/warehouse/receiving' },
  ...CANONICAL_WORKSPACE_ROUTES,
];
const samplesPerRoute = 20;

test('warehouse routes remain within transfer and p95 content budgets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Performance gate runs once on the canonical desktop viewport.');
  test.setTimeout(120_000);
  const results: Array<{ route: string; p95Ms: number; maxBytes: number }> = [];
  let transferredBytes = 0;
  page.on('response', (response) => {
    const length = Number(response.headers()['content-length'] ?? 0);
    transferredBytes += Number.isFinite(length) ? length : 0;
  });
  for (const { role, route } of routes) {
    await installWarehouseSession(page, role);
    const timings: number[] = [];
    transferredBytes = 0;
    for (let run = 0; run < samplesPerRoute; run += 1) {
      const started = Date.now();
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.locator('main h1').first().waitFor({ state: 'visible' });
      timings.push(Date.now() - started);
    }
    await expect(page.locator('body')).not.toContainText(/no (?:warehouse|events|insights) access|access denied/i);
    timings.sort((a, b) => a - b);
    const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1]!;
    results.push({ route, p95Ms, maxBytes: transferredBytes });
    expect(p95Ms, `${route} p95 meaningful content`).toBeLessThan(3_000);
    expect(transferredBytes, `${route} transferred bytes across ${samplesPerRoute} runs`).toBeLessThan(10_000_000);
  }
  await testInfo.attach('warehouse-performance.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  console.info(`WAREHOUSE_W1_PERFORMANCE ${JSON.stringify(results)}`);
});
