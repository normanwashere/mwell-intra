import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDBOOK_DOCUMENTS,
  resolveHandbookCatalog,
} from "./handbook-catalog.mjs";
import { documentationSources } from "./build-app-documentation.mjs";

test("classifies every current maintained source exactly once", () => {
  const sources = documentationSources();
  const result = resolveHandbookCatalog(sources);
  const classifiedSources = new Set(HANDBOOK_DOCUMENTS.map(({ source }) => source));

  assert.deepEqual(result.documents.map(({ source }) => source), sources);
  assert.equal(result.documents.length, sources.length);
  assert.deepEqual(result.errors, []);
  assert.equal(new Set(result.documents.map(({ id }) => id)).size, sources.length);
  assert.ok(sources.every((source) => classifiedSources.has(source)));
});

test("fails closed when a catalog source is missing from maintained documentation", () => {
  const missingSource = "docs/releases/2026-08-21-WMS-FEEDBACK-RELEASE.md";
  const result = resolveHandbookCatalog(
    documentationSources().filter((source) => source !== missingSource),
  );

  assert.match(result.errors.join("\n"), new RegExp(`${missingSource}.*missing`, "i"));
});

test("catalog source IDs are unique", () => {
  const ids = HANDBOOK_DOCUMENTS.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test("classifies the August 23 department authority and UAT remediation release evidence", () => {
  const sources = [
    "docs/releases/2026-08-23-CANONICAL-DEPARTMENT-AUTHORITY.md",
    "docs/releases/2026-08-23-UAT-TRANSACTION-CERTIFICATION-REMEDIATION.md",
  ];
  const result = resolveHandbookCatalog([
    ...documentationSources().filter((source) => !sources.includes(source)),
    ...sources,
  ]);

  assert.deepEqual(result.errors, []);
  for (const source of sources) {
    const document = HANDBOOK_DOCUMENTS.find((entry) => entry.source === source);
    assert.ok(document, `${source} is classified`);
    assert.equal(document.primaryTab, "release");
    assert.equal(document.contentType, "release-note");
  }
});

test("places the MPIC extract exactly in governance with workflow and architecture visibility", () => {
  const policy = HANDBOOK_DOCUMENTS.find(({ source }) => source === "docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md");

  assert.ok(policy, "the MPIC extract is cataloged");
  assert.equal(HANDBOOK_DOCUMENTS.filter(({ source }) => source === policy.source).length, 1);
  assert.equal(policy.primaryTab, "security");
  assert.deepEqual(policy.relatedTabs, ["workflows", "architecture"]);
  assert.equal(policy.contentType, "policy");
});

test("returns an actionable error instead of fallback metadata for an unknown source", () => {
  const result = resolveHandbookCatalog(["docs/new-review.md"]);
  assert.deepEqual(result.documents, []);
  assert.match(result.errors.join("\n"), /docs\/new-review\.md.*not classified/i);
});
