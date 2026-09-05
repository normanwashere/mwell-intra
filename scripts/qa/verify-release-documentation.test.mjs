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

test("derives the certified legacy-route count and rejects any declared count drift", () => {
  assert.equal(LEGACY_ROUTES.length, 372);
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
