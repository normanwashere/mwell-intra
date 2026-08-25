import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MwellIntraLogo } from "./MwellIntraLogo";

describe("MwellIntraLogo", () => {
  it("renders the approved mWell wordmark with the Intra product name", () => {
    const markup = renderToStaticMarkup(<MwellIntraLogo />);

    expect(markup).toContain("mwell-wordmark.png");
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="mWell Intra"');
    expect(markup).toContain(">Intra<");
  });

  it("can hide the product label without clipping the wordmark", () => {
    const markup = renderToStaticMarkup(
      <MwellIntraLogo
        logoClassName="h-3.5 max-w-[2.75rem]"
        showLabel={false}
      />,
    );

    expect(markup).toContain("mwell-wordmark.png");
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="mWell"');
    expect(markup).toContain("h-3.5 max-w-[2.75rem]");
    expect(markup).not.toContain("h-7 max-w-none");
    expect(markup).not.toContain(">Intra<");
  });

  it("uses a high-contrast wordmark treatment on dark surfaces", () => {
    const markup = renderToStaticMarkup(<MwellIntraLogo variant="light" />);

    expect(markup).toContain("brightness-0 invert");
    expect(markup).toContain("text-white");
  });
});
