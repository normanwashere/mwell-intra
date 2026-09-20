import { expect, it } from "vitest";
import { movementTypeLabel, signedQuantity, statusLabel } from "./format";

it("labels stock conversion and signs device and packaging movements by disposition", () => {
  expect(statusLabel("conversion_pending")).toBe("Conversion pending");
  expect(movementTypeLabel("stock_conversion_out")).toBe("Conversion source");
  expect(movementTypeLabel("stock_conversion_in")).toBe("Conversion output");
  expect(signedQuantity("stock_conversion_out", 2)).toBe("\u22122");
  expect(signedQuantity("stock_conversion_in", 2)).toBe("+2");
  expect(signedQuantity("stock_conversion_packaging_consumed", 4)).toBe("\u22124");
  expect(signedQuantity("stock_conversion_packaging_recovered", 4)).toBe("+4");
  expect(signedQuantity("stock_conversion_packaging_discarded", 4)).toBe("4");
});
