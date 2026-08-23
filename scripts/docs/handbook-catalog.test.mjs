import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDBOOK_DOCUMENTS,
  HANDBOOK_TABS,
  resolveHandbookCatalog,
} from "./handbook-catalog.mjs";
import { documentationSources } from "./build-app-documentation.mjs";

test("defines the seven audience-facing tabs in release order", () => {
  assert.deepEqual(HANDBOOK_TABS.map(({ id }) => id), [
    "start", "workflows", "roles", "architecture",
    "infrastructure", "security", "release",
  ]);
});

test("classifies named catalog sources exactly once", () => {
  const sources = [
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/PROCESS_REFERENCE_LIBRARY.md",
  ];
  const result = resolveHandbookCatalog(sources);
  assert.equal(result.documents.length, sources.length);
  assert.equal(new Set(result.documents.map(({ id }) => id)).size, sources.length);
  assert.equal(result.warnings.length, 0);
});

test("classifies every current maintained source without fallback metadata", () => {
  const sources = documentationSources();
  const result = resolveHandbookCatalog(sources);
  const classifiedSources = new Set(HANDBOOK_DOCUMENTS.map(({ source }) => source));

  assert.deepEqual(result.documents.map(({ source }) => source), sources);
  assert.equal(result.documents.length, sources.length);
  assert.equal(result.warnings.length, 0);
  assert.equal(new Set(result.documents.map(({ id }) => id)).size, sources.length);
  assert.ok(sources.every((source) => classifiedSources.has(source)));
});

test("places the MPIC extract exactly in governance with workflow and architecture visibility", () => {
  const policy = HANDBOOK_DOCUMENTS.find(({ source }) => source === "docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md");

  assert.ok(policy, "the MPIC extract is cataloged");
  assert.equal(HANDBOOK_DOCUMENTS.filter(({ source }) => source === policy.source).length, 1);
  assert.equal(policy.primaryTab, "security");
  assert.deepEqual(policy.relatedTabs, ["workflows", "architecture"]);
  assert.equal(policy.contentType, "policy");
});

test("falls an unknown source back to release with an actionable warning", () => {
  const result = resolveHandbookCatalog(["docs/new-review.md"]);
  assert.equal(result.documents[0].primaryTab, "release");
  assert.match(result.warnings[0], /docs\/new-review\.md.*Release & QA/);
});
