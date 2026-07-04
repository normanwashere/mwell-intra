import type { Config } from 'tailwindcss';

// The @intra/config `exports` map exposes the preset as `./tailwind/preset`
// (the deep `.cjs` path is blocked by the map). `require` keeps this `any`-typed
// so tsc doesn't demand a declaration file, and Tailwind's jiti loader resolves
// it fine at config-load time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const preset = require('@intra/config/tailwind/preset') as Config;

const config: Config = {
  presets: [preset],
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    // The consumed design-system package ships raw TSX we must scan for classes.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // next/font exposes the families as CSS variables; point the preset's
      // display/sans stacks at them so `font-display`/`font-sans` resolve.
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: [
          'var(--font-jakarta)',
          'Plus Jakarta Sans',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
};

export default config;
