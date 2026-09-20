export const EVENT_SELLER_CHOICE_RULES = {
  "event-seller-custody-v1:verify-assignment": {
    acceptedChoiceId: "confirm-own-event",
    rejectedFeedback: {
      "share-account":
        "Shared accounts, expired assignments, and another event's scope do not authorize your outcome. Request a named, time-limited assignment from the authorized event owner.",
    },
  },
  "event-seller-custody-v1:verify-custody": {
    acceptedChoiceId: "select-eligible",
    rejectedFeedback: {
      "use-returned":
        "Only eligible stock in your event's acknowledged custody can be recorded. Already sold, returned, unassigned, or excess quantities must be rejected.",
    },
  },
  "event-seller-custody-v1:record-outcome": {
    acceptedChoiceId: "record-actual",
    rejectedFeedback: {
      "rename-sale":
        "Relabeling a sale conceals actual revenue. Record the actual sale amount and a zero-amount giveaway separately with attributable references.",
    },
  },
  "event-seller-custody-v1:retry-intent": {
    acceptedChoiceId: "readback-retry",
    rejectedFeedback: {
      "new-reference":
        "A new reference creates a different intent and risks a duplicate outcome. Read back the original and preserve the same intent when retrying.",
    },
  },
  "event-seller-custody-v1:reverse-correction": {
    acceptedChoiceId: "reverse-own",
    rejectedFeedback: {
      "overwrite-entry":
        "Posted outcomes are immutable and attributable to their seller. Use your own eligible reversal and a new corrected post; do not overwrite or reverse another seller's evidence.",
    },
  },
  "event-seller-custody-v1:handoff-finance": {
    acceptedChoiceId: "reconcile-handoff",
    rejectedFeedback: {
      "close-anyway":
        "Remaining custody prevents closure. Expected totals do not replace actual outcomes, and only independent Finance can approve settlement.",
    },
  },
} as const;
