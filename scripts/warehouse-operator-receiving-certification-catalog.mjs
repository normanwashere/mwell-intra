import assert from "node:assert/strict";

const POLICY_HASH =
  "9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION = deepFreeze({
  catalogKey:
    "internal.warehouse.warehouse_operator.receiving-certification.v1",
  version: 1,
  audience: "internal",
  governanceOwner: "platform",
  role: { module: "warehouse", role: "warehouse_operator" },
  requirements: [
    {
      requirementKey: "internal.operations_associate.orientation.v1",
      version: 1,
      kind: "orientation",
      sortOrder: 0,
      existing: true,
    },
    {
      requirementKey: "internal.warehouse.receiving-custody-policy.v1",
      version: 1,
      kind: "policy",
      governanceOwner: "platform",
      title: "Warehouse receiving custody policy",
      contentReference: "OPS-WH-RCV-001@4.2",
      assessmentSettings: {},
      passRules: {},
      estimatedMinutes: 8,
      waivable: false,
      sortOrder: 1,
      sourceReferences: [
        {
          type: "controlled_document",
          controlled_document_id: "OPS-WH-RCV-001",
          controlled_document_version: "4.2",
          evidence_hash: POLICY_HASH,
        },
      ],
    },
    {
      requirementKey: "internal.warehouse.receiving-controls-assessment.v1",
      version: 1,
      kind: "assessment",
      governanceOwner: "platform",
      title: "Warehouse receiving controls knowledge check",
      assessmentSettings: {
        question_ids: ["receiving-identifiers", "receiving-exception"],
      },
      passRules: {},
      passingScore: 80,
      maxAttempts: 3,
      estimatedMinutes: 5,
      waivable: false,
      sortOrder: 2,
      sourceReferences: [
        { type: "controlled_document", id: "OPS-WH-RCV-001", version: "4.2" },
      ],
      privateAnswerKey: {
        "receiving-identifiers": "capture-identifiers",
        "receiving-exception": "controlled-quality",
      },
    },
    {
      requirementKey:
        "internal.role.warehouse.warehouse_operator.capability-practice.v1",
      version: 1,
      kind: "scenario",
      governanceOwner: "platform",
      title: "Warehouse receiving capability practice",
      simulationId: "warehouse-receiving-v1",
      assessmentSettings: {},
      passRules: {
        required_checkpoints: ["draft-saved", "complete"],
        checkpoint_outcomes: { complete: ["receive_stock"] },
      },
      estimatedMinutes: 10,
      waivable: false,
      sortOrder: 3,
      sourceReferences: [
        {
          type: "application_simulation",
          id: "warehouse-receiving-v1",
          version: 1,
        },
      ],
      capabilityOutcome: { module: "warehouse", capability: "receive_stock" },
    },
  ],
  prerequisites: [
    {
      requirementKey: "internal.warehouse.receiving-custody-policy.v1",
      prerequisiteRequirementKey:
        "internal.operations_associate.orientation.v1",
    },
    {
      requirementKey: "internal.warehouse.receiving-controls-assessment.v1",
      prerequisiteRequirementKey:
        "internal.warehouse.receiving-custody-policy.v1",
    },
    {
      requirementKey:
        "internal.role.warehouse.warehouse_operator.capability-practice.v1",
      prerequisiteRequirementKey:
        "internal.warehouse.receiving-controls-assessment.v1",
    },
  ],
});

export const CI_WAREHOUSE_OPERATOR = deepFreeze({
  id: "a1200000-0000-4000-8000-000000000001",
  email: "warehouse.operator@ci.mwell.test",
});

export const CI_WAREHOUSE_DEPARTMENT_ID =
  "a1200000-0000-4000-8000-000000000002";

export function validateWarehouseOperatorReceivingCatalog(catalog) {
  const requirementKeys = catalog.requirements.map(
    (item) => item.requirementKey,
  );
  assert.equal(catalog.audience, "internal");
  assert.deepEqual(catalog.role, {
    module: "warehouse",
    role: "warehouse_operator",
  });
  assert.equal(new Set(requirementKeys).size, 4);
  assert.deepEqual(
    catalog.requirements.map((item) => item.sortOrder),
    [0, 1, 2, 3],
  );
  assert.equal(catalog.requirements[0].existing, true);
  assert.equal(catalog.requirements[1].contentReference, "OPS-WH-RCV-001@4.2");
  assert.equal(
    catalog.requirements[1].sourceReferences[0].evidence_hash,
    POLICY_HASH,
  );
  assert.equal(catalog.requirements[2].passingScore, 80);
  assert.equal(catalog.requirements[2].maxAttempts, 3);
  assert.deepEqual(catalog.requirements[3].passRules.required_checkpoints, [
    "draft-saved",
    "complete",
  ]);
  assert.deepEqual(catalog.requirements[3].capabilityOutcome, {
    module: "warehouse",
    capability: "receive_stock",
  });
  assert.equal(catalog.prerequisites.length, 3);
  for (const edge of catalog.prerequisites) {
    assert.ok(requirementKeys.includes(edge.requirementKey));
    assert.ok(requirementKeys.includes(edge.prerequisiteRequirementKey));
    assert.notEqual(edge.requirementKey, edge.prerequisiteRequirementKey);
  }
  const serializedPublicAssessment = JSON.stringify(
    catalog.requirements[2].assessmentSettings,
  );
  for (const answer of Object.values(
    catalog.requirements[2].privateAnswerKey,
  )) {
    assert.equal(serializedPublicAssessment.includes(answer), false);
  }
  return catalog;
}

validateWarehouseOperatorReceivingCatalog(
  WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION,
);
