import { describe, expect, it } from "vitest";
import { getMetricFreshness, resolveGovernedSource } from "./data";

describe("Insights remediation contract", () => {
  it("marks an old extraction stale and carries PR-to-PO definition into its drill-down", () => {
    expect(getMetricFreshness("2026-08-12T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z"))).toMatchObject({
      stale: true,
      label: "Stale extraction",
    });
    expect(
      resolveGovernedSource(
        {
          id: "pr-cycle",
          sourceHref: "/procurement/purchase-orders",
          drillDownContext: "Approved PR submission to first issued PO, in calendar days.",
        },
        { procurement: ["procurement_officer"] },
      ),
    ).toMatchObject({
      accessible: true,
      href: expect.stringContaining("insight=pr-cycle"),
    });
  });
});
