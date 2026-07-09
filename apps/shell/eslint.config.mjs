import base from '@intra/config/eslint/base';

export default [
  ...base,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'tests/**',
      'playwright.config.ts',
    ],
  },
  {
    languageOptions: {
      globals: {
        caches: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        CustomEvent: 'readonly',
        document: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        KeyboardEvent: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        Notification: 'readonly',
        process: 'readonly',
        requestAnimationFrame: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
  },
];
