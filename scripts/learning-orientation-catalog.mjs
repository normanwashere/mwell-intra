const ROLES_BY_PERSONA = Object.freeze({
  platform_administrator: [["core", "platform_admin"]],
  general_employee: [
    ["core", "staff"],
    ["warehouse", "operations"],
    ["warehouse", "business_unit"],
    ["procurement", "requester"],
    ["events", "requester"],
  ],
  operations_associate: [["warehouse", "warehouse_operator"]],
  operations_lead: [
    ["warehouse", "warehouse_supervisor"],
    ["warehouse", "logistics_supervisor"],
    ["warehouse", "warehouse_admin"],
    ["procurement", "approver"],
    ["product", "operations_partner"],
  ],
  procurement_lead: [
    ["warehouse", "procurement"],
    ["procurement", "procurement_officer"],
    ["procurement", "admin"],
  ],
  finance_controller: [
    ["warehouse", "finance"],
    ["procurement", "finance"],
    ["events", "finance_reviewer"],
  ],
  legal_compliance_lead: [
    ["legal", "legal_reviewer"],
    ["legal", "compliance"],
    ["legal", "admin"],
  ],
  marketing_events_lead: [
    ["warehouse", "marketing"],
    ["events", "coordinator"],
    ["events", "admin"],
  ],
  product_owner: [
    ["warehouse", "pricing"],
    ["product", "contributor"],
    ["product", "product_owner"],
  ],
  leadership_insights: [
    ["warehouse", "bi_analyst"],
    ["events", "viewer"],
    ["insights", "analyst"],
    ["insights", "manager"],
    ["insights", "executive"],
    ["insights", "admin"],
  ],
  vendor_representative: [["core", "vendor_portal"]],
});

export const ORIENTATION_CATALOG = Object.freeze([
  "platform_administrator",
  "general_employee",
  "operations_associate",
  "operations_lead",
  "procurement_lead",
  "finance_controller",
  "legal_compliance_lead",
  "marketing_events_lead",
  "product_owner",
  "leadership_insights",
  "vendor_representative",
].map((personaId) => {
  const audience = personaId === "vendor_representative" ? "vendor" : "internal";
  const requirementKey = `${audience}.${personaId}.orientation.v1`;
  return Object.freeze({
    personaId,
    audience,
    requirementKey,
    curriculumKey: `${audience}.${personaId}.baseline.v1`,
    title: audience === "vendor" ? "Vendor accreditation orientation" : "Role orientation",
    version: 1,
    simulationId: requirementKey,
    checkpointIds: Object.freeze(["complete"]),
    roles: Object.freeze(
      ROLES_BY_PERSONA[personaId].map(([module, role]) =>
        Object.freeze({ module, role }),
      ),
    ),
  });
}));

export const CI_ORIENTATION_OWNER = Object.freeze({
  id: "a1100000-0000-4000-8000-000000000001",
  email: "learning.owner@ci.mwell.test",
});

export const CI_ORIENTATION_REVIEWER = Object.freeze({
  id: "a1100000-0000-4000-8000-000000000002",
  email: "learning.reviewer@ci.mwell.test",
});

export const CI_ORIENTATION_DEPARTMENT_ID =
  "a1100000-0000-4000-8000-000000000003";
