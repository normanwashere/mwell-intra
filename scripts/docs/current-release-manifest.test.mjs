import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("current authority separates deployed same-SHA CI from blocked journeys and human acceptance", () => {
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
  assert.equal(manifest.documentation.commit, "d45fd6f6827c57e3db1479e25f3207fd6795616d");
  assert.equal(manifest.documentation.status, "published-source-live-handbook-unverified");
  assert.equal(manifest.documentation.pendingRevision.commit, null);
  assert.equal(manifest.documentation.pendingRevision.status, "prepared-pending-publication");
  assert.equal(manifest.deployed.commit, "d45fd6f6827c57e3db1479e25f3207fd6795616d");
  assert.equal(manifest.deployed.deploymentId, "dpl_HRmSECixamMRtpXUsDDVCRJCaqRZ");
  assert.equal(manifest.deployed.readyState, "READY");
  assert.equal(manifest.deployed.aliasVerified, true);
  assert.equal(manifest.candidate.certifiedSourceCommit, manifest.deployed.commit);
  assert.equal(manifest.candidate.latestPushedSourceCommit, manifest.deployed.commit);
  assert.equal(manifest.sourceFollowUps.testOnlyReachability.commit, "940089557c3c5e698817e1eb96288ebd6a107fd9");
  assert.equal(manifest.sourceFollowUps.testOnlyReachability.status, "pushed");
  assert.equal(manifest.sourceFollowUps.testOnlyReachability.deployed, false);
  assert.deepEqual(manifest.sourceFollowUps.testOnlyReachability.hostedCi, { status: "completed", runId: "42141617943", conclusion: "cancelled", passedChecks: 8, requiredChecks: 11, cancelledChecks: 3, fullPass: false });
  const followUp = manifest.sourceFollowUps.latestPushedCandidate;
  assert.equal(followUp.commit, manifest.candidate.latestPushedSourceCommit);
  assert.equal(followUp.deployed, true);
  assert.deepEqual(followUp.hostedCi, { status: "completed", runId: "42151736798", conclusion: "success", passedChecks: 11, requiredChecks: 11, failedChecks: 0, fullPass: true });
  assert.match(manifest.sourceFollowUps.previousFailedCandidate.scope, /late-scroll-reset.*desktop1440.*tablet768.*centered.*undefined/);
  assert.equal(manifest.sourceFollowUps.previousFailedCandidate.hostedCi.failedChecks, 2);
  assert.equal(manifest.sourceFollowUps.reachabilityFixtureCorrection.commit, manifest.deployed.commit);
  assert.equal(manifest.sourceFollowUps.reachabilityFixtureCorrection.hostedCi.fullPass, true);
  assert.match(manifest.sourceFollowUps.offlineReconciliation.scope, /externally/);
  assert.equal(manifest.sourceFollowUps.offlineReconciliation.commit, null);
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.commit, "eb2148c8e287d6288041d85cd944375f6a17dfd6");
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.status, "applied-postverified-fresh-journey-blocked");
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.localPassed, 123);
  assert.deepEqual(manifest.sourceFollowUps.prospectiveG02DatabaseFix.nativeProof, { runId: "42145515659", jobId: "127656898709", executions: 2, passedPerExecution: 52, skippedPerExecution: 0, concreteSubtestsPerExecution: 51, evidence: "outputs/release-readiness-20261106/qa4-ci/g02-native-actor-proof-eb2148c-127656898709.md" });
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.sourceFile, "supabase/migrations/20261106032602_stock_conversion_putaway_authoritative_actor.sql");
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.sourceSha256, "fcede47f4671ab241d9e0a04face6d626aabb559fe8e72e830d6165342339306");
  assert.equal(manifest.sourceFollowUps.prospectiveG02DatabaseFix.deployed, true);
  const actor = manifest.databaseMigrations.find(item => item.name === "stock_conversion_putaway_authoritative_actor");
  assert.equal(actor.appliedVersion, "20261106032602");
  assert.equal(actor.reviewedLocalVersion, "20261106012547");
  assert.equal(actor.sourceFile, manifest.sourceFollowUps.prospectiveG02DatabaseFix.sourceFile);
  assert.equal(createHash("sha256").update(readFileSync(path.join(root, actor.sourceFile))).digest("hex"), actor.sourceSha256);
  assert.equal(manifest.deployed.observedAt, "2026-11-06T03:35:37.142Z");
  assert.equal(manifest.candidate.commit, manifest.deployed.commit);
  assert.equal(manifest.candidate.deploymentId, manifest.deployed.deploymentId);
  assert.equal(manifest.candidate.hostedCi.runId, "42151736798");
  assert.equal(manifest.candidate.hostedCi.status, "passed");
  assert.equal(manifest.candidate.hostedCi.passedChecks, 11);
  assert.equal(manifest.candidate.hostedCi.requiredChecks, 11);
  assert.deepEqual(manifest.candidate.hostedCi.memory, { cleanPassed: 1861, retryPassed: 0, exclusions: 143 });
  assert.deepEqual(manifest.candidate.hostedCi.controlled, { passed: 26, exclusions: 4 });
  assert.equal(manifest.acceptance.sameCommitHostedCi.status, "passed");
  assert.equal(manifest.acceptance.sameCommitHostedCi.runId, manifest.candidate.hostedCi.runId);
  assert.equal(manifest.acceptance.nonSmtpUatRetest.status, "not-run");
  const previous = manifest.history.find(item => item.commit === "dd9048e405bf84c2b7b0d6647309d1a8747c9378");
  assert.equal(previous.hostedCi.memory.retryPassed, 1);
  assert.equal(previous.scopedRetests.status, "partial");
  assert.equal(manifest.acceptance.nonSmtpUatRetest.commit, manifest.deployed.commit);
  assert.equal(manifest.acceptance.g01LegalToPayment.status, "blocked");
  assert.match(manifest.acceptance.g01LegalToPayment.scope, /without Auth administration/);
  assert.equal(manifest.acceptance.g02ConversionRecovery.status, "blocked");
  assert.equal(manifest.acceptance.g02ConversionRecovery.reason, "awaiting-fresh-serial-approval");
  assert.match(manifest.acceptance.g02ConversionRecovery.evidence[0], /g02-q4-post-putaway-20261106T011501Z\.json$/);
  assert.match(manifest.acceptance.g02ConversionRecovery.scope, /conversion\/recovery NOT RUN/);
  assert.match(manifest.acceptance.g02ConversionRecovery.scope, /Normal Learning startup.*writes/);
  assert.match(manifest.acceptance.g02ConversionRecovery.scope, /typed\/manual.*not physical scanner/);
  assert.match(manifest.acceptance.g02ConversionRecovery.scope, /canonical profile-email.*offline receipt UUID/i);
  assert.equal(manifest.acceptance.g02ConversionRecovery.freshRetest, "NOT RUN");
  assert.equal(manifest.acceptance.g02ConversionRecovery.freshSerialApprovalReceived, false);
  assert.equal(manifest.acceptance.humanAndPhysicalDeviceAcceptance.status, "not-recorded");
  assert.equal(manifest.acceptance.productionGoNoGo.status, "not-granted");
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

test("deployed operating guidance distinguishes unknown, blocked journeys and pending human verification", () => {
  const manual = read("docs/manual/MWELL_INTRA_USER_MANUAL.md");
  for (const phrase of ["public-only", "valid source bin", "My Work", "Received Units Availability", "all time", "JSON 401", "UAT serves `d45fd6f6827c57e3db1479e25f3207fd6795616d`", "G02 is BLOCKED awaiting fresh synthetic-serial approval", "G01 is blocked by Auth administration"]) {
    assert.ok(manual.includes(phrase), `missing guidance: ${phrase}`);
  }
  for (const phrase of ["authorized colleague", "2 issued, 1 sold and 1 returned leaves 0 remaining", "unknown, not zero", "independent settlement approval", "published to GitHub", "not a live handbook update"]) {
    assert.ok(manual.includes(phrase), `missing follow-up guidance: ${phrase}`);
  }
  assert.match(manual, /All\s*90 human rows PENDING/i);
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
