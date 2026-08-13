import { CAPABILITY_CLASSIFICATIONS, roleCapabilities } from "@intra/rbac";

import { OPERATING_PERSONA_IDS } from "./personas";
import type {
  CurriculumDefinition,
  LearningCapability,
  RequirementDefinition,
  RoleCurriculumDefinition,
  SimulationDefinition,
} from "./types";
import {
  WAREHOUSE_RECEIVING_ASSESSMENT_ID,
  WAREHOUSE_RECEIVING_POLICY_ID,
} from "./content";

export function capabilityKey(capability: LearningCapability): string {
  return `${capability.module}:${capability.capability}`;
}

export const MUTATING_CAPABILITIES: readonly LearningCapability[] =
  CAPABILITY_CLASSIFICATIONS.filter((item) => item.access === "mutation").map(
    ({ module, capability }) => ({ module, capability }),
  );

export const ROLE_PERSONAS: Readonly<Record<string, string>> = {
  "core:platform_admin": "platform_administrator",
  "core:staff": "general_employee",
  "core:vendor_portal": "vendor_representative",
  "warehouse:warehouse_operator": "operations_associate",
  "warehouse:warehouse_supervisor": "operations_lead",
  "warehouse:logistics_supervisor": "operations_lead",
  "warehouse:operations": "general_employee",
  "warehouse:finance": "finance_controller",
  "warehouse:bi_analyst": "leadership_insights",
  "warehouse:business_unit": "general_employee",
  "warehouse:marketing": "marketing_events_lead",
  "warehouse:procurement": "procurement_lead",
  "warehouse:pricing": "product_owner",
  "warehouse:warehouse_admin": "operations_lead",
  "procurement:requester": "general_employee",
  "procurement:procurement_officer": "procurement_lead",
  "procurement:approver": "operations_lead",
  "procurement:finance": "finance_controller",
  "procurement:admin": "procurement_lead",
  "legal:legal_reviewer": "legal_compliance_lead",
  "legal:compliance": "legal_compliance_lead",
  "legal:admin": "legal_compliance_lead",
  "events:requester": "general_employee",
  "events:coordinator": "marketing_events_lead",
  "events:viewer": "leadership_insights",
  "events:finance_reviewer": "finance_controller",
  "events:admin": "marketing_events_lead",
  "insights:analyst": "leadership_insights",
  "insights:manager": "leadership_insights",
  "insights:executive": "leadership_insights",
  "insights:admin": "leadership_insights",
  "product:contributor": "product_owner",
  "product:product_owner": "product_owner",
  "product:operations_partner": "operations_lead",
};

const audienceForPersona = (personaId: string): "internal" | "vendor" =>
  personaId === "vendor_representative" ? "vendor" : "internal";

const orientationRequirement = (personaId: string): RequirementDefinition => {
  const audience = audienceForPersona(personaId);
  const id = `${audience}.${personaId}.orientation.v1`;
  return {
    id,
    version: 1,
    audience,
    kind: "orientation",
    title:
      audience === "vendor"
        ? "Vendor accreditation orientation"
        : "Role orientation",
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [],
    simulationId: id,
  };
};

const baselineRequirements = OPERATING_PERSONA_IDS.map(orientationRequirement);

const VENDOR_EVIDENCE_REQUIREMENT_ID =
  "vendor.vendor_representative.evidence-and-acknowledgments.v1";

const vendorJourneyRequirements: readonly RequirementDefinition[] = [
  {
    id: VENDOR_EVIDENCE_REQUIREMENT_ID,
    version: 1,
    audience: "vendor",
    kind: "attestation",
    title: "Vendor evidence and acknowledgments",
    mandatory: true,
    prerequisiteIds: ["vendor.vendor_representative.orientation.v1"],
    capabilityOutcomes: [],
  },
];

const warehouseReceivingRequirements: readonly RequirementDefinition[] = [
  {
    id: WAREHOUSE_RECEIVING_POLICY_ID,
    version: 1,
    audience: "internal",
    kind: "policy",
    title: "Warehouse receiving and custody policy",
    mandatory: true,
    prerequisiteIds: ["internal.operations_associate.orientation.v1"],
    capabilityOutcomes: [],
  },
  {
    id: WAREHOUSE_RECEIVING_ASSESSMENT_ID,
    version: 1,
    audience: "internal",
    kind: "assessment",
    title: "Warehouse receiving controls knowledge check",
    mandatory: true,
    prerequisiteIds: [WAREHOUSE_RECEIVING_POLICY_ID],
    capabilityOutcomes: [],
    passingScore: 80,
    maxAttempts: 3,
  },
];

const capabilityClassificationByKey = new Map(
  CAPABILITY_CLASSIFICATIONS.map((item) => [capabilityKey(item), item]),
);

