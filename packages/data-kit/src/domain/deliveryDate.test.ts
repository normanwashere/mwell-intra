import { describe, expect, it } from "vitest";
import { deliveryToday, validateActualDeliveryDate } from "./deliveryDate";

describe("actual delivery date", () => {
  it("uses the Philippines calendar day without borrowing expected or posting dates", () => {
    expect(deliveryToday(new Date("2026-09-07T16:01:00Z"))).toBe("2026-09-08");
    expect(() => validateActualDeliveryDate("2024-02-29", "2026-09-08")).not.toThrow();
    expect(() => validateActualDeliveryDate(undefined)).not.toThrow();
  });
  it.each(["", "2026-02-29", "2026-13-01", "2026-09-09", "2026-9-1", "0000-01-01", "2026-09-08T00:00:00Z"])("rejects invalid or future value %s", (value) => {
    expect(() => validateActualDeliveryDate(value, "2026-09-08")).toThrow("Actual delivery date");
  });
});
