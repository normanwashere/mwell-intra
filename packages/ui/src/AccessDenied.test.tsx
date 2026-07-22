import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessDenied } from "./AccessDenied";

describe("AccessDenied", () => {
  it("uses a main landmark, module-specific H1, nested alert, and 44px recovery target", () => {
    const markup = renderToStaticMarkup(
      <AccessDenied
        module="Vendor Portal"
        message="This area is reserved for an enrolled vendor account."
        returnHref="/vendor"
        returnLabel="Return to Vendor Portal"
      />,
    );

    expect(markup).toContain("<main");
    expect(markup).toContain("<h1");
    expect(markup).toContain("Vendor Portal access required");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("min-h-11");
    expect(markup).toContain("Return to Vendor Portal");
  });
});
