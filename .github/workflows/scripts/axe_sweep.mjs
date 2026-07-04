#!/usr/bin/env node
// Accessibility sweep for CI (see .github/workflows/ci.yml).
//
// Launches Playwright + @axe-core/playwright against the built shell running
// on the URL passed as argv[2] (defaults to http://127.0.0.1:3000). Visits a
// small set of public / demo-mode-safe routes so a11y regressions are caught
// even when Supabase env is absent. Fails the CI job on any `serious` or
// `critical` violation.
//
// The dependencies (@playwright/test + @axe-core/playwright) are installed
// ephemerally in the same CI job — do NOT `import` them at the top-level so
// this file can be linted locally without the extras present.

const BASE_URL = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

// Only include routes the shell serves without a live Supabase session — the
// build runs in memory-fallback mode in CI. Anything under a module catch-all
// depends on module-side rendering which is out of scope for the shell sweep.
const ROUTES = ['/', '/login', '/reset-password'];

async function main() {
  // @playwright/test re-exports the core `chromium` browser type used below,
  // and @axe-core/playwright's default export is the AxeBuilder class.
  const { chromium } = await import('@playwright/test');
  const { default: AxeBuilder } = await import('@axe-core/playwright');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    // Simulate the smallest supported touch target so we exercise the
    // responsive layout most likely to fail contrast/target-size checks.
    viewport: { width: 390, height: 844 },
  });

  /** @type {{route: string, id: string, impact: string, help: string, nodes: number}[]} */
  const failures = [];

  for (const route of ROUTES) {
    const page = await context.newPage();
    const url = `${BASE_URL}${route}`;
    console.log(`▶ ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      console.error(`  ✖ navigation failed: ${err.message}`);
      failures.push({
        route,
        id: 'navigation',
        impact: 'critical',
        help: err.message,
        nodes: 0,
      });
      await page.close();
      continue;
    }

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    for (const v of results.violations) {
      const line = `  [${v.impact ?? 'unknown'}] ${v.id} (${v.nodes.length}) — ${v.help}`;
      if (v.impact === 'serious' || v.impact === 'critical') {
        console.error(`  ✖ ${line}`);
        failures.push({
          route,
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
        });
      } else {
        console.warn(`  ⚠ ${line}`);
      }
    }
    await page.close();
  }

  await context.close();
  await browser.close();

  if (failures.length > 0) {
    console.error(
      `\n::error::axe sweep found ${failures.length} serious/critical violation(s).`,
    );
    for (const f of failures) {
      console.error(
        `  ${f.route} → ${f.id} [${f.impact}] × ${f.nodes} : ${f.help}`,
      );
    }
    process.exit(1);
  }

  console.log('\naxe sweep passed — no serious/critical violations.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
