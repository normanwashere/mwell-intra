import { describe, expect, it } from "vitest";
import { mobileCenterAction } from "./navigation";

describe("mobile contextual actions", () => {
  it("does not show Legal or Procurement write actions without permission", () => {
    expect(mobileCenterAction("/legal", {})).toBeNull();
    expect(mobileCenterAction("/procurement", {})).toBeNull();
  });

  it("shows actions only for a role with the required capability", () => {
    expect(
      mobileCenterAction("/legal", { legal: ["admin"] })?.label,
    ).toBe("Invite vendor");
    expect(
      mobileCenterAction("/procurement", { procurement: ["requester"] })
        ?.label,
    ).toBe("New request");
  });
});
