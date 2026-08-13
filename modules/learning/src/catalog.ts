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
  const simulationId =
    roleDefinition.module === "warehouse" &&
    roleDefinition.role === "warehouse_operator"
      ? "warehouse-receiving-v1"
      : id;
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
    simulationId: id,
  } satisfies RequirementDefinition;
});

const requirements = [
  ...baselineRequirements,
  ...vendorJourneyRequirements,
  ...warehouseReceivingRequirements,
  ...capabilityRequirements,
  ...unassignedCapabilityRequirements,
] as const;

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

const simulations: readonly SimulationDefinition[] = requirements.flatMap(
  (requirement) => {
    if (!requirement.simulationId) return [];
    const firstCapability = requirement.capabilityOutcomes[0];
    return [
      {
        id: requirement.simulationId,
        version: 1,
        audience: requirement.audience,
        module: firstCapability?.module ?? "core",
        title: requirement.title,
        checkpointIds:
          requirement.simulationId === "warehouse-receiving-v1"
            ? ["draft-saved", "complete"]
            : ["complete"],
        capabilityOutcomes: requirement.capabilityOutcomes,
      },
    ];
  },
);

export const LEARNING_CATALOG = {
  curricula,
  roleCurricula: ROLE_CURRICULA,
  capabilityCoverageCurricula: CAPABILITY_COVERAGE_CURRICULA,
  requirements,
  simulations,
} as const;

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
