function persona(role, email, assignments, departmentCode, options = {}) {
  return {
    role,
    email,
    assignments,
    departmentCode,
    kind: options.kind ?? "employee",
    title: options.title ?? role.replaceAll("_", " "),
  };
}

// UAT exposes job-based personas, while the assignments retain the granular
// roles used by the authorization engine. This keeps the test roster lean
// without weakening module boundaries or governed handoffs.
export const CURRENT_LIVE_ROLES = [
  persona(
    "platform_administrator",
    "intra.test.admin@mwell.com.ph",
    { core: ["staff", "platform_admin"] },
    "technology",
    { title: "Platform Administrator" },
  ),
  persona(
    "general_employee",
    "intra.test.employee@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["requester"],
      events: ["requester"],
      warehouse: ["business_unit"],
      product: ["contributor"],
    },
    "operations",
    { title: "General Employee" },
  ),
  persona(
    "operations_associate",
    "intra.test.operations.associate@mwell.com.ph",
    {
      core: ["staff"],
      warehouse: ["warehouse_operator", "operations"],
    },
    "operations.warehouse_logistics",
    { title: "Operations Associate" },
  ),
  persona(
    "operations_lead",
    "intra.test.operations.lead@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["approver"],
      warehouse: ["warehouse_supervisor", "logistics_supervisor"],
      product: ["operations_partner"],
    },
    "operations.warehouse_logistics",
    { title: "Operations Lead" },
  ),
  persona(
    "procurement_lead",
    "intra.test.procurement.lead@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["procurement_officer", "admin"],
      warehouse: ["procurement"],
    },
    "procurement",
    { title: "Procurement Lead" },
  ),
  persona(
    "finance_controller",
    "intra.test.finance@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["finance"],
      warehouse: ["finance"],
    },
    "finance",
    { title: "Finance Controller" },
  ),
  persona(
    "legal_compliance_lead",
    "intra.test.legal.lead@mwell.com.ph",
    {
      core: ["staff"],
      legal: ["legal_reviewer", "compliance", "admin"],
    },
    "legal_compliance",
    { title: "Legal & Compliance Lead" },
  ),
  persona(
    "marketing_events_lead",
    "intra.test.marketing.events@mwell.com.ph",
    {
      core: ["staff"],
      events: ["coordinator", "admin"],
      warehouse: ["marketing"],
    },
    "marketing",
    { title: "Marketing & Events Lead" },
  ),
  persona(
    "product_owner",
    "intra.test.product.owner@mwell.com.ph",
    {
      core: ["staff"],
      events: ["viewer"],
      product: ["product_owner"],
    },
    "product",
    { title: "Product Owner" },
  ),
  persona(
    "leadership_insights",
    "intra.test.leadership@mwell.com.ph",
    {
      core: ["staff"],
      insights: ["analyst", "manager", "executive"],
      warehouse: ["bi_analyst"],
    },
    "technology",
    { title: "Leadership / Insights" },
  ),
  persona(
    "vendor_representative",
    "intra.test.vendor@mwell.com.ph",
    { core: ["vendor_portal"] },
    null,
    { kind: "vendor", title: "Vendor Representative" },
  ),
];

export const REQUIRED_TRANSACTION_VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

function scenario(id, actors, cases, checkpoints, cleanup) {
  return {
    id,
    actors,
    viewports: REQUIRED_TRANSACTION_VIEWPORTS.map((item) => item.name),
    cases,
    checkpoints,
    cleanup,
  };
}

