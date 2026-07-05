import { defineConfig } from 'vitest/config';

// Pure-logic tests (policy tailoring, checklist seeding + migration, inbox
// bucket derivation) plus localStorage-backed persistence tests that install
// a tiny window/localStorage shim. No React or real DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
