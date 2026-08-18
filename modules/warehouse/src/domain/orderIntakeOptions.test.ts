import { describe, expect, it } from "vitest";
import {
  cityPreset,
  paymentStatusFor,
  trackerTemplateCsv,
} from "./orderIntakeOptions";

describe("order intake controls", () => {
  it("suggests editable delivery details from a supported city", () => {
    expect(cityPreset(" pasig ")).toEqual(
      expect.objectContaining({
        province: "Metro Manila",
        postalCode: "1600",
        area: "Metro Manila",
      }),
    );
    expect(cityPreset("Unknown municipality")).toBeUndefined();
  });

  it("derives allocation status from payment authority", () => {
    expect(paymentStatusFor("cash", "pending")).toBe("cod");
    expect(paymentStatusFor("billing", "pending")).toBe("authorized");
    expect(paymentStatusFor("online_payment", "paid")).toBe("paid");
    expect(paymentStatusFor("online_payment", "failed")).toBe("blocked");
  });

  it("provides an import template with governed tracker fields", () => {
    const csv = trackerTemplateCsv();
    expect(csv).toContain("order_reference");
    expect(csv).toContain("payment_reference");
    expect(csv).toContain("bundle_set_codes");
    expect(csv).toContain("delivery_link");
  });
});
