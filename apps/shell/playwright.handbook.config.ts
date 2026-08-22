import { defineConfig, devices } from '@playwright/test';

const widths = [
  ['desktop-1440', 1440, 900], ['desktop-1280', 1280, 800],
  ['desktop-1024', 1024, 768], ['tablet-768', 768, 1024],
  ['mobile-430', 430, 932], ['mobile-390', 390, 844],
  ['mobile-360', 360, 800], ['mobile-320', 320, 720],
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'standalone-handbook.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3018',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  },
  projects: widths.map(([name, width, height]) => ({
    name,
    use: { ...devices['Desktop Chrome'], viewport: { width, height } },
  })),
  webServer: {
    command: 'node ../../scripts/docs/serve-handbook.mjs --port 3018',
    url: 'http://127.0.0.1:3018/',
    reuseExistingServer: false,
  },
});
