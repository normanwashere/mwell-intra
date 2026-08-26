import { describe, expect, it } from "vitest";
import { normalizeSafeHttpsUrl } from "./urlSafety";

describe("normalizeSafeHttpsUrl", () => {
  it("accepts normalized HTTPS URLs without credentials", () => {
    expect(normalizeSafeHttpsUrl("  https://track.example/WB-001  ")).toBe(
      "https://track.example/WB-001",
    );
  });

  it.each([
    "http://deliverylink.com/WB-001",
    "http:///deliverylink.com/WB-001",
    "javascript:alert(1)",
    "https://user:secret@track.example/WB-001",
    "/relative/tracking",
    "not a URL",
  ])("rejects unsafe or malformed URL %s", (value) => {
    expect(normalizeSafeHttpsUrl(value)).toBeNull();
  });
});