export const CURRENT_LIVE_SCENARIOS = [
  scenario(
    "identity-access",
    ["general_employee", "platform_administrator", "vendor_representative"],
    ["authorized", "unauthorized", "refresh"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
    ["browser-session"],
  ),
  scenario(
    "vendor-accreditation",
    ["legal_compliance_lead", "vendor_representative", "procurement_lead"],
    ["authorized", "unauthorized", "validation", "duplicate", "handoff"],
    ["invite-created", "case-visible", "application-readback", "legal-handoff"],
    ["legal.vendor_invites", "legal.accreditation_cases", "core.vendors"],
  ),
  scenario(
    "procurement-request-to-po",
    [
      "general_employee",
      "procurement_lead",
      "operations_lead",
      "finance_controller",
    ],
    [
      "authorized",
      "unauthorized",
      "validation",
      "correction",
      "refresh",
      "handoff",
    ],
    ["draft-created", "route-recorded", "approval-readback", "po-readback"],
    ["procurement.requests"],
  ),
  scenario(
    "warehouse-setup-receive-putaway",
    ["operations_lead", "procurement_lead", "operations_associate"],
    [
      "authorized",
      "unauthorized",
      "validation",
      "duplicate",
      "correction",
      "refresh",
      "handoff",
    ],
    [
      "bin-created",
      "receipt-created",
      "stock-ledger-posted",
      "putaway-visible",
    ],
    ["warehouse.storage_areas", "warehouse.receipts", "warehouse.movements"],
  ),
  scenario(
    "warehouse-quality-and-return",
    ["operations_lead", "operations_associate", "procurement_lead"],
    [
      "authorized",
      "unauthorized",
      "validation",
      "correction",
      "refresh",
      "handoff",
    ],
    ["inspection-created", "hold-or-release-recorded", "vendor-return-visible"],
    [
      "warehouse.quality_inspections",
      "warehouse.inventory_holds",
      "warehouse.vendor_returns",
    ],
  ),
  scenario(
    "warehouse-cycle-count",
    ["operations_associate", "operations_lead", "finance_controller"],
    [
      "authorized",
      "unauthorized",
      "validation",
      "correction",
      "refresh",
      "handoff",
    ],
    [
      "count-submitted",
      "supervisor-approved",
      "finance-control-enforced",
      "ledger-posted",
    ],
    ["warehouse.cycle_counts", "warehouse.stock_change_requests"],
  ),
  scenario(
    "warehouse-allocation-event-return",
    ["marketing_events_lead", "general_employee", "operations_associate"],
    ["authorized", "validation", "refresh", "handoff"],
    [
      "event-created",
      "event-visible-to-marketing",
      "warehouse-handoff-visible",
      "return-validation-enforced",
    ],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "admin-doa",
    ["platform_administrator", "legal_compliance_lead"],
    ["authorized", "validation", "refresh", "handoff"],
    ["draft-tier-created", "matrix-activated", "procurement-readback"],
    ["procurement.doa_matrices", "procurement.doa_assignments"],
  ),
  scenario(
    "events-request-to-warehouse-handoff",
    [
      "general_employee",
      "marketing_events_lead",
      "product_owner",
      "operations_associate",
    ],
    [
      "authorized",
      "unauthorized",
      "validation",
      "duplicate",
      "refresh",
      "handoff",
    ],
    [
      "event-created",
      "event-database-readback",
      "duplicate-replay-denied",
      "viewer-mutation-denied",
      "coordinator-refresh-readback",
      "warehouse-handoff-visible",
    ],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "insights-read-only-governance",
    ["leadership_insights"],
    ["authorized", "unauthorized", "refresh", "handoff"],
    [
      "role-scoped-snapshot",
      "cross-module-source-link",
      "mutation-denied",
      "refresh-consistent",
    ],
    ["browser-session"],
  ),
  scenario(
    "unified-finance-control-center",
    ["finance_controller"],
    ["authorized", "refresh", "handoff"],
    [
      "procurement-commitment-visible",
      "payment-readiness-visible",
      "warehouse-valuation-visible",
      "source-record-linked",
    ],
    ["browser-session"],
  ),
  scenario(
    "product-readiness-go-live-pricing",
    ["general_employee", "product_owner", "operations_lead"],
    [
      "authorized",
      "unauthorized",
      "validation",
      "duplicate",
      "stale",
      "refresh",
      "handoff",
    ],
    [
      "readiness-submitted",
      "readiness-approved",
      "pricing-submitted",
      "pricing-approved",
      "operations-handoff-acknowledged",
      "can-launch-readback",
    ],
    [
      "product.readiness_events",
      "product.readiness_packages",
      "product.price_events",
      "product.price_proposals",
    ],
  ),
];

function evidence(workflow, scenarioId, actors, cases, checkpoints) {
  return { workflow, scenarioId, actors, cases, checkpoints };
}

// This registry is the executable bridge between a scenario declaration and
// the workflow that proves it. A successful workflow only counts the evidence
// listed here; sharing a scenario id is intentionally insufficient.
export const WORKFLOW_SCENARIO_EVIDENCE = [
  evidence(
    "general employee identity and least privilege",
    "identity-access",
    ["general_employee"],
    ["authorized", "unauthorized", "refresh"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
  ),
  evidence(
    "platform administrator identity and session restoration",
    "identity-access",
    ["platform_administrator"],
    ["authorized", "unauthorized", "refresh"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
  ),
  evidence(
    "vendor identity and least privilege",
    "identity-access",
    ["vendor_representative"],
    ["authorized", "unauthorized", "refresh"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
  ),
  evidence(
    "legal vendor invite",
    "vendor-accreditation",
    ["legal_compliance_lead", "vendor_representative"],
    ["authorized", "validation", "duplicate", "handoff"],
    ["invite-created", "case-visible", "application-readback", "legal-handoff"],
  ),
  evidence(
    "procurement receipt authority denial",
    "vendor-accreditation",
    ["procurement_lead"],
    ["unauthorized"],
    [],
  ),
  evidence(
    "procurement request draft",
    "procurement-request-to-po",
    ["general_employee"],
    ["authorized", "validation"],
    ["draft-created"],
  ),
  evidence(
    "Task 3 payment readiness without acceptance denial",
    "procurement-request-to-po",
    ["procurement_lead"],
    ["unauthorized", "correction"],
    ["route-recorded"],
  ),
  evidence(
    "Task 3 approved amendment quantity growth approval",
    "procurement-request-to-po",
    ["operations_lead"],
    ["authorized", "handoff"],
    ["approval-readback"],
  ),
  evidence(
    "Unified Finance cross-module readback",
    "procurement-request-to-po",
    ["finance_controller"],
    ["refresh", "handoff"],
    ["po-readback"],
  ),
  evidence(
    "warehouse location creation",
    "warehouse-setup-receive-putaway",
    ["operations_lead"],
    ["authorized", "validation"],
    ["bin-created"],
  ),
  evidence(
    "warehouse bin creation",
    "warehouse-setup-receive-putaway",
    ["operations_lead"],
    ["authorized", "validation"],
    ["bin-created"],
  ),
  evidence(
    "Task 3 operator receipt transactions",
    "warehouse-setup-receive-putaway",
    ["operations_associate"],
    ["authorized", "validation", "duplicate", "correction", "refresh"],
    ["receipt-created", "stock-ledger-posted", "putaway-visible"],
  ),
  evidence(
    "procurement receipt authority denial",
    "warehouse-setup-receive-putaway",
    ["procurement_lead"],
    ["unauthorized", "handoff"],
    [],
  ),
  evidence(
    "warehouse quality validation",
    "warehouse-quality-and-return",
    ["operations_lead"],
    ["validation"],
    ["inspection-created"],
  ),
  evidence(
    "Task 3 Supervisor excess custody final disposition",
    "warehouse-quality-and-return",
    ["operations_lead"],
    ["authorized", "correction", "handoff"],
    ["hold-or-release-recorded"],
  ),
  evidence(
    "warehouse return validation",
    "warehouse-quality-and-return",
    ["operations_associate"],
    ["validation", "refresh"],
    ["vendor-return-visible"],
  ),
  evidence(
    "procurement receipt authority denial",
    "warehouse-quality-and-return",
    ["procurement_lead"],
    ["unauthorized"],
    [],
  ),
  evidence(
    "Task 3 operator receipt transactions",
    "warehouse-cycle-count",
    ["operations_associate"],
    ["authorized", "validation"],
    ["count-submitted"],
  ),
  evidence(
    "Task 3 supervisor quarantine and variance transactions",
    "warehouse-cycle-count",
    ["operations_lead"],
    ["authorized", "correction", "refresh", "handoff"],
    ["supervisor-approved", "ledger-posted"],
  ),
  evidence(
    "Task 3 Finance insufficient locked-stock denial",
    "warehouse-cycle-count",
    ["finance_controller"],
    ["unauthorized"],
    ["finance-control-enforced"],
  ),
  evidence(
    "warehouse event creation",
    "warehouse-allocation-event-return",
    ["general_employee"],
    ["authorized", "validation"],
    ["event-created"],
  ),
  evidence(
    "warehouse event role handoff",
    "warehouse-allocation-event-return",
    ["marketing_events_lead"],
    ["refresh", "handoff"],
    ["event-visible-to-marketing"],
  ),
  evidence(
    "Events-to-Warehouse operational handoff",
    "warehouse-allocation-event-return",
    ["operations_associate"],
    ["handoff"],
    ["warehouse-handoff-visible"],
  ),
  evidence(
    "warehouse return validation",
    "warehouse-allocation-event-return",
    ["operations_associate"],
    ["validation"],
    ["return-validation-enforced"],
  ),
  evidence(
    "department DOA creation",
    "admin-doa",
    ["platform_administrator"],
    ["authorized", "validation"],
    ["draft-tier-created", "matrix-activated"],
  ),
  evidence(
    "department DOA role handoff",
    "admin-doa",
    ["legal_compliance_lead"],
    ["refresh", "handoff"],
    ["procurement-readback"],
  ),
  evidence(
    "Events request creation and persistence readback",
    "events-request-to-warehouse-handoff",
    ["general_employee"],
    ["authorized", "validation", "duplicate"],
    ["event-created", "event-database-readback", "duplicate-replay-denied"],
  ),
  evidence(
    "Events viewer create denial",
    "events-request-to-warehouse-handoff",
    ["product_owner"],
    ["unauthorized"],
    ["viewer-mutation-denied"],
  ),
  evidence(
    "Events coordinator refresh and Warehouse handoff",
    "events-request-to-warehouse-handoff",
    ["marketing_events_lead"],
    ["refresh", "handoff"],
    ["coordinator-refresh-readback"],
  ),
  evidence(
    "Events-to-Warehouse operational handoff",
    "events-request-to-warehouse-handoff",
    ["operations_associate"],
    ["handoff"],
    ["warehouse-handoff-visible"],
  ),
  evidence(
    "leadership_insights Insights governance",
    "insights-read-only-governance",
    ["leadership_insights"],
    ["authorized", "unauthorized", "refresh", "handoff"],
    [
      "role-scoped-snapshot",
      "cross-module-source-link",
      "mutation-denied",
      "refresh-consistent",
    ],
  ),
  evidence(
    "Unified Finance cross-module readback",
    "unified-finance-control-center",
    ["finance_controller"],
    ["authorized", "refresh", "handoff"],
    [
      "procurement-commitment-visible",
      "payment-readiness-visible",
      "warehouse-valuation-visible",
      "source-record-linked",
    ],
  ),
  evidence(
    "Product contributor readiness and pricing submission",
    "product-readiness-go-live-pricing",
    ["general_employee"],
    ["authorized", "unauthorized", "validation"],
    ["readiness-submitted", "pricing-submitted"],
  ),
  evidence(
    "Product owner go-live and pricing decision",
    "product-readiness-go-live-pricing",
    ["product_owner"],
    ["authorized", "duplicate", "stale", "refresh"],
    ["readiness-approved", "pricing-approved"],
  ),
  evidence(
    "Operations Product handoff acknowledgement",
    "product-readiness-go-live-pricing",
    ["operations_lead"],
    ["unauthorized", "duplicate", "refresh", "handoff"],
    ["operations-handoff-acknowledged", "can-launch-readback"],
  ),
];

const evidenceByWorkflow = new Map();
for (const item of WORKFLOW_SCENARIO_EVIDENCE) {
  const entries = evidenceByWorkflow.get(item.workflow) ?? [];
  entries.push(item);
  evidenceByWorkflow.set(item.workflow, entries);
}

export function workflowScenarioEvidence(workflow) {
  return (evidenceByWorkflow.get(workflow) ?? []).map((item) => ({ ...item }));
}

function missing(required, covered) {
  const values = new Set(covered);
  return required.filter((item) => !values.has(item));
}

export function evaluateScenarioCoverage(
  workflows,
  requiredViewports = REQUIRED_TRANSACTION_VIEWPORTS.map((item) => item.name),
) {
  return CURRENT_LIVE_SCENARIOS.map((scenario) => {
    const perViewport = requiredViewports.map((viewport) => {
      const successful = workflows.filter(
        (workflow) => workflow.ok && workflow.viewport === viewport,
      );
      const evidenceRows = successful.flatMap((workflow) =>
        (workflow.scenarioEvidence ?? []).filter(
          (item) => item.scenarioId === scenario.id,
        ),
      );
      const coveredActors = [
        ...new Set(evidenceRows.flatMap((item) => item.actors ?? [])),
      ];
      const coveredCases = [
        ...new Set(evidenceRows.flatMap((item) => item.cases ?? [])),
      ];
      const coveredCheckpoints = [
        ...new Set(evidenceRows.flatMap((item) => item.checkpoints ?? [])),
      ];
      const gaps = {
        actors: missing(scenario.actors, coveredActors),
        cases: missing(scenario.cases, coveredCases),
        checkpoints: missing(scenario.checkpoints, coveredCheckpoints),
      };
      return {
        viewport,
        workflowCount: successful.length,
        coveredActors,
        coveredCases,
        coveredCheckpoints,
        missing: gaps,
        complete: Object.values(gaps).every((items) => items.length === 0),
      };
    });
    return {
      id: scenario.id,
      requiredViewports,
      perViewport,
      complete: perViewport.every((item) => item.complete),
    };
  });
}

export function scenarioCoverageFailures(coverage) {
  return coverage.flatMap((scenario) =>
    scenario.perViewport.flatMap((viewport) => {
      if (viewport.complete) return [];
      const details = Object.entries(viewport.missing)
        .filter(([, items]) => items.length)
        .map(([kind, items]) => `${kind}=${items.join(",")}`)
        .join("; ");
      return [
        `scenario ${scenario.id}/${viewport.viewport} incomplete: ${details}`,
      ];
    }),
  );
}

export function assertScenarioEvidenceRegistry() {
  const scenarioIds = new Set(CURRENT_LIVE_SCENARIOS.map((item) => item.id));
  for (const item of WORKFLOW_SCENARIO_EVIDENCE) {
    if (!scenarioIds.has(item.scenarioId)) {
      throw new Error(
        `${item.workflow} references unknown scenario ${item.scenarioId}.`,
      );
    }
  }
  const synthetic = REQUIRED_TRANSACTION_VIEWPORTS.flatMap((viewport) =>
    WORKFLOW_SCENARIO_EVIDENCE.map((item) => ({
      ok: true,
      viewport: viewport.name,
      scenarioEvidence: [item],
    })),
  );
  const failures = scenarioCoverageFailures(
    evaluateScenarioCoverage(synthetic),
  );
  if (failures.length) throw new Error(failures.join("\n"));
}

assertScenarioEvidenceRegistry();

export function createAuditRunId(now = new Date(), random = Math.random) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
  return `QA-${date}-${suffix}`;
}

export function assertAuditRunId(value) {
  if (!/^QA-\d{8}-[A-F0-9]{8}$/.test(value))
    throw new Error("AUDIT_RUN_ID must use QA-YYYYMMDD-8HEX format.");
  return value;
}
