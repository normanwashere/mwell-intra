import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MwellIntraLogo } from "./MwellIntraLogo";

describe("MwellIntraLogo", () => {
  it("renders the approved mWell wordmark with the Intra product name", () => {
    const markup = renderToStaticMarkup(<MwellIntraLogo />);

    expect(markup).toContain("mwell-wordmark.png");
    expect(markup).toContain(">Intra<");
  });

  it("can hide the product label without clipping the wordmark", () => {
    const markup = renderToStaticMarkup(<MwellIntraLogo showLabel={false} />);

    expect(markup).toContain("mwell-wordmark.png");
    expect(markup).not.toContain(">Intra<");
  });
});
