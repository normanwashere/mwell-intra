import type { SimulationDefinition } from "./types";

// Unregistered review candidates; no assignments or client-side answer keys.
export const OPS_CUSTODY_CANDIDATES: readonly SimulationDefinition[] = [
  {
    "id": "warehouse-putaway-review-v1",
    "version": 1,
    "audience": "internal",
    "module": "warehouse",
    "title": "Put away eligible stock into its verified destination",
    "capabilityOutcomes": [
      {
        "module": "warehouse",
        "capability": "transfer_stock"
      }
    ],
    "checkpointIds": [
      "eligible-source",
      "destination-quantity",
      "readback"
    ],
    "embeddedSteps": [
      {
        "checkpointId": "eligible-source",
        "outcomeId": "eligible-source",
        "title": "Verify source eligibility",
        "instruction": "Use the exact source and eligible unbinned stock in the selected warehouse. Held stock is not made eligible by selecting a destination.",
        "context": "A task refers to one serial; a matching SKU includes another held unit.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Use any matching SKU"
          },
          {
            "id": "verify",
            "label": "Confirm the exact source serial and its eligible stock state"
          },
          {
            "id": "bypass",
            "label": "Move the held unit to make it available"
          }
        ]
      },
      {
        "checkpointId": "destination-quantity",
        "outcomeId": "destination-quantity",
        "title": "Confirm destination and quantity",
        "instruction": "Choose an active destination bin in the selected warehouse. Serialized units move as one; other quantities must be positive whole units within eligible availability.",
        "context": "Four nonserialized units are eligible. A proposed move requests five into another warehouse's bin.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Move five and correct later"
          },
          {
            "id": "verify",
            "label": "Select an active bin in this warehouse and a whole quantity no greater than four"
          },
          {
            "id": "bypass",
            "label": "Use the other warehouse bin"
          }
        ]
      },
      {
        "checkpointId": "readback",
        "outcomeId": "readback",
        "title": "Verify the recorded movement",
        "instruction": "A failed or lost response does not establish whether a movement was recorded. Preserve the capture and verify the exact source and destination before retrying. Partial putaway can leave remaining work.",
        "context": "The response was lost after putting away two of four units.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Create a new movement immediately"
          },
          {
            "id": "verify",
            "label": "Read back the source, destination and remaining quantity before retry or handoff"
          },
          {
            "id": "bypass",
            "label": "Mark all four complete"
          }
        ]
      }
    ]
  },
  {
    "id": "warehouse-pick-pack-review-v1",
    "version": 1,
    "audience": "internal",
    "module": "warehouse",
    "title": "Allocate, verify picks and hand off packing for independent release",
    "capabilityOutcomes": [
      {
        "module": "warehouse",
        "capability": "reserve_allocate"
      },
      {
        "module": "warehouse",
        "capability": "issue_items"
      }
    ],
    "checkpointIds": [
      "allocation",
      "verified-pick",
      "pack-handoff"
    ],
    "embeddedSteps": [
      {
        "checkpointId": "allocation",
        "outcomeId": "allocation",
        "title": "Confirm eligible allocation",
        "instruction": "Use the selected order and its current allocation state. Only accepted, put-away stock is pickable. Stop and route condition problems to quality.",
        "context": "The selected order needs stock, but the proposed units are held or not yet put away.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Allocate held stock because the order is urgent"
          },
          {
            "id": "verify",
            "label": "Resolve eligibility through authorized quality or putaway before allocation and picking"
          },
          {
            "id": "bypass",
            "label": "Skip allocation and confirm a pick"
          }
        ]
      },
      {
        "checkpointId": "verified-pick",
        "outcomeId": "verified-pick",
        "title": "Verify the physical pick",
        "instruction": "Scan the source rack or bin and the exact required serials for serialized lines. Reject duplicate or mismatched serials rather than substituting a matching product name.",
        "context": "The order requires two serialized units; captured codes repeat one serial.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Submit the repeated serial twice"
          },
          {
            "id": "verify",
            "label": "Verify the source bin and capture two distinct eligible matching serials"
          },
          {
            "id": "bypass",
            "label": "Enter unrelated serials with the same quantity"
          }
        ]
      },
      {
        "checkpointId": "pack-handoff",
        "outcomeId": "pack-handoff",
        "title": "Prepare packing and independent release",
        "instruction": "Record delivery-method details and packaging actually consumed. Shipment tracking links must use HTTPS. Wait for pending evidence uploads. Packing is not release; another warehouse operator must release. A lost response requires exact-order readback before retry.",
        "context": "Packing confirmation loses its response and the packer is asked to release immediately.",
        "question": "What should you do next?",
        "choices": [
          {
            "id": "shortcut",
            "label": "Release your own packed order"
          },
          {
            "id": "verify",
            "label": "Retain the capture, verify the current order and hand confirmed ready work to a different authorized operator"
          },
          {
            "id": "bypass",
            "label": "Assume packing failed and submit a new command"
          }
        ]
      }
    ]
  }
];
