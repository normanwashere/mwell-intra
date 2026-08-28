import { beforeAll, describe, expect, it } from "vitest";
import type { WarehouseData } from "@/data/repository";
import { makeRepo } from "@/test/renderWithProviders";
import {
  parseReturnSerials,
  prepareReturnLines,
  type ReturnIntakeLine,
} from "./returnIntake";

let data: WarehouseData;
const bulk: ReturnIntakeLine = {
  id: 0,
  productId: "shirt-l",
  quantity: 3,
  reason: "wrong size",
  serials: "",
};
const device: ReturnIntakeLine = {
  id: 1,
  productId: "ecg-ring-10",
  quantity: 2,
  reason: "defective",
  serials: "ecg-ring-10-sn0001\nECG-RING-10-SN0002",
};

beforeAll(async () => {
  data = await makeRepo().getData();
});

describe("return intake validation", () => {
  it("parses pasted and scanned serials without silently deduplicating them", () => {
    expect(parseReturnSerials(" A, B;\r\n A \t")).toEqual(["A", "B", "A"]);
    expect(parseReturnSerials(" \n")).toEqual([]);
  });

  it("builds quarantine-only lines with canonical serials and a unit quantity per serial", () => {
    expect(prepareReturnLines(data, [bulk, device], "evt-makati")).toEqual({
      errors: [null, null],
      lines: [
        {
          productId: "shirt-l",
          quantity: 3,
          reason: "wrong size",
          disposition: "quarantine",
        },
        {
          productId: "ecg-ring-10",
          quantity: 1,
          reason: "defective",
          disposition: "quarantine",
          serialNumber: "ECG-RING-10-SN0001",
        },
        {
          productId: "ecg-ring-10",
          quantity: 1,
          reason: "defective",
          disposition: "quarantine",
          serialNumber: "ECG-RING-10-SN0002",
        },
      ],
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid quantity %s without a partial payload",
    (quantity) => {
      const result = prepareReturnLines(data, [bulk, { ...device, quantity }]);
      expect(result.lines).toEqual([]);
      expect(result.errors[1]).toMatch(/positive whole number/i);
    },
  );

  it.each(["", "unknown-product"])(
    "rejects missing or unknown product %s without a partial payload",
    (productId) => {
      const result = prepareReturnLines(data, [bulk, { ...device, productId }]);
      expect(result.lines).toEqual([]);
      expect(result.errors[1]).toMatch(/select a product/i);
    },
  );

  it("rejects a missing reason", () => {
    expect(prepareReturnLines(data, [{ ...bulk, reason: " " }]).lines).toEqual(
      [],
    );
  });

  it.each([
    "",
    "ECG-RING-10-SN0001",
    "ECG-RING-10-SN0001,ECG-RING-10-SN0002,ECG-RING-10-FLD001",
  ])("requires exactly one serial per declared unit: %s", (serials) => {
    const result = prepareReturnLines(data, [bulk, { ...device, serials }]);
    expect(result.lines).toEqual([]);
    expect(result.errors[1]).toMatch(/expected 2 serial numbers/i);
  });

  it("rejects case-insensitive duplicates within a product line", () => {
    const result = prepareReturnLines(data, [
      { ...device, serials: "ECG-RING-10-SN0001,ecg-ring-10-sn0001" },
    ]);
    expect(result.lines).toEqual([]);
    expect(result.errors[0]).toMatch(/already included/i);
  });

  it("rejects duplicates across product lines", () => {
    const result = prepareReturnLines(data, [device, { ...device, id: 2 }]);
    expect(result.lines).toEqual([]);
    expect(result.errors[1]).toMatch(/already included/i);
  });

  it.each([
    ["UNKNOWN-SERIAL", /not recognized/i],
    ["ECG-RING-10-SN0003", /cannot be returned/i],
    ["SMART-WATCH-VIP001", /does not match the product/i],
    ["ecg-ring-10", /individual device serial/i],
  ])("rejects invalid return serial %s", (serials, message) => {
    const result = prepareReturnLines(data, [
      bulk,
      { ...device, quantity: 1, serials },
    ]);
    expect(result.lines).toEqual([]);
    expect(result.errors[1]).toMatch(message);
  });

  it("revalidates every serial against the selected event", () => {
    const result = prepareReturnLines(data, [device], "evt-vip");
    expect(result.lines).toEqual([]);
    expect(result.errors[0]).toMatch(/different event/i);
  });

  it.each([
    [{ eventId: "evt-vip" }, /different event/i],
    [{ status: "pending_inspection" as const }, /cannot be returned/i],
  ])(
    "rejects the entire intake when only the last serial is invalid: %o",
    (changes, message) => {
      const changed = {
        ...data,
        units: data.units.map((unit) =>
          unit.serialNumber === "ECG-RING-10-SN0002"
            ? { ...unit, ...changes }
            : unit,
        ),
      };
      const result = prepareReturnLines(changed, [bulk, device], "evt-makati");
      expect(result.lines).toEqual([]);
      expect(result.errors).toEqual([null, expect.stringMatching(message)]);
    },
  );

  it("does not forward stale serial data for nonserialized products", () => {
    expect(
      prepareReturnLines(data, [{ ...bulk, serials: device.serials }]).lines,
    ).toEqual([
      {
        productId: "shirt-l",
        quantity: 3,
        reason: "wrong size",
        disposition: "quarantine",
      },
    ]);
  });

  it("does not generate a payload for an empty intake", () => {
    expect(prepareReturnLines(data, []).lines).toEqual([]);
  });
});
