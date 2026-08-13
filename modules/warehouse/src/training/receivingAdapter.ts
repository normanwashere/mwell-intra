import type {
  TrainingAdapter,
  TrainingCommand,
  TrainingScenario,
  TrainingTransition,
} from "@intra/learning";

export const RECEIVING_SIMULATION_ID = "warehouse-receiving-v1";

export type ReceivingTrainingBranch =
  | "clean"
  | "missing-batch"
  | "duplicate-serial"
  | "over-receipt"
  | "damaged-delivery"
  | "partial-receipt"
  | "interruption"
  | "merch"
  | "event-material";

export interface ReceivingTrainingState {
  branch: ReceivingTrainingBranch;
  purchaseOrderId: string | null;
  expectedQuantity: number;
  category: "sku" | "merch" | "event-material" | null;
  productId: string;
  serialized: boolean;
  deliveryDate: string;
  batchNumber: string;
  serials: readonly string[];
  barcodeSheetCode: string;
  receivedQuantity: number;
  destinationId: string;
  evidenceUrls: readonly string[];
  condition: "clean" | "damaged";
  qualityRoute: "inspection" | "quarantine" | null;
  purchaseOrderClosed: boolean;
  interrupted: boolean;
  status: "active" | "complete";
}

const textPayload = (command: TrainingCommand, label: string): string => {
  if (typeof command.payload !== "string" || !command.payload.trim()) {
    throw new Error(`${label} is required`);
  }
  return command.payload.trim();
};

const numberPayload = (command: TrainingCommand): number => {
  if (
    typeof command.payload !== "number" ||
    !Number.isInteger(command.payload) ||
    command.payload < 1
  ) {
    throw new Error("Quantity must be a positive whole number");
  }
  return command.payload;
};

const next = (
  state: ReceivingTrainingState,
  nextStepId: string,
  extra: Partial<TrainingTransition<ReceivingTrainingState>> = {},
): TrainingTransition<ReceivingTrainingState> => ({
  state,
  nextStepId,
  ...extra,
});

export function createReceivingTrainingState(
  branch: ReceivingTrainingBranch = "clean",
): ReceivingTrainingState {
  return {
    branch,
    purchaseOrderId: null,
    expectedQuantity: 0,
    category: null,
    productId: "",
    serialized: false,
    deliveryDate: "",
    batchNumber: "",
    serials: [],
    barcodeSheetCode: "",
    receivedQuantity: 0,
    destinationId: "",
    evidenceUrls: [],
    condition: "clean",
    qualityRoute: null,
    purchaseOrderClosed: false,
    interrupted: false,
    status: "active",
  };
}

