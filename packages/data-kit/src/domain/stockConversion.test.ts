import { describe, expect, it } from "vitest";
import { stockConversionCapability, validateStockConversion, type StockConversionCommand } from "./stockConversion";

const create = (): StockConversionCommand => ({
  action: "create", idempotency_key: "conversion-test-0001", recipe_id: "recipe",
  event_id: "event", source_location_id: "wh", source_bin_id: "bin",
  destination_location_id: "wh", destination_bin_id: "out", evidence_urls: ["https://evidence.test/check"],
  units: [{ serial_number: "WATCH-01", inspection_id: "inspection" }],
});

describe("stock conversion boundary", () => {
  it("keeps the selected device serial without accepting an output serial override", () => {
    const command = create();
    expect(validateStockConversion(command)).toEqual([]);
    expect(validateStockConversion({ ...command, output_serial_number: "NEW" } as unknown as StockConversionCommand)).toContain("Output serial numbers cannot be replaced.");
  });
  it("rejects canonical duplicate serials and bounded batches", () => {
    const command = create();
    if (command.action !== "create") throw new Error("fixture");
    command.units.push({ serial_number: " watch-01 ", inspection_id: "another" });
    expect(validateStockConversion(command)).toContain("Each device serial must be selected once.");
    command.units = Array.from({ length: 101 }, (_, i) => ({ serial_number: `S${i}`, inspection_id: `I${i}` }));
    expect(validateStockConversion(command)).toContain("Select between 1 and 100 devices.");
  });
  it("requires saved per-device inspection and usable evidence", () => {
    const command = create();
    if (command.action !== "create") throw new Error("fixture");
    command.units[0]!.inspection_id = "";
    command.evidence_urls = ["javascript:alert(1)"];
    expect(validateStockConversion(command)).toContain("Every device requires a saved inspection.");
    expect(validateStockConversion(command)).toContain("At least one HTTPS evidence reference is required.");
  });
  it("requires all recovery lineage references together", () => {
    const command = create();
    if (command.action !== "create") throw new Error("fixture");
    command.units[0]!.return_id = "returned";
    expect(validateStockConversion(command)).toContain("Recovery requires return, allocation, and original conversion references for each device.");
  });
  it("requires separate Product, Quality and operational capabilities", () => {
    expect(stockConversionCapability("approve_recipe")).toBe("decide_go_live");
    expect(stockConversionCapability("approve")).toBe("inspect_quality");
    expect(stockConversionCapability("complete")).toBe("manage_returns");
  });
  it("requires an explicit versioned recipe and explicit packaging quantities", () => {
    const command: StockConversionCommand = {
      action: "approve_recipe", idempotency_key: "recipe-test-0001", kit_definition_id: "kit",
      event_id: "event", direction: "conversion", source_product_id: "base", output_product_id: "variant",
      approval_reference: "Product approval 123", evidence_urls: ["https://evidence.test/recipe"],
      packaging: [{ product_id: "bag", quantity: 0, disposition: "consume" }],
    };
    expect(validateStockConversion(command)).toContain("Packaging quantities must be positive whole units with one row per product.");
    command.packaging = [];
    expect(validateStockConversion(command)).toEqual([]);
  });
  it("requires a stable idempotency key and individual Quality evidence", () => {
    expect(validateStockConversion({ action: "approve", idempotency_key: "short", batch_id: "batch", evidence_urls: [], inspected_serial_numbers: [] })).toEqual(expect.arrayContaining([
      "A stable idempotency key is required.", "At least one HTTPS evidence reference is required.", "Confirm every inspected device explicitly.",
    ]));
  });
});
