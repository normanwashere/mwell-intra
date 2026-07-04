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
  },
});
