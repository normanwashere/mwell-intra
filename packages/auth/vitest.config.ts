import { defineConfig } from 'vitest/config';

// jsdom is required for the React component tests (<Guard>, useCan).
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
