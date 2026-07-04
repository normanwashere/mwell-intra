import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The data layer is DOM-free (the outbox feature-detects IndexedDB and falls
    // back to an in-memory queue), so the Node environment is sufficient.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
