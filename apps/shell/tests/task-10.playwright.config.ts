import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  webServer: undefined,
  use: { ...base.use, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100' },
});
