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
        // mWell brand palette (mwell.com.ph) — deep corporate blue #004F9D
        // anchoring a sky→cyan gradient.
        brand: {
          50: "#eaf5fe",
          100: "#cde8fc",
          200: "#9fd3f7",
          300: "#5fbef2",
          400: "#33c6f4",
          500: "#1580c1",
          600: "#0a62b4",
          700: "#004f9d",
          800: "#003a73",
          900: "#002a54",
        },
        // Bright cyan secondary — highlights / analytics accents.
        accent: {
          DEFAULT: "#33c6f4",
          soft: "#8adcf9",
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
        // Apps load these via next/font and expose CSS variables; the raw
        // family names keep tests / non-Next consumers rendering sanely.
        display: [
          "var(--font-poppins)",
          "Poppins",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "var(--font-poppins)",
          "Poppins",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-jbmono)",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      // Formal type-scale tokens (display → caption). Line-height + tracking
      // travel with the size so pages stop hand-rolling combinations.
      fontSize: {
        "display": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "800" }],
        "title": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "800" }],
        "heading": ["1.125rem", { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "700" }],
        "body": ["0.875rem", { lineHeight: "1.5" }],
        "caption": ["0.75rem", { lineHeight: "1.4" }],
        "overline": ["0.68rem", { lineHeight: "1.3", letterSpacing: "0.08em", fontWeight: "600" }],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,46,51,0.05), 0 6px 20px rgba(11,46,51,0.06)",
        soft: "0 1px 2px rgba(11,46,51,0.04), 0 2px 8px rgba(11,46,51,0.05)",
        pop: "0 10px 40px rgba(11,46,51,0.16)",
        glow: "0 8px 30px rgba(53,202,191,0.35)",
        navy: "0 12px 30px rgba(11,46,51,0.30)",
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
          "linear-gradient(115deg, #004f9d 0%, #1580c1 60%, #33c6f4 100%)",
        "brand-grad-soft":
          "linear-gradient(115deg, #0a62b4 0%, #1580c1 55%, #33c6f4 100%)",
        "accent-grad": "linear-gradient(120deg, #1580c1 0%, #33c6f4 100%)",
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
