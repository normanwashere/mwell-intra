import { describe, expect, it } from "vitest";
import {
  createReceivingTrainingState,
  receivingTrainingAdapter,
} from "./receivingAdapter";

const run = (
  branch: Parameters<typeof createReceivingTrainingState>[0],
  commands: Array<{ type: string; payload?: unknown }>,
) => {
  let state = createReceivingTrainingState(branch);
  let transition;
  for (const command of commands) {
    transition = receivingTrainingAdapter.dispatch(state, command);
    state = transition.state;
  }
  return { state, transition };
};

const cleanCommands = [
  {
    type: "select-purchase-order",
    payload: { id: "TRAIN-PO-1042", expectedQuantity: 2 },
  },
  { type: "set-delivery-date", payload: "2026-08-13" },
  {
    type: "add-line",
    payload: { category: "sku", productId: "smart-watch", serialized: true },
  },
  { type: "set-batch-number", payload: "TRAIN-BATCH-A" },
  { type: "scan-serial", payload: "TRAIN-SERIAL-0001" },
  { type: "scan-serial", payload: "TRAIN-SERIAL-0002" },
  { type: "confirm-traceability" },
  { type: "set-destination", payload: "TRAIN-BIN-A01" },
  { type: "attach-evidence", payload: "training://delivery-photo" },
  { type: "mark-condition", payload: "clean" },
] as const;

describe("receivingTrainingAdapter", () => {
  it("completes a clean serialized SKU receipt with inspection handoff evidence", () => {
    const result = run("clean", [...cleanCommands, { type: "submit-receipt" }]);
    expect(result.transition).toMatchObject({
      nextStepId: "complete",
      checkpointId: "complete",
      outcomeId: "clean_inspection_handoff",
      completed: true,
    });
    expect(result.state).toMatchObject({
      status: "complete",
      receivedQuantity: 2,
      qualityRoute: "inspection",
    });
  });

  it("blocks a receipt with no batch number", () => {
    const commands = cleanCommands.filter(
      (command) =>
        command.type !== "set-batch-number" &&
        command.type !== "confirm-traceability",
    );
    const { state } = run("missing-batch", commands);
    expect(() =>
      receivingTrainingAdapter.dispatch(state, { type: "submit-receipt" }),
    ).toThrow("Batch number is required");
  });

  it("rejects a duplicate serial without changing the simulated receipt", () => {
    const { state } = run("duplicate-serial", cleanCommands.slice(0, 5));
    expect(() =>
      receivingTrainingAdapter.dispatch(state, {
        type: "scan-serial",
        payload: "TRAIN-SERIAL-0001",
      }),
    ).toThrow("Serial TRAIN-SERIAL-0001 is already on this receipt");
    expect(state.serials).toEqual(["TRAIN-SERIAL-0001"]);
  });

  it("rejects over-receipt and preserves ordered custody", () => {
    const { state } = run("over-receipt", cleanCommands.slice(0, 6));
    expect(() =>
      receivingTrainingAdapter.dispatch(state, {
        type: "scan-serial",
        payload: "TRAIN-SERIAL-0003",
      }),
    ).toThrow("Quantity exceeds the purchase order");
    expect(state.receivedQuantity).toBe(2);
  });

  it("routes damaged delivery evidence to quarantine quality review", () => {
    const result = run("damaged-delivery", [
      ...cleanCommands,
      { type: "mark-condition", payload: "damaged" },
      { type: "submit-receipt" },
    ]);
    expect(result.transition?.outcomeId).toBe("damaged_quarantine_handoff");
    expect(result.state.qualityRoute).toBe("quarantine");
  });

  it("records a partial receipt without pretending the PO is closed", () => {
    const result = run("partial-receipt", [
      ...cleanCommands.filter(
        (command) =>
          !(
            command.type === "scan-serial" &&
            command.payload === "TRAIN-SERIAL-0002"
          ),
      ),
      { type: "submit-receipt" },
    ]);
    expect(result.transition?.outcomeId).toBe("partial_inspection_handoff");
    expect(result.state.purchaseOrderClosed).toBe(false);
  });

  it("pauses and resumes from the same immutable simulated state", () => {
    const before = run("interruption", cleanCommands.slice(0, 4)).state;
    const paused = receivingTrainingAdapter.dispatch(before, {
      type: "interrupt",
    });
    const resumed = receivingTrainingAdapter.dispatch(paused.state, {
      type: "resume",
    });
    expect(paused.checkpointId).toBe("draft-saved");
    expect(resumed.state).toMatchObject({
      batchNumber: "TRAIN-BATCH-A",
      interrupted: false,
    });
    expect(before.interrupted).toBe(false);
  });

  it.each([
    ["merch", "TRAIN-MERCH-SHEET-01"],
    ["event-material", "TRAIN-EVENT-SHEET-01"],
  ] as const)(
    "uses one monitored barcode sheet for %s",
    (category, barcode) => {
      const result = run(category, [
        {
          type: "select-purchase-order",
          payload: { id: "TRAIN-PO-1042", expectedQuantity: 10 },
        },
        { type: "set-delivery-date", payload: "2026-08-13" },
        {
          type: "add-line",
          payload: {
            category,
            productId: `${category}-item`,
            serialized: false,
          },
        },
        { type: "set-batch-number", payload: "TRAIN-BATCH-A" },
        { type: "set-sheet-barcode", payload: barcode },
        { type: "set-quantity", payload: 10 },
        { type: "confirm-traceability" },
      ]);
      expect(result.state).toMatchObject({
        barcodeSheetCode: barcode,
        receivedQuantity: 10,
      });
      expect(result.state.serials).toEqual([]);
    },
  );
});
