import { MODULES, MODULE_LIST } from "@intra/rbac";

import { OPERATING_PERSONA_IDS } from "./personas";
import type {
  CurriculumDefinition,
  LearningCapability,
  RequirementDefinition,
  SimulationDefinition,
} from "./types";

const READ_ONLY_CAPABILITY_KEYS = new Set([
  "core:view_directory",
  "core:view_vendors",
  "core:view_documents",
  "core:view_own_accreditation",
  "core:view_approvals",
  "core:view_audit",
  "warehouse:view_dashboard",
  "warehouse:view_inventory",
  "warehouse:view_finance",
  "warehouse:view_analytics",
  "warehouse:view_procurement",
  "warehouse:view_pricing",
  "warehouse:view_exceptions",
  "procurement:view_dashboard",
  "procurement:view_finance",
  "legal:view_dashboard",
  "events:view_events",
  "insights:view_warehouse",
  "insights:view_procurement",
  "insights:view_legal",
  "insights:view_finance",
  "insights:view_executive",
  "insights:prepare_exports",
  "product:view_readiness",
  "product:view_pricing",
]);

export function capabilityKey(capability: LearningCapability): string {
  return `${capability.module}:${capability.capability}`;
}

export const MUTATING_CAPABILITIES: readonly LearningCapability[] =
  MODULE_LIST.flatMap((module) =>
    MODULES[module].capabilities
      .map((capability) => ({ module, capability }))
      .filter((capability) => !READ_ONLY_CAPABILITY_KEYS.has(capabilityKey(capability))),
  );

const capability = (module: LearningCapability["module"], name: string): LearningCapability => ({
  module,
  capability: name,
});

const INTERNAL_PERSONA_CAPABILITIES: Readonly<Record<string, readonly LearningCapability[]>> = {
  platform_administrator: [
    capability("core", "manage_rbac"),
    capability("core", "manage_accreditation"),
    capability("core", "manage_documents"),
    capability("core", "manage_approvals"),
    capability("core", "record_approval"),
    capability("core", "manage_notifications"),
    capability("events", "admin"),
    capability("insights", "admin"),
  ],
  general_employee: [
    capability("procurement", "create_request"),
    capability("warehouse", "request_fulfillment"),
    capability("warehouse", "request_stock"),
    capability("warehouse", "submit_return_case"),
    capability("events", "create_event"),
    capability("events", "request_fulfillment"),
  ],
  operations_associate: [
    capability("warehouse", "receive_stock"),
    capability("warehouse", "manage_inventory"),
    capability("warehouse", "cycle_count"),
    capability("warehouse", "manage_returns"),
    capability("warehouse", "reserve_allocate"),
    capability("warehouse", "issue_items"),
    capability("warehouse", "transfer_stock"),
    capability("warehouse", "inspect_quality"),
  ],
  operations_lead: [
    capability("warehouse", "manage_products"),
    capability("warehouse", "manage_locations"),
    capability("warehouse", "manage_operation_routes"),
    capability("warehouse", "release_quality_hold"),
    capability("warehouse", "approve_stock_adjustment"),
    capability("warehouse", "resolve_exceptions"),
    capability("warehouse", "import_warehouse_data"),
  ],
  procurement_lead: [
    capability("core", "manage_vendors"),
    capability("procurement", "manage_rfp"),
    capability("procurement", "author_po"),
    capability("procurement", "approve_request"),
    capability("procurement", "approve_award"),
    capability("procurement", "manage_vendors"),
    capability("procurement", "admin"),
  ],
  finance_controller: [
    capability("warehouse", "manage_finance_close"),
    capability("warehouse", "approve_stock_adjustment_finance"),
    capability("events", "approve_settlement"),
  ],
  legal_compliance_lead: [
    capability("legal", "review_accreditation"),
    capability("legal", "manage_checklist"),
    capability("legal", "approve_accreditation"),
    capability("legal", "manage_documents"),
    capability("legal", "manage_doa"),
    capability("legal", "admin"),
  ],
  marketing_events_lead: [
    capability("events", "manage_events"),
    capability("events", "close_event"),
  ],
  product_owner: [
    capability("warehouse", "set_pricing"),
    capability("product", "prepare_readiness"),
    capability("product", "decide_go_live"),
    capability("product", "acknowledge_operations_handoff"),
    capability("product", "propose_pricing"),
    capability("product", "approve_pricing"),
  ],
  leadership_insights: [],
};

const VENDOR_CAPABILITIES = [
  capability("core", "submit_documents"),
  capability("core", "submit_accreditation"),
];

const internalRequirement = (
  personaId: string,
  suffix: "orientation" | "capability-practice",
  capabilityOutcomes: readonly LearningCapability[] = [],
): RequirementDefinition => ({
  id: `internal.${personaId}.${suffix}.v1`,
  version: 1,
  audience: "internal",
  kind: suffix === "orientation" ? "orientation" : "scenario",
  title: suffix === "orientation" ? "Role orientation" : "Capability practice",
  mandatory: true,
  prerequisiteIds:
    suffix === "orientation" ? [] : [`internal.${personaId}.orientation.v1`],
  capabilityOutcomes,
  ...(suffix === "capability-practice"
    ? { simulationId: `internal.${personaId}.capability-practice.v1` }
    : {}),
});

const internalRequirements = OPERATING_PERSONA_IDS.filter(
  (personaId) => personaId !== "vendor_representative",
).flatMap((personaId) => [
  internalRequirement(personaId, "orientation"),
  internalRequirement(
    personaId,
    "capability-practice",
    INTERNAL_PERSONA_CAPABILITIES[personaId] ?? [],
  ),
]);

const vendorRequirements: readonly RequirementDefinition[] = [
  {
    id: "vendor.vendor_representative.orientation.v1",
    version: 1,
    audience: "vendor",
    kind: "orientation",
    title: "Vendor accreditation orientation",
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [],
  },
  {
    id: "vendor.vendor_representative.capability-practice.v1",
    version: 1,
    audience: "vendor",
    kind: "scenario",
    title: "Vendor accreditation capability practice",
    mandatory: true,
    prerequisiteIds: ["vendor.vendor_representative.orientation.v1"],
    capabilityOutcomes: VENDOR_CAPABILITIES,
    simulationId: "vendor.vendor_representative.capability-practice.v1",
  },
];

const requirements = [...internalRequirements, ...vendorRequirements] as const;

const curricula: readonly CurriculumDefinition[] = OPERATING_PERSONA_IDS.map(
  (personaId) => {
    const audience = personaId === "vendor_representative" ? "vendor" : "internal";
    const prefix = audience === "vendor" ? "vendor" : "internal";
    return {
      id: `${prefix}.${personaId}.baseline.v1`,
      version: 1,
      personaId,
      audience,
      requirementIds: [
        `${prefix}.${personaId}.orientation.v1`,
        `${prefix}.${personaId}.capability-practice.v1`,
      ],
    };
  },
);

const simulations: readonly SimulationDefinition[] = requirements.flatMap(
  (requirement) => {
    if (!requirement.simulationId) return [];
    const firstCapability = requirement.capabilityOutcomes[0];
    if (!firstCapability) return [];
    return [
      {
        id: requirement.simulationId,
        version: 1,
        audience: requirement.audience,
        module: firstCapability.module,
        title: requirement.title,
        checkpointIds: ["complete"],
        capabilityOutcomes: requirement.capabilityOutcomes,
      },
    ];
  },
);

export const LEARNING_CATALOG = {
  curricula,
  requirements,
  simulations,
} as const;

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

  return LEARNING_CATALOG.curricula.filter((curriculum) =>
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
