import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_ROUTES } from "../docs/handbook-guides.mjs";
import {
  LEGACY_ROUTE_COUNT_DOCUMENTS,
  isOperationalSource,
  validateLegacyRouteDocumentation,
  validateDocumentationSync,
} from "./verify-release-documentation.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

test("classifies rendered application source but not tests or handbook content", () => {
  assert.equal(
    isOperationalSource("modules/warehouse/src/pages/FulfillmentPage.tsx"),
    true,
  );
  assert.equal(isOperationalSource("apps/shell/components/Home.tsx"), true);
  assert.equal(
    isOperationalSource("modules/warehouse/src/pages/FulfillmentPage.test.tsx"),
    false,
  );
  assert.equal(
    isOperationalSource("apps/shell/lib/knowledge/content.ts"),
    false,
  );
});

test("allows infrastructure-only releases without manual churn", () => {
  const result = validateDocumentationSync([
    ".github/workflows/deploy-vercel.yml",
    "scripts/qa/verify-release-documentation.mjs",
  ]);
  assert.equal(result.ready, true);
  assert.deepEqual(result.failures, []);
});

test("blocks operational releases with stale documentation", () => {
  const result = validateDocumentationSync([
    "modules/warehouse/src/pages/FulfillmentPage.tsx",
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.failures.length, 7);
});

test("accepts operational releases with the complete documentation set", () => {
  const result = validateDocumentationSync([
    "modules/warehouse/src/pages/FulfillmentPage.tsx",
    "apps/shell/lib/knowledge/content.ts",
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md",
    "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md",
    "docs/TRAINING_AND_HANDOVER_CONTENT.md",
    "docs/manual/index.html",
    "docs/releases/2026-08-21-fulfillment.md",
  ]);
  assert.equal(result.ready, true);
});

test("derives the current legacy-route count and rejects any declared count drift", () => {
  assert.equal(LEGACY_ROUTES.length, 503);
  const documents = Object.fromEntries(
    LEGACY_ROUTE_COUNT_DOCUMENTS.map(({ file }) => [
      file,
      readFileSync(path.join(root, file), "utf8"),
    ]),
  );
  const result = validateLegacyRouteDocumentation(documents);
  assert.equal(result.expectedCount, LEGACY_ROUTES.length);
  assert.equal(result.ready, true, result.failures.join("\n"));
  assert.deepEqual(result.failures, []);
});

test("retains all five reporting release source links without implying a connectable API", () => {
  const article = "doc-releases-2026-09-23-reporting-foundation-md";
  for (const heading of [null, "reporting-foundation-update", "what-changed", "what-testers-need-to-know", "evidence-and-limits"]) {
    const routes = LEGACY_ROUTES.filter(route => route.legacyArticleId === article && route.legacyHeadingId === (heading ? `${article}-${heading}` : null));
    assert.equal(routes.length, 1);
    assert.equal(routes[0].guideId, "source-references");
  }
  const note = readFileSync(path.join(root, "docs/releases/2026-09-23-REPORTING-FOUNDATION.md"), "utf8");
  assert.match(note, /All 30 dataset IDs remain unavailable/);
});

test("retains the eight return and Quality display reference routes without screenshot credit", () => {
  const releaseArticle = "doc-releases-2026-09-13-return-quality-display-md";
  const expected = [
    [releaseArticle, null],
    [releaseArticle, `${releaseArticle}-return-and-quality-display-update`],
    [releaseArticle, `${releaseArticle}-for-testers`],
    [releaseArticle, `${releaseArticle}-release-evidence`],
    ["doc-manual-mwell-intra-user-manual-md", "doc-manual-mwell-intra-user-manual-md-september-13-return-and-quality-display-update"],
    ["doc-technical-and-functional-specification-md", "doc-technical-and-functional-specification-md-september-13-return-and-quality-display-contract"],
    ["doc-training-and-handover-content-md", "doc-training-and-handover-content-md-september-13-return-and-quality-display-handover"],
    ["doc-user-training-and-operations-manual-md", "doc-user-training-and-operations-manual-md-september-13-return-and-quality-display-drill"],
  ];
  for (const [article, heading] of expected) {
    const routes = LEGACY_ROUTES.filter(route => route.legacyArticleId === article && route.legacyHeadingId === heading);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].guideId, "source-references");
  }
});

test("retains all four Warehouse recovery source links without inherited screenshot credit", () => {
  const expected = [
    ["doc-manual-mwell-intra-user-manual-md", "warehouse-access-recovery"],
    ["doc-technical-and-functional-specification-md", "warehouse-session-recovery-contract"],
    ["doc-user-training-and-operations-manual-md", "warehouse-access-recovery-drill"],
    ["doc-training-and-handover-content-md", "warehouse-access-recovery-handover"],
  ];
  for (const [article, heading] of expected) {
    const routes = LEGACY_ROUTES.filter(route => route.legacyArticleId === article && route.legacyHeadingId === `${article}-${heading}`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].guideId, "source-references");
  }
});

test("retains the three seller handover reference links without transaction certification credit", () => {
  const expected = [
    ["doc-releases-2026-09-20-experience-remediation-candidate-md", "synthetic-seller-handover"],
    ["doc-training-and-handover-content-md", "september-20-seller-handover"],
    ["doc-user-training-and-operations-manual-md", "event-seller-practice"],
  ];
  for (const [article, heading] of expected) {
    const routes = LEGACY_ROUTES.filter(route => route.legacyArticleId === article && route.legacyHeadingId === `${article}-${heading}`);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].guideId, "source-references");
  }
});

test("rejects a stale legacy-route declaration even when every document has a count", () => {
  const documents = Object.fromEntries(
    LEGACY_ROUTE_COUNT_DOCUMENTS.map(({ file, prefix, suffix }) => [
      file,
      `${prefix}${LEGACY_ROUTES.length}${suffix}`,
    ]),
  );
  const staleDocument = LEGACY_ROUTE_COUNT_DOCUMENTS[0];
  documents[staleDocument.file] = `${staleDocument.prefix}${LEGACY_ROUTES.length - 1}${staleDocument.suffix}`;

  const result = validateLegacyRouteDocumentation(documents);
  assert.equal(result.ready, false);
  assert.match(result.failures.join("\n"), new RegExp(`${staleDocument.file}.*${LEGACY_ROUTES.length - 1}.*${LEGACY_ROUTES.length}`));
});
