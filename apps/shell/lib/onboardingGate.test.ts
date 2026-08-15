import { describe, expect, it } from "vitest";
import { isOnboardingProtectedPath, onboardingHref } from "./onboardingGate";

describe("onboarding route contract", () => {
  it.each([
    "/work",
    "/warehouse/receiving",
    "/procurement/requests/new",
    "/admin/users",
  ])("protects operational path %s", (pathname) => {
    expect(isOnboardingProtectedPath(pathname)).toBe(true);
  });

  it.each(["/", "/onboarding", "/knowledge", "/login"])(
    "keeps discovery and recovery path %s available",
    (pathname) => {
      expect(isOnboardingProtectedPath(pathname)).toBe(false);
    },
  );

  it("preserves the requested destination", () => {
    expect(onboardingHref("/warehouse/receiving")).toBe(
      "/onboarding?next=%2Fwarehouse%2Freceiving",
    );
  });

  it.each(["/warehouse", "/procurement", "/legal"])(
    "canonicalizes embedded module root %s before the handoff",
    (destination) => {
      expect(onboardingHref(destination)).toBe(
        `/onboarding?next=${encodeURIComponent(`${destination}/`)}`,
      );
    },
  );
});