const titleCaseIdentifier = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const ROLE_PRACTICE_CONTENT = {
  platform_administrator: {
    simulationId: "platform-access-governance-v1",
    title: "Govern access without operational authority",
    module: "core",
    steps: [
      ["review-access-scope", "Review requested access", "Confirm the requested role scope and accountable department before changing access."],
      ["confirm-independent-review", "Confirm independent review", "Route the change to a distinct reviewer and verify that platform administration does not inherit operational authority."],
    ],
  },
  general_employee: {
    simulationId: "employee-request-handoff-v1",
    title: "Create a governed request and handoff",
    module: "procurement",
    steps: [
      ["draft-source-request", "Draft the source request", "Record the business need, owner, required date, and supporting evidence on the authoritative request."],
      ["confirm-accountable-handoff", "Confirm the accountable handoff", "Send the request to its owning team without claiming approval or custody authority."],
    ],
  },
  operations_associate: {
    simulationId: "warehouse-receiving-v1",
    title: "Receive and inspect controlled stock",
    module: "warehouse",
    steps: [
      ["draft-saved", "Capture receipt evidence", "Record the delivery, identifiers, quantities, and initial custody state before submission."],
      ["complete", "Submit for independent disposition", "Submit the completed receipt while keeping quality disposition and exception approval separate."],
    ],
  },
  operations_lead: {
    simulationId: "operations-exception-review-v1",
    title: "Review custody exceptions independently",
    module: "warehouse",
    steps: [
      ["review-custody-evidence", "Review custody evidence", "Check source receipt, count, hold, and chain-of-custody evidence without rewriting operator facts."],
      ["record-independent-disposition", "Record an independent disposition", "Approve, reject, or return the exception with reason, owner, and recovery route."],
    ],
  },
  procurement_lead: {
    simulationId: "procurement-evidence-routing-v1",
    title: "Validate sourcing evidence and route approval",
    module: "procurement",
    steps: [
      ["validate-sourcing-evidence", "Validate sourcing evidence", "Confirm vendor, competition, policy exception, value, and source identifiers are complete and consistent."],
      ["route-independent-approval", "Route independent approval", "Send the governed record to the correct authority tier without self-approving configured evidence."],
    ],
  },
  finance_controller: {
    simulationId: "finance-independent-review-v1",
    title: "Perform an independent finance review",
    module: "procurement",
    steps: [
      ["reconcile-source-evidence", "Reconcile source evidence", "Match request, order, receipt, acceptance, invoice, and current policy authority before deciding."],
      ["record-finance-decision", "Record the finance decision", "Approve, reject, or return the pack with a reason while preserving segregation from preparation."],
    ],
  },
  legal_compliance_lead: {
    simulationId: "legal-controlled-review-v1",
    title: "Review controlled legal evidence",
    module: "legal",
    steps: [
      ["validate-controlled-evidence", "Validate controlled evidence", "Confirm current document versions, signatures, ownership, and accreditation facts before review."],
      ["record-legal-determination", "Record the legal determination", "Issue an attributable decision or correction request without replacing applicant evidence."],
    ],
  },
  marketing_events_lead: {
    simulationId: "event-fulfillment-reconciliation-v1",
    title: "Plan and reconcile event fulfillment",
    module: "events",
    steps: [
      ["plan-event-fulfillment", "Plan event fulfillment", "Link the event intent to approved stock, accountable owners, dates, and return expectations."],
      ["reconcile-event-custody", "Reconcile event custody", "Close the event only after issue, return, variance, and independent settlement evidence agree."],
    ],
  },
  product_owner: {
    simulationId: "product-governance-decision-v1",
    title: "Make an evidence-bound product decision",
    module: "product",
    steps: [
      ["review-launch-evidence", "Review launch evidence", "Check readiness, pricing, dependencies, effective dates, and independent operational evidence."],
      ["record-product-decision", "Record the product decision", "Approve, reject, or return the submitted version without editing the preparer's evidence."],
    ],
  },
  leadership_insights: {
    simulationId: "leadership-indicator-review-v1",
    title: "Interpret and escalate decision indicators",
    module: "insights",
    steps: [
      ["interpret-indicator-freshness", "Interpret indicator freshness", "Check definition, reporting window, provenance, no-data state, and privacy scope before relying on an indicator."],
      ["route-accountable-follow-up", "Route accountable follow-up", "Assign the source owner to investigate; a KPI is not approval evidence and does not authorize source edits."],
    ],
  },
  vendor_representative: {
    simulationId: "vendor-accreditation-submission-v1",
    title: "Prepare a complete accreditation submission",
    module: "core",
    steps: [
      ["prepare-accreditation-evidence", "Prepare accreditation evidence", "Review required fields, current documents, declarations, and authorized signatory evidence."],
      ["confirm-vendor-submission", "Confirm the vendor submission", "Submit the complete version for independent Legal review without changing reviewer-owned status."],
    ],
  },
} as const;

