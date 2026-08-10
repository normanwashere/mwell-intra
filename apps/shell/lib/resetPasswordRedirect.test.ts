import { describe, expect, it } from "vitest";
import { getSafeResetNextPath } from "../app/reset-password/page";

describe("getSafeResetNextPath", () => {
  it.each([
    ["/", "/"],
    ["/warehouse", "/warehouse"],
    [
      "/knowledge?mode=role&q=Operations%20Associate",
      "/knowledge?mode=role&q=Operations%20Associate",
    ],
    [
      "/procurement/requests/123#approval",
      "/procurement/requests/123#approval",
    ],
  ])("preserves local relative destination %s", (requested, expected) => {
    expect(getSafeResetNextPath(requested)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "warehouse",
    "https://evil.example",
    "//evil.example",
    "/https://evil.example",
    "/\\evil.example",
    "\\/evil.example",
    "/%5Cevil.example",
    "/%255Cevil.example",
    "/%25255Cevil.example",
    "/%2F%2Fevil.example",
    "/%68%74%74%70%73%3A%2F%2Fevil.example",
    "/knowledge%ZZ",
    "/%2525252525252Fwarehouse",
  ])("falls back to home for unsafe destination %s", (requested) => {
    expect(getSafeResetNextPath(requested)).toBe("/");
  });
});
