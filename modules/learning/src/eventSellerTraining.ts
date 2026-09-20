import type {
  RequirementDefinition,
  RoleCurriculumDefinition,
  SimulationDefinition,
} from "./types";

export const EVENT_SELLER_REQUIREMENT_ID =
  "internal.role.events.seller.custody-practice.v1";
export const EVENT_SELLER_SIMULATION_ID = "event-seller-custody-v1";
const orientationId = "internal.general_employee.orientation.v1";
const capabilityOutcomes = [
  { module: "events", capability: "record_event_outcome" },
] as const;

export const EVENT_SELLER_SIMULATION: SimulationDefinition = {
  id: EVENT_SELLER_SIMULATION_ID,
  version: 1,
  audience: "internal",
  module: "events",
  title: "Record your event sales and giveaways",
  capabilityOutcomes,
  checkpointIds: [
    "verify-assignment",
    "verify-custody",
    "record-outcome",
    "retry-intent",
    "reverse-correction",
    "handoff-finance",
  ],
  embeddedSteps: [
    {
      checkpointId: "verify-assignment",
      outcomeId: "verify-assignment",
      title: "Confirm your named event assignment",
      instruction:
        "Use your own account. A seller role and learning completion do not replace an active, event-limited seller assignment with a validity window. A certified event owner manages the assignment and prospective event gate.",
      context:
        "You are assigned to Event A until 18:00. A colleague asks you to record Event B's sales using their account after your assignment expires.",
      question: "Which action preserves attribution and event scope?",
      choices: [
        {
          id: "share-account",
          label: "Use the colleague's account to keep selling",
        },
        {
          id: "confirm-own-event",
          label:
            "Use only your own active Event A assignment; request an authorized named assignment for any new scope",
        },
      ],
    },
    {
      checkpointId: "verify-custody",
      outcomeId: "verify-custody",
      title: "Check the issued allocation",
      instruction:
        "Post only against acknowledged custody issued to your event, within remaining quantity. Serialized items must be eligible, not already sold, given away, or returned. Do not create another warehouse issue.",
      context:
        "Your event received three serialized units. One was sold and one returned. A fourth serial belongs to another event's allocation.",
      question: "What can you record?",
      choices: [
        {
          id: "select-eligible",
          label:
            "Only the remaining eligible unit in your event's acknowledged allocation",
        },
        {
          id: "use-returned",
          label:
            "Any listed serial, including returned stock or another event's allocation",
        },
      ],
    },
    {
      checkpointId: "record-outcome",
      outcomeId: "record-outcome",
      title: "Distinguish a sale from a giveaway",
      instruction:
        "Record each actual outcome with its reference. A sale records the actual amount; a giveaway has zero amount. Do not relabel a sale, reuse another outcome's reference, or exceed the available custody.",
      context:
        "One eligible unit was sold for 1,200 and another was genuinely given away. Both need attributable outcome records.",
      question: "Which records accurately represent the handoff?",
      choices: [
        {
          id: "rename-sale",
          label:
            "Record both as zero-amount giveaways to simplify reconciliation",
        },
        {
          id: "record-actual",
          label:
            "Record a sale for 1,200 and a separate zero-amount giveaway with their actual references",
        },
      ],
    },
    {
      checkpointId: "retry-intent",
      outcomeId: "retry-intent",
      title: "Recover an uncertain submission",
      instruction:
        "Read back the original submission before retrying. Retry the same intent without creating a second outcome, movement, or issue. A duplicate reference is not a new sale.",
      context:
        "The network disconnects immediately after you submit a sale. You do not yet know whether it was recorded.",
      question: "What is the next action?",
      choices: [
        {
          id: "readback-retry",
          label:
            "Read back the original outcome and retry the same intent only if needed",
        },
        {
          id: "new-reference",
          label: "Change the reference and submit again as a new sale",
        },
      ],
    },
    {
      checkpointId: "reverse-correction",
      outcomeId: "reverse-correction",
      title: "Correct your own outcome with evidence",
      instruction:
        "An outcome is immutable. Correct your own eligible entry through an attributable reversal with a reason, then post the corrected outcome. Do not overwrite history or reverse another seller's entry.",
      context:
        "You discover that your own posted sale has the wrong amount. Another seller also reports a mistake in their own record.",
      question: "How do you correct the records?",
      choices: [
        {
          id: "overwrite-entry",
          label:
            "Edit both posted records directly to match the intended amounts",
        },
        {
          id: "reverse-own",
          label:
            "Reverse your own eligible entry with a reason and post its correction; refer the other seller's entry to its owner",
        },
      ],
    },
    {
      checkpointId: "handoff-finance",
      outcomeId: "handoff-finance",
      title: "Reconcile custody before independent settlement",
      instruction:
        "Remaining custody prevents closure. Reconcile sales, giveaways, returns, and exceptions with the accountable event and warehouse owners. Finance independently reviews authoritative totals; seller learning grants neither settlement approval nor event-management authority.",
      context:
        "Sales appear complete, but two issued units remain unreconciled. The expected sales total differs from recorded actual outcomes.",
      question: "How should the event proceed?",
      choices: [
        {
          id: "reconcile-handoff",
          label:
            "Keep closure blocked, reconcile remaining custody and actual records, and hand off to independent Finance review",
        },
        {
          id: "close-anyway",
          label:
            "Close using expected totals and approve the settlement yourself",
        },
      ],
    },
  ],
};

export const EVENT_SELLER_REQUIREMENT: RequirementDefinition = {
  id: EVENT_SELLER_REQUIREMENT_ID,
  version: 1,
  audience: "internal",
  kind: "scenario",
  title: EVENT_SELLER_SIMULATION.title,
  mandatory: true,
  prerequisiteIds: [orientationId],
  capabilityOutcomes,
  simulationId: EVENT_SELLER_SIMULATION_ID,
  requiredCheckpointIds: EVENT_SELLER_SIMULATION.checkpointIds,
  maxAttempts: 3,
};

// A separate role version leaves reviewed buyer/inspector/event-owner credit intact.
export const EVENT_SELLER_CURRICULUM: RoleCurriculumDefinition = {
  id: "internal.role.events.seller.v1",
  version: 1,
  personaId: "general_employee",
  audience: "internal",
  module: "events",
  role: "seller",
  requirementIds: [orientationId, EVENT_SELLER_REQUIREMENT_ID],
};
