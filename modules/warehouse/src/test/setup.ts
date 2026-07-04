import '@testing-library/jest-dom/vitest';
import { afterEach, expect, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

// jest-axe matcher (toHaveNoViolations)
expect.extend(toHaveNoViolations);

// Routes are code-split (React.lazy), so a `findBy*` may need to resolve a
// dynamic chunk before the element appears. Under heavy parallel test load that
// can exceed the 1000ms default; raise it so lazy-route tests aren't flaky.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* no-op */
  }
});

// jsdom does not implement matchMedia — provide a no-op so responsive hooks work.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom lacks scrollTo
window.scrollTo = vi.fn();
