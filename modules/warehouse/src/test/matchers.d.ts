import 'vitest';
import type { axe } from 'jest-axe';

type AxeResults = Awaited<ReturnType<typeof axe>>;

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Assertion<T = unknown> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}

export type { AxeResults };
