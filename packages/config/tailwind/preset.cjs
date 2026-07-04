/**
 * Shared Tailwind preset for the Mwell Intra suite.
 *
 * Ported from mwell-intra-warehouse/tailwind.config.js so @intra/ui's primitives
 * render with full parity. Semantic, theme-aware colors resolve to RGB-channel
 * CSS variables (`--c-*`) defined by `@intra/ui/styles.css` for `:root` + `.dark`
 * (LLD §13). The fixed brand/accent palette is the mWell navy→cyan identity.
 *
 * Apps/modules consume this via `presets: [require('@intra/config/tailwind/preset')]`
 * and MUST import `@intra/ui/styles.css` once at the root for the variables.
 */
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // mWell brand palette — deep navy "M" wave to bright cyan "well"
        brand: {
          50: "#e9f6ff",
          100: "#cfecff",
          200: "#9fd8ff",
          300: "#63c0ff",
          400: "#2ea6f7",
          500: "#1490e6",
          600: "#0B4DA2",
          700: "#0a3f86",
          800: "#0a3168",
          900: "#04243f",
        },
        accent: {
          DEFAULT: "#22c1f0",
          soft: "#5fd2f5",
        },
        // Semantic, theme-aware tokens (light + dark via CSS variables)
        app: rgb("--c-app"),
        surface: rgb("--c-surface"),
        inset: rgb("--c-inset"),
        line: rgb("--c-line"),
        ink: rgb("--c-ink"),
        muted: rgb("--c-muted"),
        faint: rgb("--c-faint"),
      },
      fontFamily: {
        display: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(4,36,63,0.05), 0 6px 20px rgba(4,36,63,0.06)",
        soft: "0 1px 2px rgba(4,36,63,0.04), 0 2px 8px rgba(4,36,63,0.05)",
        pop: "0 10px 40px rgba(4,36,63,0.16)",
        glow: "0 8px 30px rgba(34,193,240,0.35)",
        navy: "0 12px 30px rgba(4,36,63,0.30)",
        e1: "var(--shadow-e1)",
        e2: "var(--shadow-e2)",
        e3: "var(--shadow-e3)",
      },
      borderRadius: {
        xl2: "1.25rem",
        "3xl": "1.75rem",
      },
      backgroundImage: {
        "brand-grad":
          "linear-gradient(115deg, #04243f 0%, #0b4da2 55%, #1490e6 100%)",
        "brand-grad-soft":
          "linear-gradient(115deg, #0a3168 0%, #0b4da2 60%, #22c1f0 100%)",
        "accent-grad": "linear-gradient(120deg, #1490e6 0%, #22c1f0 100%)",
        sheen:
          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0))",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "overlay-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "overlay-in": "overlay-in 0.2s ease-out",
        "sheet-up": "sheet-up 0.28s cubic-bezier(0.32,0.72,0,1)",
        "slide-in-right": "slide-in-right 0.28s cubic-bezier(0.32,0.72,0,1)",
        "scale-in": "scale-in 0.2s ease-out",
        "toast-in": "toast-in 0.22s ease-out",
        "pop-in": "pop-in 0.3s ease-out both",
      },
    },
  },
  plugins: [],
};
