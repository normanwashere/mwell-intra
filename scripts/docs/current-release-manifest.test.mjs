import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { buildDocumentationHtml, documentationSources } from "./build-app-documentation.mjs";
import { resolveHandbookCatalog } from "./handbook-catalog.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifestFile = "docs/handoffs/current/release-status.json";
const read = file => readFileSync(path.join(root, file), "utf8");
const entryPoints = [
  "docs/handoffs/current/README.md",
  "docs/handoffs/current/data.md",
  "docs/handoffs/current/technical.md",
  "docs/handoffs/current/testers.md",
  "docs/integrations/reporting-api/RELEASE-READINESS.md",
  "docs/integrations/reporting-api/DATA-TEAM-QUICKSTART.md",
  "docs/manual/MWELL_INTRA_USER_MANUAL.md",
  "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md",
  "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md",
  "docs/TRAINING_AND_HANDOVER_CONTENT.md",
  "docs/releases/2026-11-05-WMS-AUDIT-REMEDIATION.md",
];

function links(markdown) {
  const result = [];
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type === "link") result.push(token.href);
  });
  return result;
}

test("current authority records observed deployment separately from an unverified candidate", () => {
  const manifest = JSON.parse(read(manifestFile));
  assert.equal(manifest.authority, "current-release");
  assert.equal(manifest.deployed.environment, "uat");
  assert.match(manifest.deployed.commit, /^[a-f0-9]{40}$/);
  assert.ok(Number.isFinite(Date.parse(manifest.deployed.observedAt)));
  assert.match(manifest.deployed.evidence.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.reportingApi.enabled, false);
  assert.equal(manifest.reportingApi.phase, "separate-implementation");
  assert.equal(manifest.reportingApi.acceptance, "not-delivered");
  assert.equal(manifest.smtp.status, "excluded");
  assert.equal(manifest.documentation.basedOnDeployedAppCommit, manifest.deployed.commit);
  assert.equal(manifest.documentation.commit, null);
  assert.equal(manifest.documentation.status, "pending-publication");
  assert.notEqual(manifest.candidate.latestPushedSourceCommit, manifest.deployed.commit);
  for (const migration of manifest.databaseMigrations) {
    assert.match(migration.appliedVersion, /^\d{14}$/);
    assert.match(migration.reviewedLocalVersion, /^\d{14}$/);
    assert.match(migration.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(migration.evidence);
  }
  if (manifest.candidate.commit === null) {
    assert.equal(manifest.candidate.status, "pending-deploy-and-retest");
    assert.equal(manifest.candidate.deploymentId, null);
    assert.equal(manifest.candidate.deployedAt, null);
    for (const gate of Object.values(manifest.acceptance)) {
      assert.notEqual(gate.status, "passed");
    }
  }
  for (const gate of Object.values(manifest.acceptance)) {
    if (gate.status === "passed") {
      assert.equal(gate.commit, manifest.deployed.commit);
      assert.ok(gate.evidence?.length, "passed gates require retained same-commit evidence");
    }
  }
});

test("Data, Technical, Tester and handbook entry points link to one current manifest", () => {
  for (const file of entryPoints) {
    const targets = links(read(file)).filter(href => !/^(?:https?:|mailto:|#)/i.test(href))
      .map(href => path.resolve(root, path.dirname(file), href.split("#")[0]));
    assert.ok(targets.includes(path.resolve(root, manifestFile)), `${file}: current authority link missing`);
    for (const target of targets) assert.ok(existsSync(target), `${file}: missing local link ${target}`);
  }
});

test("current handoff explicitly preserves the September snapshot as historical", () => {
  const manifest = JSON.parse(read(manifestFile));
  const history = manifest.history.find(item => item.manifest === "docs/handoffs/2026-09-22/release-status.json");
  assert.equal(history.status, "historical-not-current-certification");
  const historical = JSON.parse(read(history.manifest));
  assert.equal(historical.liveCommit, "223144f3ffbf315d112accac376fa3e187f1d301");
  assert.equal(historical.asOf, "2026-09-23");
  assert.match(read("docs/handoffs/current/README.md"), /historical/i);
});

test("separate Reporting API phase retains approval and four-cycle acceptance gates", () => {
  const phase = read("docs/integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md");
  assert.match(phase, /remain disabled/i);
  assert.match(phase, /provider.*approval.*pending/i);
  assert.match(phase, /dictionary.*approval.*pending/i);
  assert.match(phase, /four incremental/i);
  assert.match(phase, /no partial activation/i);
  assert.match(phase, /revocation/i);
  assert.match(phase, /no named.*owner.*confirmed/i);
});

test("candidate operating guidance distinguishes unknown, scope and pending verification", () => {
  const manual = read("docs/manual/MWELL_INTRA_USER_MANUAL.md");
  for (const phrase of ["public-only", "valid source bin", "My Work", "Received Units Availability", "all time", "JSON 401", "Pending deployment and retest"]) {
    assert.ok(manual.includes(phrase), `missing guidance: ${phrase}`);
  }
  for (const phrase of ["authorized colleague", "2 issued, 1 sold and 1 returned leaves 0 remaining", "unknown, not zero", "independent settlement approval", "not yet deployed"]) {
    assert.ok(manual.includes(phrase), `missing follow-up guidance: ${phrase}`);
  }
});

test("supporting handoffs reuse the existing handbook catalogue", () => {
  const sources = documentationSources();
  assert.ok(!sources.some(source => source.startsWith("docs/handoffs/current/")));
  assert.deepEqual(resolveHandbookCatalog(sources).errors, []);
});

test("generated handbook manifest links resolve relative to the output document", () => {
  const html = buildDocumentationHtml();
  const hrefs = [...html.matchAll(/href="([^"]*handoffs\/current\/release-status\.json)"/g)].map(match => match[1]);
  assert.ok(hrefs.length >= 5, "all maintained source entry points are rendered");
  for (const href of hrefs) {
    assert.equal(path.resolve(root, "docs/manual", href), path.resolve(root, manifestFile));
  }
});
