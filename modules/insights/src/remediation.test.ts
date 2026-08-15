import { describe, expect, it } from "vitest";
import { getSourceActivityFreshness, resolveGovernedSource } from "./data";

describe("Insights remediation contract", () => {
  it("marks old source activity stale and carries PR-to-PO definition into its drill-down", () => {
    expect(
      getSourceActivityFreshness(
        "2026-08-12T00:00:00.000Z",
        new Date("2026-08-14T00:00:00.000Z"),
      ),
    ).toMatchObject({
      stale: true,
      label: "Stale source",
    });
    expect(
      resolveGovernedSource(
        {
          id: "pr-cycle",
          sourceHref: "/procurement/purchase-orders",
          drillDownContext:
            "Approved PR submission to first issued PO, in calendar days.",
        },
        { procurement: ["procurement_officer"] },
      ),
    ).toMatchObject({
      accessible: true,
      href: expect.stringContaining("insight=pr-cycle"),
    });
  });
});
