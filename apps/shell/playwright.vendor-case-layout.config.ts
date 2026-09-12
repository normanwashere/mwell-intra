import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import controlled from './playwright.controlled-rpc.config';

export default defineConfig({
  ...controlled,
  testMatch: 'vendor-case-layout.spec.ts',
  reporter: 'list',
  outputDir: join(tmpdir(), 'mwell-vendor-case-layout'),
  projects: [
    { name: 'mobile-320', use: { ...controlled.projects![1]!.use, viewport: { width: 320, height: 740 } } },
    ...controlled.projects!,
  ],
});
