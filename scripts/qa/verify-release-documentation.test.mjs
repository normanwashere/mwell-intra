import test from "node:test";
import assert from "node:assert/strict";
import {
  isOperationalSource,
  validateDocumentationSync,
} from "./verify-release-documentation.mjs";

test("classifies rendered application source but not tests or Knowledge Base content", () => {
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
