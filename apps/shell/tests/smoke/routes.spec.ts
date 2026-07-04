// Route smoke test (spec §1, dead-end prevention polish).
//
// Iterates over the shell's canonical routes and asserts each responds with a
// status < 500 (so 404 for /nonexistent-route is EXPECTED and PASSES) and
// paints at least one visible non-empty element. Guards against regressions
// where a dynamic import fails silently or a boundary blanks the page.

import { expect, test } from '@playwright/test';

interface RouteCase {
  readonly path: string;
  /** Human-readable label surfaced in the test title. */
  readonly label: string;
  /** Optional maximum acceptable HTTP status (default 499). */
  readonly maxStatus?: number;
}

const ROUTES: readonly RouteCase[] = [
  { path: '/', label: 'dashboard' },
  { path: '/login', label: 'sign-in' },
  { path: '/reset-password', label: 'reset-password' },
  { path: '/warehouse', label: 'warehouse module' },
  { path: '/procurement', label: 'procurement module' },
  { path: '/legal', label: 'legal module' },
  { path: '/vendor', label: 'vendor portal' },
  // Global 404 target — Next serves the app/not-found.tsx page. We accept 404
  // (< 500) and require the page to render the recovery UI, not a blank body.
  { path: '/nonexistent-route', label: 'not-found page' },
];

for (const { path, label, maxStatus = 499 } of ROUTES) {
  test(`GET ${path} (${label}) responds < 500 and renders content`, async ({
    page,
  }) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response, `no response received for ${path}`).not.toBeNull();
    const status = response!.status();
    expect(
      status,
      `expected ${path} to respond < ${maxStatus + 1}, got ${status}`,
    ).toBeLessThan(maxStatus + 1);

    // The page must render *something* — the visible <body> text should be
    // non-empty after DOMContentLoaded. This catches "white screen of death"
    // regressions where a boundary/import failure produces a blank tree.
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(
      bodyText.length,
      `expected ${path} to render non-empty body, got empty`,
    ).toBeGreaterThan(0);
  });
}
