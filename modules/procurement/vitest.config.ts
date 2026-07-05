import { defineConfig } from 'vitest/config';

// Pure-logic tests only (policy derivation, approval-step advancement). No
// React or DOM needed — Node environment keeps the run fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
