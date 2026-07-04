import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// Next 16 removed `next lint`; the ESLint CLI is the supported path and
// `eslint-config-next` still ships as a legacy config, so we bridge it with
// FlatCompat (the shape the official next-lint-to-eslint-cli codemod emits).
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      // Playwright smoke suite is linted/typechecked by Playwright itself and
      // depends on @playwright/test being installed. Keep it out of the Next
      // ESLint + tsc passes so those stay green even without the E2E deps.
      'tests/**',
      'playwright.config.ts',
    ],
  },
];

export default eslintConfig;
