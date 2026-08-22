import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3016);
const AUTH_PORT = Number(process.env.CONTROLLED_SUPABASE_PORT ?? 54321);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'task-9-po-lifecycle.spec.ts',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { outputFolder: 'test-results/task-9-html', open: 'never' }], ['junit', { outputFile: 'test-results/task-9-junit.xml' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'block',
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
  webServer: [
    {
      command: 'node ../../scripts/controlled-supabase-auth-server.mjs',
      port: AUTH_PORT,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      port: PORT,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_ALLOW_DEMO_IN_PROD: 'true',
        NEXT_PUBLIC_DATA_SOURCE: 'controlled_rpc',
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'controlled-rpc-anon-key',
        NEXT_PUBLIC_ENABLE_SW: 'false',
        MWELL_CONTROLLED_RPC_TEST: '1',
      },
    },
  ],
});
