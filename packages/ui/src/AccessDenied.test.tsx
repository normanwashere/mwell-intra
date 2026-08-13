import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccessDenied } from "./AccessDenied";
import { EmptyState } from "./primitives";

describe("AccessDenied", () => {
  it("names the recovery owner and exact next action", () => {
    const markup = renderToStaticMarkup(
      <AccessDenied
        module="Vendor Portal"
        message="This area is reserved for an enrolled vendor account."
        recoveryOwner="Vendor Support"
        recoveryAction="Ask Vendor Support to verify the company-profile link."
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
    expect(markup).toContain("Recovery owner");
    expect(markup).toContain("Vendor Support");
    expect(markup).toContain(
      "Ask Vendor Support to verify the company-profile link.",
    );
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
