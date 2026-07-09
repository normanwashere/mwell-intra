// Playwright config for shell smoke tests (spec §1, dead-end prevention polish).
//
// The smoke suite verifies that every top-level route we expose renders
// SOMETHING with a status < 500 — a fast, low-flake guarantee that dynamic
// imports and route boundaries don't silently 5xx after a refactor. It runs
// against `next start` on :3000. The web server command builds first so the
// smoke command is self-contained locally and in CI.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = Boolean(process.env.CI);
const REUSE_EXISTING_SERVER = process.env.PLAYWRIGHT_REUSE_SERVER === '1';

if (!REUSE_EXISTING_SERVER) {
  process.env.NEXT_PUBLIC_DATA_SOURCE ??= 'memory';
  process.env.MWELL_E2E_AUTH_MODE ??= 'memory';
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: IS_CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    port: PORT,
    reuseExistingServer: REUSE_EXISTING_SERVER,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NEXT_PUBLIC_ALLOW_DEMO_IN_PROD: 'true',
      NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'memory',
      MWELL_E2E_AUTH_MODE: process.env.MWELL_E2E_AUTH_MODE ?? 'memory',
    },
  },
});
