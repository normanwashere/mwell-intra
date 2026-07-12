import { describe, expect, it } from "vitest";
import { LEGAL_ROUTE_CONTRACTS, mountLegalRouteContracts } from "./routes";

describe("legal route contracts", () => {
  it("mounts every router path under the internal basename", () => {
    expect(
      mountLegalRouteContracts("/legal", "legal").map((entry) => entry.route),
    ).toEqual(
      LEGAL_ROUTE_CONTRACTS.map((entry) =>
        entry.path === "/" ? "/legal" : `/legal${entry.path}`,
      ),
    );
  });

  it("mounts every router path under the vendor basename", () => {
    expect(
      mountLegalRouteContracts("/vendor", "vendor").map((entry) => entry.route),
    ).toEqual(
      LEGAL_ROUTE_CONTRACTS.map((entry) =>
        entry.path === "/" ? "/vendor" : `/vendor${entry.path}`,
      ),
    );
  });
});
