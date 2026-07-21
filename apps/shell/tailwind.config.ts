import type { Config } from "tailwindcss";
import { createRequire } from "node:module";

// The @intra/config `exports` map exposes the preset as `./tailwind/preset`
// (the deep `.cjs` path is blocked by the map). `require` keeps this `any`-typed
// so tsc doesn't demand a declaration file, and Tailwind's jiti loader resolves
// it fine at config-load time.
const requireFromConfig = createRequire(import.meta.url);
const preset = requireFromConfig("@intra/config/tailwind/preset") as Config;

const config: Config = {
  presets: [preset],
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    // The consumed design-system package ships raw TSX we must scan for classes.
    "../../packages/ui/src/**/*.{ts,tsx}",
    "../../modules/warehouse/src/**/*.{ts,tsx}",
    "../../modules/procurement/src/**/*.{ts,tsx}",
    "../../modules/legal/src/**/*.{ts,tsx}",
    "../../modules/finance/src/**/*.{ts,tsx}",
  ],
  // Font stacks come from the shared preset (var(--font-inter) /
  // var(--font-grotesk) / var(--font-jbmono)) — layout.tsx loads them via
  // next/font and exposes the CSS variables on <html>.
};

export default config;
