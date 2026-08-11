import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessDenied } from "./AccessDenied";
import { EmptyState } from "./primitives";

describe("AccessDenied", () => {
  it("uses the shell's main landmark, a module-specific H1, nested alert, and 44px recovery target", () => {
    const markup = renderToStaticMarkup(
      <AccessDenied
        module="Vendor Portal"
        message="This area is reserved for an enrolled vendor account."
        returnHref="/vendor"
        returnLabel="Return to Vendor Portal"
      />,
    );

    expect(markup).toContain("<section");
    expect(markup).not.toContain("<main");
    expect(markup).toContain("<h1");
    expect(markup).toContain("Vendor Portal access required");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("min-h-11");
    expect(markup).toContain("Return to Vendor Portal");
  });
});

describe("EmptyState", () => {
  it("uses a section heading by default and can own a route H1", () => {
    expect(renderToStaticMarkup(<EmptyState title="No records" />)).toContain(
      "<h2",
    );
    expect(
      renderToStaticMarkup(
        <EmptyState title="Event not found" headingLevel={1} />,
      ),
    ).toContain("<h1");
  });
});