export const receivingTrainingScenario: TrainingScenario = {
  id: RECEIVING_SIMULATION_ID,
  title: "Receive and inspect controlled stock",
  initialStepId: "purchase-order",
  steps: [
    {
      id: "purchase-order",
      title: "Confirm the purchase order",
      instruction:
        "Choose the issued purchase order and compare the expected quantity.",
      anchor: "[data-onboarding-anchor='receiving.purchase-order']",
      allowedCommands: ["select-purchase-order"],
    },
    {
      id: "delivery",
      title: "Record delivery details",
      instruction: "Enter the actual delivery date before handling stock.",
      anchor: "[data-onboarding-anchor='receiving.delivery-date']",
      allowedCommands: ["set-delivery-date"],
    },
    {
      id: "line",
      title: "Identify the received item",
      instruction:
        "Add the item using its controlled category and serialization rule.",
      anchor: "[data-onboarding-anchor='receiving.add-line']",
      allowedCommands: ["add-line"],
    },
    {
      id: "traceability-batch",
      title: "Record the supplier batch",
      instruction: "Enter the supplier batch number before scanning units.",
      anchor: "[data-onboarding-anchor='receiving.batch-number']",
      allowedCommands: ["set-batch-number"],
    },
    {
      id: "traceability-units",
      title: "Capture unit traceability",
      instruction:
        "Scan every serialized unit, or record the monitored sheet barcode for bulk materials. Confirm when the expected quantity is represented.",
      anchor: "[data-onboarding-anchor='receiving.serial-input']",
      allowedCommands: [
        "scan-serial",
        "set-sheet-barcode",
        "set-quantity",
        "confirm-traceability",
      ],
    },
    {
      id: "destination",
      title: "Choose controlled custody",
      instruction:
        "Choose the receiving destination before the stock moves to inspection.",
      anchor: "[data-onboarding-anchor='receiving.destination']",
      allowedCommands: ["set-destination"],
    },
    {
      id: "evidence",
      title: "Attach delivery evidence",
      instruction:
        "Attach packing or delivery evidence and identify visible damage.",
      anchor: "[data-onboarding-anchor='receiving.evidence']",
      allowedCommands: ["attach-evidence", "mark-condition"],
    },
    {
      id: "submit",
      title: "Review the simulated receipt",
      instruction:
        "Confirm quantity, traceability, destination, evidence, and the quality handoff.",
      anchor: "[data-onboarding-anchor='receiving.submit']",
      allowedCommands: ["submit-receipt", "interrupt"],
    },
    {
      id: "paused",
      title: "Receipt practice paused",
      instruction: "Resume without losing the simulated receipt.",
      anchor: "[data-onboarding-anchor='receiving.submit']",
      allowedCommands: ["resume"],
    },
    {
      id: "complete",
      title: "Receiving practice complete",
      instruction:
        "The simulated receipt is staged for the correct quality route. No live stock was changed.",
      anchor: "[data-onboarding-anchor='receiving.submit']",
      allowedCommands: [],
      terminal: true,
    },
  ],
};

