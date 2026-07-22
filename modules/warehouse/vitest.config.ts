import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// jsdom + Testing Library for the ported page/component tests. The `@` alias
// mirrors the tsconfig `paths` so ported source files resolve `@/...` imports.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // User-event-heavy page tests contend for one jsdom process when the
    // monorepo runs in parallel. Keep the release gate bounded and repeatable.
    maxWorkers: 4,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
