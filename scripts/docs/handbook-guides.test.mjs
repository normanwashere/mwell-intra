import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { HANDBOOK_DOCUMENTS } from "./handbook-catalog.mjs";
import * as handbookGuideModel from "./handbook-guides.mjs";

const {
  HANDBOOK_GUIDES,
  HANDBOOK_MODES,
  LEGACY_ROUTES,
  validateHandbookGuides,
} = handbookGuideModel;

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const EXPECTED_TASK_IDS = [
  "procurement-request-approval",
  "vendor-accreditation-renewal",
  "warehouse-location-bin-setup",
  "stock-receiving-putaway",
  "ecommerce-order-intake",
  "ecommerce-fulfillment-delivery",
  "returns-replacements-refunds-rma",
  "department-inventory-release",
  "event-stock-custody",
  "inventory-count-variance",
  "department-doa-activation",
  "finance-readiness-evidence",
  "product-readiness-pricing-go-live",
];

const EXPECTED_ROLES = [
  ["platform_administrator", "Platform Administrator"],
  ["general_employee", "General Employee"],
  ["operations_associate", "Operations Associate"],
  ["operations_lead", "Operations Lead"],
  ["procurement_lead", "Procurement Lead"],
  ["finance_controller", "Finance Controller"],
  ["legal_compliance_lead", "Legal & Compliance Lead"],
  ["marketing_events_lead", "Marketing & Events Lead"],
  ["product_owner", "Product Owner"],
  ["leadership_insights", "Leadership / Insights"],
  ["vendor_representative", "Vendor Representative"],
];

const TASK_FIELDS = [
  "id",
  "outcome",
  "summary",
  "participatingRoles",
  "module",
  "startCondition",
  "requiredAccess",
  "inputsAndEvidence",
  "steps",
  "decisionPoints",
  "denialChecks",
  "recovery",
  "handoff",
  "completionCriteria",
  "completionEvidence",
  "governingSources",
  "relatedTasks",
  "keywords",
  "owner",
  "effectiveDate",
  "lastReviewedDate",
  "applicableBuild",
  "status",
  "availability",
];

const ROLE_FIELDS = [
  "id",
  "canonicalName",
  "displayedAliases",
  "purpose",
  "departmentAndScope",
  "assignmentOwner",
  "requiredAccess",
  "workQueueOrStartConditions",
  "linkedTasks",
  "permittedActions",
  "prohibitedActions",
  "authorityLimits",
  "handoffs",
  "denialChecks",
  "escalationAndRecovery",
  "evidenceResponsibilities",
  "trainingReadiness",
  "governingSources",
  "owner",
  "effectiveDate",
  "lastReviewedDate",
  "applicableBuild",
  "status",
  "availability",
  "workspaceMap",
  "guidedSimulation",
];

const STAGE_FIELDS = [
  "id",
  "label",
  "performingRole",
  "module",
  "route",
  "instruction",
  "screenshot",
  "expectedResult",
  "dataRead",
  "dataWritten",
  "evidenceRetained",
  "nextHandoff",
];

const DECISION_FIELDS = [
  "id",
  "placement",
  "ownerRole",
  "question",
  "yesBranch",
  "noBranch",
];

const DECISION_PLACEMENT_FIELDS = ["position", "stageId"];
const DECISION_BRANCH_FIELDS = [
  "label",
  "condition",
  "target",
  "outcome",
  "recoveryAction",
  "terminal",
];
const DECISION_TARGET_FIELDS = ["type", "id"];

const SIMULATION_FIELDS = [
  "id",
  "title",
  "linkedTaskId",
  "startRoute",
  "actorRole",
  "scenario",
  "successCriteria",
  "negativeScenario",
  "recovery",
];

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "document";
}

function legacyArticleId(source) {
  return `doc-${slug(source.replace(/^docs\//, ""))}`;
}

function markdownHeadings(source) {
  return [...source.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) => match[1]);
}

function legacyKey(route) {
  return JSON.stringify([
    route.legacyTabId,
    route.legacyArticleId,
    route.legacyHeadingId ?? null,
  ]);
}

function isPopulated(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function cloneGuides() {
  return structuredClone(HANDBOOK_GUIDES);
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : null;
}

function objectProperty(object, name) {
  return object.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  )?.initializer;
}

