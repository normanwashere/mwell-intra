import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, Field, ModuleHero, PageHeader, HeroStat, SectionTitle } from "./primitives";
import { readFileSync } from "node:fs";

describe("Card DOM contract", () => {
  it("renders plain-language field errors without losing the accessible label", () => {
    const markup = renderToStaticMarkup(<Field label="PO" htmlFor="po" error="column doa_assignments.created_at does not exist"><input id="po" /></Field>);
    expect(markup).toContain('for="po"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('support team');
    expect(markup).not.toContain('doa_assignments');
  });
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
  it("uses the shared in-flow title and action hierarchy without a floating hero card", () => {
    const markup = renderToStaticMarkup(
      <ModuleHero
        eyebrow="Warehouse dashboard"
        title="A long operational title that must remain readable"
        description="Status and next action remain visible on mobile."
        icon="grid"
      />,
    );

    expect(markup).toContain('data-workspace-header="true"');
    expect(markup).toContain('data-workspace-icon="true"');
    expect(markup).not.toContain('watermark');
    expect(markup).not.toContain('hero-surface');
    expect(markup).not.toContain('absolute');
  });
  it("uses container size, not viewport size, for action reflow", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toContain('container-name: workspace-header');
    expect(css).toContain('@container workspace-header (min-width: 48rem)');
    expect(css).toContain('overflow-wrap: anywhere');
  });
  it('keeps names, status, action destinations and metrics for both header APIs', () => {
    for (const component of [
      <PageHeader title="Purchase orders" status={<span>Issued</span>} action={<a href="/create">Create order</a>} />,
      <ModuleHero title="Purchase orders" action={<a href="/create">Create order</a>} accessory={<HeroStat label="Status">Issued</HeroStat>} />,
    ]) {
      const html = renderToStaticMarkup(component);
      expect(html).toContain('Purchase orders');
      expect(html).toContain('Issued');
      expect(html).toContain('href="/create"');
      expect(html).toContain('data-workspace-header="true"');
      expect((html.match(/<h1/g) ?? []).length).toBe(1);
    }
  });
  it('keeps section anchors and actions beside a distinct section heading', () => {
    const html = renderToStaticMarkup(<SectionTitle id="receiving" title="Receiving" action={<button>Review</button>} />);
    expect(html).toContain('id="receiving"');
    expect(html).toContain('section-heading-band');
    expect(html).toContain('Review');
  });
});
