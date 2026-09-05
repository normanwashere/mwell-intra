import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, ModuleHero } from "./primitives";
import { readFileSync } from "node:fs";

describe("Card DOM contract", () => {
  it("forwards valid div attributes used by browser tests and accessibility", () => {
    const markup = renderToStaticMarkup(
      <Card data-testid="governed-card" aria-label="Governed record">
        Content
      </Card>,
    );
    expect(markup).toContain('data-testid="governed-card"');
    expect(markup).toContain('aria-label="Governed record"');
  });
});

describe("ModuleHero responsive hierarchy", () => {
  it("uses a compact contextual icon and a two-zone operational hierarchy", () => {
    const markup = renderToStaticMarkup(
      <ModuleHero
        eyebrow="Warehouse dashboard"
        title="A long operational title that must remain readable"
        description="Status and next action remain visible on mobile."
        icon="grid"
      />,
    );

    expect(markup).toContain('data-module-hero-watermark="true"');
    expect(markup).toContain('data-module-hero-content="true"');
    expect(markup).toContain("workspace-hero");
    expect(markup).toContain("h-6 w-6");
    expect(markup).toContain("relative z-10");
    expect(markup).not.toContain("h-36 w-36");
  });
  it("moves the icon into flow when the hero container cannot accommodate the reserved column", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toContain("container-name: module-hero");
    expect(css).toContain("@container module-hero (max-width: 12rem)");
    expect(css).toMatch(/\[data-module-hero-watermark\]\s*\{\s*position: static;/);
    expect(css).toMatch(/\[data-module-hero-content\]\s*\{\s*padding-inline-end: 0;/);
  });
});
