import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3016);

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/*-live.spec.ts', '**/capture-knowledge-evidence.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'block',
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
    reducedMotion: 'reduce',
    colorScheme: 'light',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
  webServer: [
    {
      command: 'node ../../scripts/controlled-supabase-auth-server.mjs',
      port: 54321,
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
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'controlled-rpc-anon-key',
        NEXT_PUBLIC_ENABLE_SW: 'false',
        MWELL_CONTROLLED_RPC_TEST: '1',
      },
    },
  ],
});
