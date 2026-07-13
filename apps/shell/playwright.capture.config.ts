import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

const liveCapture = process.env.EVIDENCE_AUTH_MODE === 'live';
const liveBaseUrl = process.env.AUDIT_BASE_URL;

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e',
  testMatch: 'capture-knowledge-evidence.spec.ts',
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  webServer: liveCapture ? undefined : baseConfig.webServer,
  use: {
    ...baseConfig.use,
    baseURL: liveCapture ? liveBaseUrl : baseConfig.use?.baseURL,
  },
  projects: [
    {
      name: 'evidence-capture',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
