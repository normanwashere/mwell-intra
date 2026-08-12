import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION,
  validateWarehouseOperatorReceivingCatalog,
} from "./warehouse-operator-receiving-certification-catalog.mjs";

const EXPECTED_REQUIREMENTS = [
  "internal.operations_associate.orientation.v1",
  "internal.warehouse.receiving-custody-policy.v1",
  "internal.warehouse.receiving-controls-assessment.v1",
  "internal.role.warehouse.warehouse_operator.capability-practice.v1",
];

test("defines the exact governed Warehouse Operator receiving curriculum", () => {
  const catalog = WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION;

  assert.equal(catalog.audience, "internal");
  assert.deepEqual(catalog.role, {
    module: "warehouse",
    role: "warehouse_operator",
  });
  assert.deepEqual(
    catalog.requirements.map(({ requirementKey }) => requirementKey),
    EXPECTED_REQUIREMENTS,
  );
  assert.deepEqual(
    catalog.requirements.map(({ sortOrder }) => sortOrder),
    [0, 1, 2, 3],
  );
  assert.deepEqual(catalog.prerequisites, [
    {
      requirementKey: EXPECTED_REQUIREMENTS[1],
      prerequisiteRequirementKey: EXPECTED_REQUIREMENTS[0],
    },
    {
      requirementKey: EXPECTED_REQUIREMENTS[2],
      prerequisiteRequirementKey: EXPECTED_REQUIREMENTS[1],
    },
    {
      requirementKey: EXPECTED_REQUIREMENTS[3],
      prerequisiteRequirementKey: EXPECTED_REQUIREMENTS[2],
    },
  ]);
  assert.doesNotThrow(() => validateWarehouseOperatorReceivingCatalog(catalog));
});

test("binds the policy to one canonical controlled document", () => {
  const policy = WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION.requirements[1];

  assert.equal(policy.kind, "policy");
  assert.equal(policy.contentReference, "OPS-WH-RCV-001@4.2");
  assert.deepEqual(policy.sourceReferences, [
    {
      type: "controlled_document",
      controlled_document_id: "OPS-WH-RCV-001",
      controlled_document_version: "4.2",
      evidence_hash:
        "9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0",
    },
  ]);
});

test("keeps the assessment answer key private and fixes its authority limits", () => {
  const assessment = WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION.requirements[2];

  assert.equal(assessment.kind, "assessment");
  assert.equal(assessment.passingScore, 80);
  assert.equal(assessment.maxAttempts, 3);
  assert.deepEqual(assessment.assessmentSettings, {
    question_ids: ["receiving-identifiers", "receiving-exception"],
  });
  assert.equal(
    JSON.stringify(assessment.assessmentSettings).includes(
      "capture-identifiers",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(assessment.assessmentSettings).includes(
      "controlled-quality",
    ),
    false,
  );
  assert.deepEqual(assessment.privateAnswerKey, {
    "receiving-identifiers": "capture-identifiers",
    "receiving-exception": "controlled-quality",
  });
});

test("requires the receiving simulation checkpoints before receive_stock certification", () => {
  const scenario = WAREHOUSE_OPERATOR_RECEIVING_CERTIFICATION.requirements[3];

  assert.equal(scenario.kind, "scenario");
  assert.equal(scenario.simulationId, "warehouse-receiving-v1");
  assert.deepEqual(scenario.passRules, {
    required_checkpoints: ["draft-saved", "complete"],
    checkpoint_outcomes: { complete: ["receive_stock"] },
  });
  assert.deepEqual(scenario.capabilityOutcome, {
    module: "warehouse",
    capability: "receive_stock",
  });
});

test("exposes dedicated governed publication and applied verification commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    packageJson.scripts["publish:warehouse-operator-receiving-certification"],
    "node scripts/publish-warehouse-operator-receiving-certification.mjs",
  );
  assert.equal(
    packageJson.scripts[
      "verify:warehouse-operator-receiving-certification-applied"
    ],
    "node scripts/verify-warehouse-operator-receiving-certification-applied.mjs",
  );
  assert.equal(
    packageJson.scripts["test:warehouse-operator-receiving-certification"],
    "node --test scripts/warehouse-operator-receiving-certification.test.mjs scripts/publish-warehouse-operator-receiving-certification.test.mjs",
  );
});
