import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDBOOK_TABS,
  resolveHandbookCatalog,
} from "./handbook-catalog.mjs";

test("defines the seven audience-facing tabs in release order", () => {
  assert.deepEqual(HANDBOOK_TABS.map(({ id }) => id), [
    "start", "workflows", "roles", "architecture",
    "infrastructure", "security", "release",
  ]);
});

test("classifies every maintained source exactly once", () => {
  const sources = [
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/PROCESS_REFERENCE_LIBRARY.md",
  ];
  const result = resolveHandbookCatalog(sources);
  assert.equal(result.documents.length, sources.length);
  assert.equal(new Set(result.documents.map(({ id }) => id)).size, sources.length);
  assert.equal(result.warnings.length, 0);
});

test("falls an unknown source back to release with an actionable warning", () => {
  const result = resolveHandbookCatalog(["docs/new-review.md"]);
  assert.equal(result.documents[0].primaryTab, "release");
  assert.match(result.warnings[0], /docs\/new-review\.md.*Release & QA/);
});
