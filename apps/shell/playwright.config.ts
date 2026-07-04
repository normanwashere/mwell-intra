// Playwright config for shell smoke tests (spec §1, dead-end prevention polish).
//
// The smoke suite verifies that every top-level route we expose renders
// SOMETHING with a status < 500 — a fast, low-flake guarantee that dynamic
// imports and route boundaries don't silently 5xx after a refactor. It runs
// against `next start` on :3000, so a production build (`pnpm build`) must
// have been produced first. In CI, wire it after the build step; locally,
// `pnpm --filter @intra/shell run test:smoke` will auto-boot the server.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: IS_CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Smoke suite only cares about server responses + first paint markup, so
    // JS errors on the client should not be treated as fatal by default.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm start',
    port: PORT,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