function variableInitializer(sourceFile, name) {
  let result = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      result = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}

function operatingPersonaContract() {
  const guideFile = path.join(root, "apps/shell/lib/knowledge/operatingPersonas.ts");
  const guideSource = ts.createSourceFile(
    guideFile,
    readFileSync(guideFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const guideObject = variableInitializer(guideSource, "OPERATING_PERSONA_GUIDES");
  assert.equal(ts.isObjectLiteralExpression(guideObject), true);

  const workspaces = new Map();
  for (const property of guideObject.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const tasks = objectProperty(property.initializer, "tasks");
    assert.equal(ts.isArrayLiteralExpression(tasks), true);
    const routes = tasks.elements.map((element) => {
      assert.equal(ts.isCallExpression(element), true);
      const route = element.arguments[3];
      assert.equal(ts.isStringLiteral(route), true);
      return route.text;
    });
    workspaces.set(propertyName(property.name), [...new Set(routes)]);
  }

  const personaFile = path.join(root, "modules/learning/src/personas.ts");
  const personaSource = ts.createSourceFile(
    personaFile,
    readFileSync(personaFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const personaArray = variableInitializer(personaSource, "OPERATING_PERSONAS");
  assert.equal(ts.isArrayLiteralExpression(personaArray), true);
  const personas = personaArray.elements.map((element) => {
    assert.equal(ts.isObjectLiteralExpression(element), true);
    const id = objectProperty(element, "id");
    const label = objectProperty(element, "label");
    assert.equal(ts.isStringLiteral(id), true);
    assert.equal(ts.isStringLiteral(label), true);
    return [id.text, label.text];
  });

  return { personas, workspaces };
}

function legacyRouteFor(source, heading) {
  const document = HANDBOOK_DOCUMENTS.find((item) => item.source === source);
  assert.ok(document, source);
  const articleId = legacyArticleId(source);
  const headingId = `${articleId}-${slug(heading)}`;
  return LEGACY_ROUTES.find(
    (route) =>
      route.legacyTabId === document.primaryTab &&
      route.legacyArticleId === articleId &&
      route.legacyHeadingId === headingId,
  );
}

const USER_MANUAL_OPERATIONAL_TARGETS = [
  ["Comprehensive Launch Flow", "tasks", "procurement-request-approval", "flow"],
  ["Procurement Flow", "tasks", "procurement-request-approval", "flow"],
  ["Procurement Role Procedures", "tasks", "procurement-request-approval", "who-is-involved"],
  ["Requester", "roles", "general_employee", "role-purpose-and-department"],
  ["Department Head", "roles", "operations_lead", "role-purpose-and-department"],
  ["Procurement Lead", "roles", "procurement_lead", "role-purpose-and-department"],
  ["Legal/Compliance", "roles", "legal_compliance_lead", "role-purpose-and-department"],
  ["Technical Reviewer", "tasks", "procurement-request-approval", "who-is-involved"],
  ["Warehouse/Operations", "roles", "operations_associate", "role-purpose-and-department"],
  ["Finance Controller", "roles", "finance_controller", "role-purpose-and-department"],
  ["Vendor Representative", "roles", "vendor_representative", "role-purpose-and-department"],
  ["Platform Admin", "roles", "platform_administrator", "role-purpose-and-department"],
  ["Vendor Accreditation Flow", "tasks", "vendor-accreditation-renewal", "flow"],
  ["Warehouse Flow", "tasks", "stock-receiving-putaway", "flow"],
  ["Setup and Bins", "tasks", "warehouse-location-bin-setup", "setup-and-bins"],
  ["Receiving and Inspection", "tasks", "stock-receiving-putaway", "steps"],
  ["Allocation, Events, and Returns", "tasks", "event-stock-custody", "steps"],
  ["Ecommerce Fulfillment and Pick & Pack", "tasks", "ecommerce-fulfillment-delivery", "steps"],
  ["Customer Returns and Original Release Matching", "tasks", "returns-replacements-refunds-rma", "steps"],
  ["Counts and Adjustments", "tasks", "inventory-count-variance", "counts-adjustments"],
  ["DOA Administration", "tasks", "department-doa-activation", "doa-administration"],
  ["Troubleshooting and Recovery", "system", "training-operational-readiness", "overview"],
  ["Flow-First Operational Journeys", "system", "training-operational-readiness", "overview"],
  ["Procurement to Payment", "tasks", "procurement-request-approval", "procure-to-payment"],
  ["Vendor Accreditation", "tasks", "vendor-accreditation-renewal", "vendor-accreditation"],
  ["Receiving and Putaway", "tasks", "stock-receiving-putaway", "receiving-putaway"],
  ["Ecommerce Fulfillment", "tasks", "ecommerce-fulfillment-delivery", "steps"],
  ["Returns and Replacements", "tasks", "returns-replacements-refunds-rma", "returns-replacements"],
  ["Inventory Release", "tasks", "department-inventory-release", "inventory-release"],
  ["Event Custody", "tasks", "event-stock-custody", "event-custody"],
  ["Inventory Integrity", "tasks", "inventory-count-variance", "inventory-integrity"],
];

const PROCESS_LIBRARY_OPERATIONAL_TARGETS = [
  ["Procurement Policy Operating Extract", "tasks", "procurement-request-approval", "procurement-policy-extract"],
  ["Canonical 13-step procurement-to-payment overview", "tasks", "procurement-request-approval", "flow"],
  ["Solicitation document and type classification", "tasks", "procurement-request-approval", "decisions-and-exceptions"],
  ["Bid quorum and failed-bid recovery", "tasks", "procurement-request-approval", "decisions-and-exceptions"],
  ["Exception eligibility", "tasks", "procurement-request-approval", "decisions-and-exceptions"],
  ["Best-value award and recommendation variance", "tasks", "procurement-request-approval", "decisions-and-exceptions"],
  ["Receiving, quality and RMA", "tasks", "stock-receiving-putaway", "receiving-quality-rma"],
  ["Payment evidence and file closure", "tasks", "finance-readiness-evidence", "payment-evidence"],
  ["Operating rules", "tasks", "procurement-request-approval", "policy-basis"],
  ["LGL004 Vendor Accreditation Operating Extract", "tasks", "vendor-accreditation-renewal", "vendor-operating-extract"],
  ["Common vendor facts and declarations", "tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  ["Entity evidence branches", "tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  ["Technology-provider qualification", "tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  ["Technology Provider MNDA Operating Extract", "tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  ["Ecommerce Tracker-to-Intra Mapping", "tasks", "ecommerce-order-intake", "tracker-mapping"],
];

test("publishes exactly four ordered public modes independent of legacy tabs", () => {
  assert.deepEqual(
    HANDBOOK_MODES.map(({ id, order }) => [id, order]),
    [
      ["home", 1],
      ["tasks", 2],
      ["roles", 3],
      ["system", 4],
    ],
  );
  assert.deepEqual(HANDBOOK_MODES.map(({ label }) => label), [
    "Home",
    "Tasks",
    "Roles",
    "System",
  ]);
});

test("publishes the 13 canonical task guides and eight required system groups", () => {
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "task").map(({ id }) => id),
    EXPECTED_TASK_IDS,
  );
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "system").map(({ id }) => id),
    [
      "administration-configuration",
      "training-operational-readiness",
      "architecture-data",
      "infrastructure-continuity",
      "security-governance",
      "release-qa",
      "imports",
      "source-references",
    ],
  );

  const systemById = new Map(
    HANDBOOK_GUIDES.filter(({ type }) => type === "system").map((guide) => [guide.id, guide]),
  );
  assert.ok(
    systemById.get("administration-configuration").sourceSections.some(
      ({ source, heading }) =>
        source === "docs/manual/MWELL_INTRA_USER_MANUAL.md" &&
        heading === "DOA Administration",
    ),
  );
  assert.ok(
    systemById.get("training-operational-readiness").sourceSections.some(
      ({ source, heading }) =>
        source === "docs/TRAINING_AND_HANDOVER_CONTENT.md" &&
        heading === "Training outcomes",
    ),
  );
});

test("publishes the exact current 11-persona role catalog", () => {
  const operatingContract = operatingPersonaContract();
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "role").map(
      ({ id, canonicalName }) => [id, canonicalName],
    ),
    operatingContract.personas,
  );
  assert.deepEqual(operatingContract.personas, EXPECTED_ROLES);

  for (const guide of HANDBOOK_GUIDES.filter(({ type }) => type === "role")) {
    assert.ok(Array.isArray(guide.workspaceMap), `${guide.id}.workspaceMap`);
    assert.deepEqual(
      guide.workspaceMap.map(({ landingRoute }) => landingRoute),
      operatingContract.workspaces.get(guide.id),
      guide.id,
    );
    assert.equal(
      guide.workspaceMap.every(({ module, landingRoute }) =>
        isPopulated(module) && /^\//.test(landingRoute)),
      true,
      guide.id,
    );
  }
});

test("guide metadata is deeply immutable and guide IDs are globally unique", () => {
  assertDeepFrozen(HANDBOOK_MODES);
  assertDeepFrozen(HANDBOOK_GUIDES);
  assertDeepFrozen(LEGACY_ROUTES);

  const ids = HANDBOOK_GUIDES.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test("task and role guides contain every required structured field", () => {
  for (const guide of HANDBOOK_GUIDES.filter(({ type }) => type === "task")) {
    for (const field of TASK_FIELDS) {
      assert.equal(isPopulated(guide[field]), true, `${guide.id}.${field}`);
    }
    assert.equal(guide.status, "current", `${guide.id}.status`);
    assert.equal(guide.availability, "implemented", `${guide.id}.availability`);
    for (const stage of guide.steps) {
      for (const field of STAGE_FIELDS) {
        assert.equal(isPopulated(stage[field]), true, `${guide.id}.${stage.id}.${field}`);
      }
      assert.equal(stage.route.startsWith("/"), true, `${guide.id}.${stage.id}.route`);
      assert.equal(stage.screenshot.status, "pending");
      assert.equal(stage.screenshot.path, null);
      assert.equal(stage.screenshot.target, null);
    }
    for (const decision of guide.decisionPoints) {
      for (const field of DECISION_FIELDS) {
        assert.equal(isPopulated(decision[field]), true, `${guide.id}.${decision.id}.${field}`);
      }
      for (const field of DECISION_PLACEMENT_FIELDS) {
        assert.equal(
          isPopulated(decision.placement[field]),
          true,
          `${guide.id}.${decision.id}.placement.${field}`,
        );
      }
      for (const branchName of ["yesBranch", "noBranch"]) {
        const branch = decision[branchName];
        for (const field of DECISION_BRANCH_FIELDS) {
          assert.equal(
            isPopulated(branch[field]),
            true,
            `${guide.id}.${decision.id}.${branchName}.${field}`,
          );
        }
        for (const field of DECISION_TARGET_FIELDS) {
          assert.equal(
            isPopulated(branch.target[field]),
            true,
            `${guide.id}.${decision.id}.${branchName}.target.${field}`,
          );
        }
      }
    }
  }

  for (const guide of HANDBOOK_GUIDES.filter(({ type }) => type === "role")) {
    for (const field of ROLE_FIELDS) {
      assert.equal(isPopulated(guide[field]), true, `${guide.id}.${field}`);
    }
    for (const field of SIMULATION_FIELDS) {
      assert.equal(
        isPopulated(guide.guidedSimulation[field]),
        true,
        `${guide.id}.guidedSimulation.${field}`,
      );
    }
  }
});

test("validation rejects missing or invalid decision placement and branch targets", () => {
  const cases = [
    ["missing placement stage", (decision) => {
      delete decision.placement.stageId;
    }, /decision decision-1 placement is missing required field stageId/],
    ["invalid placement stage", (decision) => {
      decision.placement.stageId = "step-99";
    }, /decision decision-1 uses missing placement stage step-99/],
    ["invalid placement position", (decision) => {
      decision.placement.position = "during";
    }, /decision decision-1 has invalid placement position during/],
    ["missing stage branch target", (decision) => {
      decision.yesBranch.target = { type: "stage", id: "step-99" };
    }, /decision decision-1 yesBranch targets missing stage step-99/],
    ["missing decision branch target", (decision) => {
      decision.noBranch.target = { type: "decision", id: "decision-99" };
    }, /decision decision-1 noBranch targets missing decision decision-99/],
    ["invalid terminal outcome", (decision) => {
      decision.noBranch.target = { type: "outcome", id: "pretend-success" };
      decision.noBranch.terminal = true;
    }, /decision decision-1 noBranch targets invalid outcome pretend-success/],
  ];

  for (const [label, mutate, expected] of cases) {
    const guides = cloneGuides();
    const decision = guides.find(({ id }) => id === "procurement-request-approval").decisionPoints[0];
    mutate(decision);
    assert.match(validateHandbookGuides({ guides }).errors.join("\n"), expected, label);
  }
});

test("strict task evidence coverage remains mechanically incomplete until Task 7", () => {
  assert.equal(typeof handbookGuideModel.validateHandbookEvidenceCoverage, "function");
  const result = handbookGuideModel.validateHandbookEvidenceCoverage();
  const taskSteps = HANDBOOK_GUIDES.filter(({ type }) => type === "task")
    .flatMap(({ steps }) => steps);

  assert.equal(result.warnings.length, 0);
  assert.equal(result.errors.length, taskSteps.length);
  assert.match(result.errors[0], /pending certified screenshot evidence/);
});

test("validation reports every missing required task stage field", () => {
  for (const field of STAGE_FIELDS) {
    const guides = cloneGuides();
    const stage = guides.find(({ type }) => type === "task").steps[0];
    delete stage[field];
    assert.match(
      validateHandbookGuides({ guides }).errors.join("\n"),
      new RegExp(`task procurement-request-approval stage step-1 is missing required field ${field}`),
      field,
    );
  }
});

test("validation reports every missing screenshot binding field", () => {
  for (const field of ["bindingId", "status", "path", "target"]) {
    const guides = cloneGuides();
    const screenshot = guides.find(({ type }) => type === "task").steps[0].screenshot;
    delete screenshot[field];
    assert.match(
      validateHandbookGuides({ guides }).errors.join("\n"),
      new RegExp(`task procurement-request-approval stage step-1 screenshot is missing required field ${field}`),
      field,
    );
  }
});

test("validation reports incomplete role workspace and guided simulation records", () => {
  for (const field of ["id", "module", "landingRoute"]) {
    const guides = cloneGuides();
    delete guides.find(({ type }) => type === "role").workspaceMap[0][field];
    assert.match(
      validateHandbookGuides({ guides }).errors.join("\n"),
      new RegExp(`role platform_administrator workspace .* is missing required field ${field}`),
      field,
    );
  }
  for (const field of SIMULATION_FIELDS) {
    const guides = cloneGuides();
    delete guides.find(({ type }) => type === "role").guidedSimulation[field];
    assert.match(
      validateHandbookGuides({ guides }).errors.join("\n"),
      new RegExp(`role platform_administrator guided simulation is missing required field ${field}`),
      field,
    );
  }
});

test("all related guides, governed sources, exact headings, and screenshots exist", () => {
  const guideIds = new Set(HANDBOOK_GUIDES.map(({ id }) => id));
  const sourceFiles = new Set(HANDBOOK_DOCUMENTS.map(({ source }) => source));

  for (const guide of HANDBOOK_GUIDES) {
    for (const relatedId of guide.relatedGuides) {
      assert.equal(guideIds.has(relatedId), true, `${guide.id} -> ${relatedId}`);
    }
    for (const source of guide.governingSources ?? []) {
      assert.equal(sourceFiles.has(source), true, `${guide.id} -> ${source}`);
    }
    for (const section of guide.sourceSections) {
      assert.equal(sourceFiles.has(section.source), true, `${guide.id} -> ${section.source}`);
      const absolute = path.join(root, section.source);
      assert.equal(existsSync(absolute), true, section.source);
      if (section.heading != null) {
        assert.equal(
          markdownHeadings(readFileSync(absolute, "utf8")).includes(section.heading),
          true,
          `${section.source}#${section.heading}`,
        );
      }
    }
    for (const screenshot of guide.screenshotReferences) {
      assert.equal(existsSync(path.join(root, screenshot)), true, screenshot);
    }
  }
});

test("every maintained source is traceable to at least one guide", () => {
  const mappedSources = new Set(
    HANDBOOK_GUIDES.flatMap((guide) => [
      ...guide.sourceSections.map(({ source }) => source),
      ...(guide.governingSources ?? []),
    ]),
  );
  assert.deepEqual(
    HANDBOOK_DOCUMENTS.map(({ source }) => source).filter((source) => !mappedSources.has(source)),
    [],
  );
});

test("legacy routes exhaustively translate every maintained article and Markdown heading", () => {
  const expected = [];
  for (const document of HANDBOOK_DOCUMENTS) {
    const articleId = legacyArticleId(document.source);
    expected.push(JSON.stringify([document.primaryTab, articleId, null]));
    if (!document.source.endsWith(".md")) continue;
    const source = readFileSync(path.join(root, document.source), "utf8");
    for (const heading of markdownHeadings(source)) {
      expected.push(JSON.stringify([
        document.primaryTab,
        articleId,
        `${articleId}-${slug(heading)}`,
      ]));
    }
  }

  assert.deepEqual(new Set(LEGACY_ROUTES.map(legacyKey)), new Set(expected));
  assert.equal(LEGACY_ROUTES.length, expected.length);
});

test("legacy workflow, role, and System headings resolve to their nearest canonical section", () => {
  const cases = [
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Procurement to Payment", "tasks", "procurement-request-approval", "procure-to-payment"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Vendor Accreditation", "tasks", "vendor-accreditation-renewal", "vendor-accreditation"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Receiving and Putaway", "tasks", "stock-receiving-putaway", "receiving-putaway"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Ecommerce Fulfillment", "tasks", "ecommerce-fulfillment-delivery", "steps"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Returns and Replacements", "tasks", "returns-replacements-refunds-rma", "returns-replacements"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Inventory Release", "tasks", "department-inventory-release", "inventory-release"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Event Custody", "tasks", "event-stock-custody", "event-custody"],
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", "Inventory Integrity", "tasks", "inventory-count-variance", "inventory-integrity"],
    ["docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Role Modules", "roles", "general_employee", "your-workspace"],
    ["docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Runtime architecture", "system", "architecture-data", "runtime-architecture"],
    ["docs/TRAINING_AND_HANDOVER_CONTENT.md", "Training outcomes", "system", "training-operational-readiness", "training-outcomes"],
  ];

  for (const [source, heading, modeId, guideId, headingId] of cases) {
    const route = legacyRouteFor(source, heading);
    assert.ok(route, `${source}#${heading}`);
    assert.deepEqual(
      { modeId: route.modeId, guideId: route.guideId, headingId: route.headingId },
      { modeId, guideId, headingId },
      `${source}#${heading}`,
    );
  }
});

test("every operational user-manual and process-library heading has a canonical target", () => {
  const sources = [
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", USER_MANUAL_OPERATIONAL_TARGETS],
    ["docs/PROCESS_REFERENCE_LIBRARY.md", PROCESS_LIBRARY_OPERATIONAL_TARGETS],
  ];
  for (const [source, cases] of sources) {
    for (const [heading, modeId, guideId, headingId] of cases) {
      const route = legacyRouteFor(source, heading);
      assert.ok(route, `${source}#${heading}`);
      assert.deepEqual(
        { modeId: route.modeId, guideId: route.guideId, headingId: route.headingId },
        { modeId, guideId, headingId },
        `${source}#${heading}`,
      );
    }
  }
});

test("no operational workflow or role heading falls back to Home document controls", () => {
  for (const [source, cases] of [
    ["docs/manual/MWELL_INTRA_USER_MANUAL.md", USER_MANUAL_OPERATIONAL_TARGETS],
    ["docs/PROCESS_REFERENCE_LIBRARY.md", PROCESS_LIBRARY_OPERATIONAL_TARGETS],
  ]) {
    for (const [heading] of cases) {
      const route = legacyRouteFor(source, heading);
      assert.notDeepEqual(
        { modeId: route.modeId, guideId: route.guideId, headingId: route.headingId },
        { modeId: "home", guideId: "home", headingId: "document-controls" },
        `${source}#${heading}`,
      );
    }
  }
});

test("the canonical model validates without warnings or errors", () => {
  assert.deepEqual(validateHandbookGuides(), { warnings: [], errors: [] });
});

test("validation reports duplicate IDs and missing related targets deterministically", () => {
  const duplicateGuides = cloneGuides();
  duplicateGuides[1].id = duplicateGuides[0].id;
  const missingRelatedGuides = cloneGuides();
  missingRelatedGuides[0].relatedGuides.push("missing-guide");

  assert.match(
    validateHandbookGuides({ guides: duplicateGuides }).errors.join("\n"),
    /guide ID home is duplicated/,
  );
  assert.match(
    validateHandbookGuides({ guides: missingRelatedGuides }).errors.join("\n"),
    /home references missing related guide missing-guide/,
  );
});

test("validation reports missing source files, headings, and screenshot assets", () => {
  const missingSource = cloneGuides();
  missingSource[0].sourceSections[0].source = "docs/not-present.md";
  const missingHeading = cloneGuides();
  missingHeading[0].sourceSections[0].heading = "Not A Real Heading";
  const missingAsset = cloneGuides();
  missingAsset[0].screenshotReferences.push("docs/manual/assets/not-present.png");

  assert.match(
    validateHandbookGuides({ guides: missingSource }).errors.join("\n"),
    /home references unclassified source docs\/not-present\.md/,
  );
  assert.match(
    validateHandbookGuides({ guides: missingHeading }).errors.join("\n"),
    /home references missing heading Not A Real Heading in/,
  );
  assert.match(
    validateHandbookGuides({ guides: missingAsset }).errors.join("\n"),
    /home references missing screenshot docs\/manual\/assets\/not-present\.png/,
  );
});

test("validation reports incomplete task and role contracts", () => {
  const incompleteTask = cloneGuides();
  delete incompleteTask.find(({ type }) => type === "task").outcome;
  const incompleteRole = cloneGuides();
  delete incompleteRole.find(({ type }) => type === "role").authorityLimits;

  assert.match(
    validateHandbookGuides({ guides: incompleteTask }).errors.join("\n"),
    /task procurement-request-approval is missing required field outcome/,
  );
  assert.match(
    validateHandbookGuides({ guides: incompleteRole }).errors.join("\n"),
    /role platform_administrator is missing required field authorityLimits/,
  );
});

test("validation reports invalid task participants and role-linked tasks", () => {
  const invalidParticipant = cloneGuides();
  invalidParticipant.find(({ type }) => type === "task").participatingRoles.push(
    "missing_role",
  );
  const invalidLinkedTask = cloneGuides();
  invalidLinkedTask.find(({ type }) => type === "role").linkedTasks.push(
    "general_employee",
  );

  assert.match(
    validateHandbookGuides({ guides: invalidParticipant }).errors.join("\n"),
    /task procurement-request-approval references missing role missing_role/,
  );
  assert.match(
    validateHandbookGuides({ guides: invalidLinkedTask }).errors.join("\n"),
    /role platform_administrator links to non-task guide general_employee/,
  );
});

test("validation reports orphan maintained sources and invalid legacy targets", () => {
  const orphanedGuides = cloneGuides().map((guide) => ({
    ...guide,
    sourceSections: guide.sourceSections.filter(
      ({ source }) => source !== "docs/RETENTION.md",
    ),
    governingSources: (guide.governingSources ?? []).filter(
      (source) => source !== "docs/RETENTION.md",
    ),
  }));
  const invalidLegacyRoutes = structuredClone(LEGACY_ROUTES);
  invalidLegacyRoutes[0].guideId = "missing-guide";

  assert.match(
    validateHandbookGuides({ guides: orphanedGuides }).errors.join("\n"),
    /maintained source docs\/RETENTION\.md is not mapped to a guide/,
  );
  assert.match(
    validateHandbookGuides({ legacyRoutes: invalidLegacyRoutes }).errors.join("\n"),
    /legacy route .* targets missing guide missing-guide/,
  );
});

test("validation rejects a legacy route retargeted to a different valid guide", () => {
  const retargetedRoutes = structuredClone(LEGACY_ROUTES);
  retargetedRoutes[0] = {
    ...retargetedRoutes[0],
    modeId: "tasks",
    guideId: "procurement-request-approval",
    headingId: "document-controls",
  };

  assert.match(
    validateHandbookGuides({ legacyRoutes: retargetedRoutes }).errors.join("\n"),
    /legacy route .* must target home\/home#document-controls/,
  );
});

test("semantic invariants reject wrong-but-existing canonical metadata", () => {
  const cases = [
    ["unrelated related guide", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").relatedGuides[0] = "ecommerce-order-intake";
    }, /related guide contract/],
    ["wrong existing heading", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").sourceSections[0].heading = "Navigation";
    }, /source section contract/],
    ["arbitrary purpose", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").sourceSections[0].purpose = "marketing-copy";
    }, /invalid presentation purpose marketing-copy/],
    ["removed screenshot reference", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").screenshotReferences.pop();
    }, /screenshot reference contract/],
    ["duplicate screenshot reference", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.screenshotReferences.push(guide.screenshotReferences[0]);
    }, /duplicate screenshot reference/],
    ["future implemented task", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").status = "future";
    }, /implemented guide procurement-request-approval cannot have future status/],
    ["duplicate source selector", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.sourceSections.push({ ...guide.sourceSections[0], id: "duplicate-selector" });
    }, /duplicate source selector/],
    ["duplicate participant", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.participatingRoles.push(guide.participatingRoles[0]);
    }, /duplicate participating role/],
    ["duplicate related guide", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.relatedGuides.push(guide.relatedGuides[0]);
    }, /duplicate related guide/],
    ["duplicate stage screenshot binding", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.steps[1].screenshot.bindingId = guide.steps[0].screenshot.bindingId;
    }, /duplicate screenshot binding/],
    ["wrong valid stage role", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").steps[0].performingRole = "product_owner";
    }, /step contract/],
    ["wrong existing stage route", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").steps[0].route = "/events";
    }, /step contract/],
    ["duplicate stage ID", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.steps[1].id = guide.steps[0].id;
    }, /duplicate stage ID/],
    ["altered screenshot binding", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").steps[0].screenshot.bindingId = "procurement-request-approval:replacement";
    }, /step contract/],
    ["duplicate related task", (guides) => {
      const guide = guides.find(({ id }) => id === "procurement-request-approval");
      guide.relatedTasks.push(guide.relatedTasks[0]);
    }, /duplicate related task/],
    ["removed related task", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").relatedTasks.pop();
    }, /related task contract/],
    ["wrong valid related task", (guides) => {
      guides.find(({ id }) => id === "procurement-request-approval").relatedTasks[0] = "ecommerce-order-intake";
    }, /related task contract/],
  ];

  for (const [label, mutate, expected] of cases) {
    const guides = cloneGuides();
    mutate(guides);
    assert.match(validateHandbookGuides({ guides }).errors.join("\n"), expected, label);
  }
});

