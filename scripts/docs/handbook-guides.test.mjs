import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { HANDBOOK_DOCUMENTS } from "./handbook-catalog.mjs";
import {
  HANDBOOK_GUIDES,
  HANDBOOK_MODES,
  LEGACY_ROUTES,
  validateHandbookGuides,
} from "./handbook-guides.mjs";

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

test("publishes the 13 canonical task guides and six required system groups", () => {
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "task").map(({ id }) => id),
    EXPECTED_TASK_IDS,
  );
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "system").map(({ id }) => id),
    [
      "architecture-data",
      "infrastructure-continuity",
      "security-governance",
      "release-qa",
      "imports",
      "source-references",
    ],
  );
});

test("publishes the exact current 11-persona role catalog", () => {
  assert.deepEqual(
    HANDBOOK_GUIDES.filter(({ type }) => type === "role").map(
      ({ id, canonicalName }) => [id, canonicalName],
    ),
    EXPECTED_ROLES,
  );
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
  }

  for (const guide of HANDBOOK_GUIDES.filter(({ type }) => type === "role")) {
    for (const field of ROLE_FIELDS) {
      assert.equal(isPopulated(guide[field]), true, `${guide.id}.${field}`);
    }
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