const rolePracticeTitle = (module: string, role: string): string => {
  if (module === "warehouse" && role === "warehouse_operator") {
    return "Receive and inspect controlled stock";
  }
  if (module === "core" && role === "vendor_portal") {
    return "Vendor accreditation submission practice";
  }
  const moduleLabel = module === "core" ? "Intra" : titleCaseIdentifier(module);
  return `${moduleLabel} ${titleCaseIdentifier(role)} guided practice`;
};

const roleDefinitions = Object.values(
  roleCapabilities.reduce<
    Record<
      string,
      { module: LearningCapability["module"]; role: string; personaId: string }
    >
  >((roles, grant) => {
    const key = `${grant.module}:${grant.role}`;
    const personaId = ROLE_PERSONAS[key];
    if (!personaId) {
      throw new Error(
        `Missing canonical persona mapping for RBAC role ${key}.`,
      );
    }
    roles[key] ??= { module: grant.module, role: grant.role, personaId };
    return roles;
  }, {}),
);

const capabilityRequirements = roleDefinitions.flatMap((roleDefinition) => {
  const capabilities = roleCapabilities
    .filter(
      (grant) =>
        grant.module === roleDefinition.module &&
        grant.role === roleDefinition.role,
    )
    .filter(
      (grant) =>
        capabilityClassificationByKey.get(`${grant.module}:${grant.cap}`)
          ?.access === "mutation",
    )
    .map((grant) => ({ module: grant.module, capability: grant.cap }));
  if (capabilities.length === 0) return [];

  const audience = audienceForPersona(roleDefinition.personaId);
  const id = `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.capability-practice.v1`;
  const simulationId = ROLE_PRACTICE_CONTENT[roleDefinition.personaId as keyof typeof ROLE_PRACTICE_CONTENT].simulationId;
  const prerequisiteIds = [
    `${audience}.${roleDefinition.personaId}.orientation.v1`,
    ...(roleDefinition.module === "warehouse" &&
    roleDefinition.role === "warehouse_operator"
      ? [WAREHOUSE_RECEIVING_POLICY_ID, WAREHOUSE_RECEIVING_ASSESSMENT_ID]
      : []),
    ...(roleDefinition.module === "core" &&
    roleDefinition.role === "vendor_portal"
      ? [VENDOR_EVIDENCE_REQUIREMENT_ID]
      : []),
  ];
  return [
    {
      id,
      version: 1,
      audience,
      kind: "scenario",
      title: rolePracticeTitle(roleDefinition.module, roleDefinition.role),
      mandatory: true,
      prerequisiteIds,
      capabilityOutcomes: capabilities,
      simulationId,
    } satisfies RequirementDefinition,
  ];
});

const grantedMutationKeys = new Set(
  roleCapabilities
    .filter(
      (grant) =>
        capabilityClassificationByKey.get(`${grant.module}:${grant.cap}`)
          ?.access === "mutation",
    )
    .map((grant) => `${grant.module}:${grant.cap}`),
);

const unassignedCapabilityRequirements = MUTATING_CAPABILITIES.filter(
  (capability) => !grantedMutationKeys.has(capabilityKey(capability)),
).map((capability) => {
  const id = `internal.unassigned.${capability.module}.${capability.capability}.capability-practice.v1`;
  return {
    id,
    version: 1,
    audience: "internal",
    kind: "scenario",
    title: `${titleCaseIdentifier(capability.module)} ${titleCaseIdentifier(capability.capability)} capability coverage`,
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [capability],
  } satisfies RequirementDefinition;
});

const requirements: readonly RequirementDefinition[] = [
  ...baselineRequirements,
  ...vendorJourneyRequirements,
  ...warehouseReceivingRequirements,
  ...capabilityRequirements,
  ...unassignedCapabilityRequirements,
];

const curricula: readonly CurriculumDefinition[] = OPERATING_PERSONA_IDS.map(
  (personaId) => {
    const audience =
      personaId === "vendor_representative" ? "vendor" : "internal";
    const prefix = audience === "vendor" ? "vendor" : "internal";
    return {
      id: `${prefix}.${personaId}.baseline.v1`,
      version: 1,
      personaId,
      audience,
      requirementIds: [`${prefix}.${personaId}.orientation.v1`],
    };
  },
);