test("fake screenshot certification and exact path or target drift are rejected", () => {
  const fakeGuides = cloneGuides();
  const fakeStage = fakeGuides.find(({ id }) => id === "procurement-request-approval").steps[0];
  fakeStage.screenshot = {
    ...fakeStage.screenshot,
    status: "certified",
    path: "docs/manual/assets/knowledge-base/employee-desktop.png",
    target: { label: "Anything", landmark: "arbitrary" },
  };
  assert.match(
    validateHandbookGuides({ guides: fakeGuides }).errors.join("\n"),
    /has no approved screenshot contract/,
  );
  assert.match(
    handbookGuideModel.validateHandbookEvidenceCoverage({ guides: fakeGuides }).errors.join("\n"),
    /pending certified screenshot evidence/,
  );

  const approved = {
    taskId: "procurement-request-approval",
    stageId: "step-1",
    bindingId: "procurement-request-approval:step-1",
    path: "docs/manual/assets/knowledge-base/flowchart-procure-to-pay-desktop.png",
    target: { label: "Create request", landmark: "procurement-form" },
  };
  for (const mutate of [
    (screenshot) => { screenshot.path = "docs/manual/assets/live-20260711/06-procurement-request-mobile-320.png"; },
    (screenshot) => { screenshot.target = { label: "Wrong target", landmark: "procurement-form" }; },
  ]) {
    const guides = cloneGuides();
    const screenshot = guides.find(({ id }) => id === approved.taskId).steps[0].screenshot;
    Object.assign(screenshot, {
      status: "certified",
      path: approved.path,
      target: approved.target,
    });
    mutate(screenshot);
    assert.match(
      validateHandbookGuides({
        guides,
        approvedScreenshotContracts: [approved],
      }).errors.join("\n"),
      /does not match its approved screenshot contract/,
    );
  }
});
