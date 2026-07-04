/**
 * Shared Tailwind preset for the Mwell Intra suite.
 * Semantic tokens map to CSS variables (see LLD §13); dark mode flips the
 * variables via the `.dark` class. @intra/ui provides the variable definitions.
 * Step 1a (@intra/ui) fleshes out the full token set + primitives.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: "var(--surface)",
        inset: "var(--inset)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        line: "var(--line)",
        brand: {
          DEFAULT: "var(--brand)",
          fg: "var(--brand-fg)",
          muted: "var(--brand-muted)"
        }
      }
    }
  },
  plugins: []
};