export const ROLE_CURRICULA: readonly RoleCurriculumDefinition[] =
  roleDefinitions.map((roleDefinition) => {
    const audience = audienceForPersona(roleDefinition.personaId);
    const capabilityRequirementId = `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.capability-practice.v1`;
    return {
      id: `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.v1`,
      version: 1,
      personaId: roleDefinition.personaId,
      audience,
      module: roleDefinition.module,
      role: roleDefinition.role,
      requirementIds: [
        `${audience}.${roleDefinition.personaId}.orientation.v1`,
        ...(roleDefinition.module === "warehouse" &&
        roleDefinition.role === "warehouse_operator"
          ? [WAREHOUSE_RECEIVING_POLICY_ID, WAREHOUSE_RECEIVING_ASSESSMENT_ID]
          : []),
        ...(roleDefinition.module === "core" &&
        roleDefinition.role === "vendor_portal"
          ? [VENDOR_EVIDENCE_REQUIREMENT_ID]
          : []),
        ...(requirements.some(
          (requirement) => requirement.id === capabilityRequirementId,
        )
          ? [capabilityRequirementId]
          : []),
      ],
    };
  });

export const CAPABILITY_COVERAGE_CURRICULA: readonly CurriculumDefinition[] =
  unassignedCapabilityRequirements.map((requirement) => ({
    id: requirement.id.replace(".capability-practice", ""),
    version: 1,
    personaId: "capability_coverage",
    audience: requirement.audience,
    requirementIds: [requirement.id],
  }));

const orientationSimulations: readonly SimulationDefinition[] = baselineRequirements.map(
  (requirement) => ({
    id: requirement.simulationId!,
    version: 1,
    audience: requirement.audience,
    module: "core",
    title: requirement.title,
    checkpointIds: ["complete"],
    capabilityOutcomes: [],
  }),
);

const rolePractices = OPERATING_PERSONA_IDS.map((personaId) => {
  const content = ROLE_PRACTICE_CONTENT[personaId as keyof typeof ROLE_PRACTICE_CONTENT];
  const capabilityOutcomes = capabilityRequirements
    .filter((requirement) => requirement.simulationId === content.simulationId)
    .flatMap((requirement) => requirement.capabilityOutcomes)
    .filter(
      (capability, index, all) =>
        all.findIndex((candidate) => capabilityKey(candidate) === capabilityKey(capability)) === index,
    );
  const simulation: SimulationDefinition = {
    id: content.simulationId,
    version: 1,
    audience: audienceForPersona(personaId),
    module: content.module,
    title: content.title,
    checkpointIds: content.steps.map(([checkpointId]) => checkpointId),
    capabilityOutcomes,
    embeddedSteps: content.steps.map(([checkpointId, title, instruction]) => ({
      checkpointId,
      title,
      instruction,
      outcomeId: checkpointId,
    })),
  };
  return { personaId, simulation };
});

const simulations: readonly SimulationDefinition[] = [
  ...orientationSimulations,
  ...rolePractices.map((practice) => practice.simulation),
];

export const LEARNING_CATALOG = {
  curricula,
  roleCurricula: ROLE_CURRICULA,
  capabilityCoverageCurricula: CAPABILITY_COVERAGE_CURRICULA,
  requirements,
  simulations,
  rolePractices,
} as const;

export function simulationForRequirement(
  requirement: RequirementDefinition,
): SimulationDefinition | undefined {
  if (!requirement.simulationId) return undefined;
  return LEARNING_CATALOG.simulations.find(
    (simulation) => simulation.id === requirement.simulationId,
  );
}

export function supportsEmbeddedTraining(
  requirement: RequirementDefinition,
): boolean {
  if (
    requirement.kind === "orientation" &&
    requirement.capabilityOutcomes.length === 0
  ) return true;
  return Boolean(simulationForRequirement(requirement)?.embeddedSteps?.length);
}

export function roleCurriculumFor(
  module: LearningCapability["module"],
  role: string,
): RoleCurriculumDefinition | undefined {
  return ROLE_CURRICULA.find(
    (curriculum) => curriculum.module === module && curriculum.role === role,
  );
}

export function requiredCurriculaFor(
  capability: LearningCapability,
): readonly CurriculumDefinition[] {
  const requirementIds = new Set(
    LEARNING_CATALOG.requirements
      .filter(
        (requirement) =>
          requirement.mandatory &&
          requirement.capabilityOutcomes.some(
            (outcome) => capabilityKey(outcome) === capabilityKey(capability),
          ),
      )
      .map((requirement) => requirement.id),
  );

  return [
    ...LEARNING_CATALOG.curricula,
    ...ROLE_CURRICULA,
    ...CAPABILITY_COVERAGE_CURRICULA,
  ].filter((curriculum) =>
    curriculum.requirementIds.some((id) => requirementIds.has(id)),
  );
}

export function internalRequirementIds(): readonly string[] {
  return LEARNING_CATALOG.requirements
    .filter((requirement) => requirement.audience === "internal")
    .map((requirement) => requirement.id);
}

export function vendorRequirementIds(): readonly string[] {
  return LEARNING_CATALOG.requirements
    .filter((requirement) => requirement.audience === "vendor")
    .map((requirement) => requirement.id);
}