export const receivingTrainingAdapter: TrainingAdapter<ReceivingTrainingState> & {
  route: string;
} = {
  id: RECEIVING_SIMULATION_ID,
  version: 1,
  scenarioIds: [RECEIVING_SIMULATION_ID],
  route: "/warehouse/receiving?training=warehouse-receiving-v1",
  initialState: () => createReceivingTrainingState(),
  dispatch(readonlyState, command) {
    const state: ReceivingTrainingState = structuredClone(readonlyState);
    if (state.status === "complete")
      throw new Error("This simulated receipt is already complete");
    switch (command.type) {
      case "select-purchase-order": {
        const payload = command.payload as {
          id?: unknown;
          expectedQuantity?: unknown;
        };
        if (!payload || typeof payload.id !== "string" || !payload.id.trim())
          throw new Error("Purchase order is required");
        if (
          typeof payload.expectedQuantity !== "number" ||
          payload.expectedQuantity < 1
        )
          throw new Error("Purchase order quantity is invalid");
        state.purchaseOrderId = payload.id;
        state.expectedQuantity = payload.expectedQuantity;
        return next(state, "delivery");
      }
      case "set-delivery-date":
        state.deliveryDate = textPayload(command, "Delivery date");
        return next(state, "line");
      case "add-line": {
        const payload = command.payload as {
          category?: unknown;
          productId?: unknown;
          serialized?: unknown;
        };
        if (
          !payload ||
          !["sku", "merch", "event-material"].includes(String(payload.category))
        )
          throw new Error("Item category is required");
        if (typeof payload.productId !== "string" || !payload.productId.trim())
          throw new Error("Product is required");
        state.category = payload.category as ReceivingTrainingState["category"];
        state.productId = payload.productId.trim();
        state.serialized = payload.serialized === true;
        if (state.category === "sku" && !state.serialized)
          throw new Error("Selling SKUs must be serialized");
        return next(state, "traceability-batch");
      }
      case "set-batch-number":
        state.batchNumber = textPayload(command, "Batch number");
        return next(state, "traceability-units");
      case "scan-serial": {
        if (!state.serialized)
          throw new Error("This item uses a monitored sheet barcode");
        const serial = textPayload(command, "Serial number");
        if (state.serials.includes(serial))
          throw new Error(`Serial ${serial} is already on this receipt`);
        if (state.receivedQuantity + 1 > state.expectedQuantity)
          throw new Error("Quantity exceeds the purchase order");
        state.serials = [...state.serials, serial];
        state.receivedQuantity = state.serials.length;
        return next(state, "traceability-units");
      }
      case "set-sheet-barcode": {
        if (state.serialized)
          throw new Error("Serialized SKUs require one serial per unit");
        if (
          typeof command.payload === "object" &&
          command.payload !== null &&
          "barcode" in command.payload
        ) {
          const payload = command.payload as {
            barcode?: unknown;
            quantity?: unknown;
          };
          state.barcodeSheetCode = textPayload(
            { type: command.type, payload: payload.barcode },
            "Barcode sheet",
          );
          state.receivedQuantity = numberPayload({
            type: command.type,
            payload: payload.quantity,
          });
          if (state.receivedQuantity > state.expectedQuantity) {
            throw new Error("Quantity exceeds the purchase order");
          }
        } else {
          state.barcodeSheetCode = textPayload(command, "Barcode sheet");
        }
        return next(state, "traceability-units");
      }
      case "set-quantity": {
        const quantity = numberPayload(command);
        if (quantity > state.expectedQuantity)
          throw new Error("Quantity exceeds the purchase order");
        state.receivedQuantity = quantity;
        return next(state, "traceability-units");
      }
      case "confirm-traceability":
        if (!state.batchNumber) throw new Error("Batch number is required");
        if (state.receivedQuantity < 1)
          throw new Error("At least one item must be received");
        if (state.serialized && state.serials.length !== state.receivedQuantity)
          throw new Error("Scan every serialized unit");
        if (!state.serialized && !state.barcodeSheetCode)
          throw new Error("Monitored barcode sheet is required");
        return next(state, "destination");
      case "set-destination":
        state.destinationId = textPayload(command, "Destination");
        return next(state, "evidence");
      case "attach-evidence":
        state.evidenceUrls = [
          ...state.evidenceUrls,
          textPayload(command, "Delivery evidence"),
        ];
        return next(state, "evidence");
      case "mark-condition":
        if (command.payload !== "clean" && command.payload !== "damaged")
          throw new Error("Delivery condition is invalid");
        state.condition = command.payload;
        return next(state, "submit");
      case "interrupt":
        state.interrupted = true;
        return next(state, "paused", {
          checkpointId: "draft-saved",
          outcomeId: "interrupted",
        });
      case "resume":
        state.interrupted = false;
        return next(state, "submit");
      case "submit-receipt": {
        if (!state.purchaseOrderId)
          throw new Error("Purchase order is required");
        if (!state.deliveryDate) throw new Error("Delivery date is required");
        if (!state.category) throw new Error("Receipt line is required");
        if (!state.batchNumber) throw new Error("Batch number is required");
        if (state.receivedQuantity < 1)
          throw new Error("At least one item must be received");
        if (state.serialized && state.serials.length !== state.receivedQuantity)
          throw new Error("Scan every serialized unit");
        if (!state.serialized && !state.barcodeSheetCode)
          throw new Error("Monitored barcode sheet is required");
        if (!state.destinationId) throw new Error("Destination is required");
        if (state.evidenceUrls.length === 0)
          throw new Error("Delivery evidence is required");
        state.qualityRoute =
          state.condition === "damaged" ? "quarantine" : "inspection";
        state.purchaseOrderClosed =
          state.receivedQuantity === state.expectedQuantity;
        state.status = "complete";
        return next(state, "complete", {
          checkpointId: "complete",
          outcomeId: "receive_stock",
          completed: true,
        });
      }
      default:
        throw new Error(`Unknown receiving training command ${command.type}`);
    }
  },
};
