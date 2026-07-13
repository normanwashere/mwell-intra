import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e',
  testMatch: 'capture-knowledge-evidence.spec.ts',
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
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
