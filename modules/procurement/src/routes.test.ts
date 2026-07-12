import { describe, expect, it } from "vitest";
import {
  PROCUREMENT_ROUTE_CONTRACTS,
  procurementRoutesForAudience,
} from "./routes";

describe("procurement route contracts", () => {
  it("selects every full-workspace route used by ProcurementApp", () => {
    expect(
      procurementRoutesForAudience("full").map((entry) => entry.path),
    ).toEqual(PROCUREMENT_ROUTE_CONTRACTS.map((entry) => entry.path));
  });

  it("limits tier-only users to redirect, approval, and request review routes", () => {
    expect(
      procurementRoutesForAudience("approvals-only").map((entry) => entry.id),
    ).toEqual(["requests", "request-detail", "approvals"]);
  });
});
