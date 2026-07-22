import { describe, expect, it } from "vitest";
import { mutationAvailability, nextConnectivityStatus } from "./connectivity";

describe("connectivity mutation safety", () => {
  it.each(["offline", "stale"] as const)(
    "fails closed while the application is %s",
    (status) => {
      expect(mutationAvailability(status)).toEqual({
        allowed: false,
        reason:
          status === "offline"
            ? "Reconnect before changing live data."
            : "Reload current data before making changes.",
      });
    },
  );

  it("requires a fresh reload after reconnecting", () => {
    expect(nextConnectivityStatus("offline", true)).toBe("stale");
    expect(nextConnectivityStatus("online", false)).toBe("offline");
    expect(mutationAvailability("online").allowed).toBe(true);
  });
});
