// Unregistered server-only review keys. Source: StorageAreasPage and FulfillmentPage.
export const OPS_CUSTODY_CANDIDATE_RULES = {
  "warehouse-putaway-review-v1:eligible-source": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "A matching SKU does not establish source identity or eligibility.",
      "bypass": "Putaway does not authorize releasing a quality hold."
    }
  },
  "warehouse-putaway-review-v1:destination-quantity": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "The move must not exceed eligible stock.",
      "bypass": "The putaway destination must belong to the selected warehouse."
    }
  },
  "warehouse-putaway-review-v1:readback": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "A lost response can follow a committed movement. Read back before retrying to avoid duplication.",
      "bypass": "Partial putaway does not establish completion of the remaining quantity."
    }
  },
  "warehouse-pick-pack-review-v1:allocation": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "Urgency does not remove stock eligibility or quality restrictions.",
      "bypass": "Follow the order's allocation and picking state without bypassing prerequisites."
    }
  },
  "warehouse-pick-pack-review-v1:verified-pick": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "Duplicate serials do not prove that two distinct units were picked.",
      "bypass": "Serials must match eligible stock for the order line, not merely the quantity."
    }
  },
  "warehouse-pick-pack-review-v1:pack-handoff": {
    "acceptedChoiceId": "verify",
    "rejectedFeedback": {
      "shortcut": "The packer must not perform the independent release.",
      "bypass": "A failed or lost response does not establish whether packing was recorded. Verify the exact order before retry."
    }
  }
} as const;
