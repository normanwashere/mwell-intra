import { describe, expect, it } from "vitest";
import {
  filterAndPageProfiles,
  validateRoleChangeEvidence,
  type GovernedAdminProfile,
} from "./adminGovernance";

const profiles: GovernedAdminProfile[] = [
  {
    id: "active-employee",
    email: "ana@mwell.com.ph",
    full_name: "Ana Cruz",
    kind: "employee",
    status: "active",
  },
  {
    id: "retired-employee",
    email: "ben@mwell.com.ph",
    full_name: "Ben Lim",
    kind: "employee",
    status: "inactive",
  },
  {
    id: "active-vendor",
    email: "vendor@example.com",
    full_name: "Example Vendor",
    kind: "vendor",
    status: "active",
  },
];

describe("admin role-change governance", () => {
  it("requires approval reference, reason, and effective date", () => {
    expect(
      validateRoleChangeEvidence({
        approvalReference: "",
        reason: "",
        effectiveAt: "",
        expiresAt: "",
      }),
    ).toEqual({
      approvalReference: "Approval reference is required.",
      reason: "Business reason is required.",
      effectiveAt: "Effective date is required.",
    });
  });

  it("rejects an expiry earlier than the effective date", () => {
    expect(
      validateRoleChangeEvidence({
        approvalReference: "IAM-2026-100",
        reason: "Temporary project assignment",
        effectiveAt: "2026-08-10",
        expiresAt: "2026-08-01",
      }),
    ).toEqual({
      expiresAt: "Expiry must be after the effective date.",
    });
  });
});

describe("admin user directory", () => {
  it("defaults to active profiles and supports search and kind filters", () => {
    const result = filterAndPageProfiles(profiles, {
      query: "vendor",
      status: "active",
      kind: "vendor",
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.rows.map((profile) => profile.id)).toEqual(["active-vendor"]);
  });

  it("paginates filtered profiles deterministically", () => {
    const result = filterAndPageProfiles(profiles, {
      query: "",
      status: "all",
      kind: "all",
      page: 2,
      pageSize: 2,
    });

    expect(result.total).toBe(3);
    expect(result.pages).toBe(2);
    expect(result.rows.map((profile) => profile.id)).toEqual([
      "active-vendor",
    ]);
  });
});
