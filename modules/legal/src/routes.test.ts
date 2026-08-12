import { describe, expect, it } from "vitest";
import { LEGAL_ROUTE_BY_ID, LEGAL_ROUTE_CONTRACTS, mountLegalRouteContracts } from "./routes";

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

  it("keeps vendor draft work separate from the final submission transition", () => {
    expect(LEGAL_ROUTE_BY_ID["application"].vendorCapabilityIds).toEqual([
      "view_own_accreditation",
      "manage_own_accreditation_draft",
    ]);
    expect(LEGAL_ROUTE_BY_ID["case-detail"].vendorCapabilityIds).toEqual([
      "view_own_accreditation",
      "submit_documents",
      "manage_own_accreditation_draft",
    ]);
  });
});
