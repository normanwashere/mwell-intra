import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@shell': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    clearMocks: true,
  },
});
