import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const base = process.env.ERROR_COPY_BASE_URL ?? 'http://localhost:3022';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'This mocked-error check is local only.');
const output = path.resolve('outputs/plain-language-errors-local');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, width, height, theme] of [
    ['desktop-light', 1440, 900, 'light'],
    ['desktop-dark', 1280, 800, 'dark'],
    ['mobile-light', 390, 844, 'light'],
    ['mobile-dark', 320, 720, 'dark'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('intra-theme', value), theme);
    let message = 'Invalid login credentials';
    let intercepted = 0;
    // No credentials or requests reach Supabase. Exercise the real login UI
    // and auth error path with controlled responses, not an injected DOM.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/auth/v1/token')) {
        intercepted++;
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', msg: message }) });
      } else if (url.hostname.endsWith('.supabase.co')) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await page.getByLabel('Email', { exact: true }).fill('error-preview@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('local-preview-only');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const alert = page.locator('form').getByRole('alert');
    await alert.waitFor();
    await alert.filter({ hasText: 'The email or password is incorrect.' }).waitFor();
    assert.equal(intercepted, 1);
    assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
    await page.screenshot({ path: path.join(output, `${name}-login.png`), fullPage: true });
    message = 'NetworkError when attempting to fetch resource';
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await alert.filter({ hasText: 'We could not confirm your sign-in.' }).waitFor();
    const layout = await alert.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, width: box.width, client: element.clientWidth, scroll: element.scrollWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(layout.x >= 0 && layout.right <= width, `${name}: error outside viewport`);
    assert(layout.scroll <= layout.client + 1 && !layout.pageOverflow, `${name}: text overflow`);
    assert.deepEqual(errors, [], `${name}: browser runtime errors`);
    await page.screenshot({ path: path.join(output, `${name}-connection.png`), fullPage: true });
    results.push({ name, layout, intercepted, runtimeErrors: errors, environment: 'local app with mocked auth failures; not live UAT evidence' });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, results }, null, 2));
