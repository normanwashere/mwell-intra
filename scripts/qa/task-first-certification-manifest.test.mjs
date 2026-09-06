import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildManifest } from "./task-first-certification-manifest.mjs";

test("planning manifest covers every live control without upgrading historical evidence", async () => {
  const manifest = await buildManifest();
  assert.equal(manifest.counts.controls, 271);
  assert.equal(manifest.counts.excludedRoadmapControls, 9);
  assert.equal(manifest.counts.historicalEvidenceRecords, 53);
  assert.equal(manifest.counts.artifactReferences, 106);
  assert.equal(manifest.counts.missingArtifactReferences, 0);
  assert.equal(manifest.counts.exactControlEvidenceMatches, 0);
  assert.equal(manifest.baselineLimitations.certifiedControls, 0);
  assert.equal(manifest.baselineLimitations.humanPilotResults, 0);
  assert.ok(manifest.baselineLimitations.evidenceBasis.startsWith("Assistant-reviewed baseline"));
  assert.equal(manifest.baselineLimitations.reportedLiveBaselineCommit, "7083373");
  assert.equal(manifest.baselineLimitations.baselineIsPendingCandidate, false);
  assert.equal(manifest.candidate.deployedCommit, "39a509cab9a769c1b1c611fa9decd55d0b02c454");
  assert.equal(manifest.candidate.publicAliasCommit, "7083373");
  assert.equal(manifest.candidate.status, "protected-deployed-main-health-confirmed");
  assert.deepEqual(manifest.baselineLimitations.blockers.map((item) => item.id), ["masked-target-controls", "existing-user-not-fresh-pilot"]);
  assert.equal(new Set(manifest.controls.map((row) => row.id)).size, 271);
  const ids = new Set(manifest.evidence.map((row) => row.id));
  for (const row of manifest.controls) {
    assert.equal(row.status, "notcaptured");
    assert.equal(row.target.scopeVerified, false);
    assert.equal(row.capturePlan.activationAllowed, false);
    assert.equal(row.capturePlan.fixtureRequired, !row.capturePlan.routineUiApproval);
    assert.deepEqual(row.capturePlan.eligibleRoleIds, row.roleIds);
    assert.ok(row.routes.length && row.prerequisite && row.behavior && row.expectedResult);
    assert.ok(Object.values(row.capture).every((value) => value === null));
    assert.ok(row.historicalEvidenceIds.every((id) => ids.has(id)));
    assert.ok(row.existingToolTargetCandidates.every((target) => target.names.includes(row.control) && !target.scopeVerified));
  }
  assert.deepEqual(JSON.parse(readFileSync(new URL("../../docs/training/task-first-certification-manifest.json", import.meta.url), "utf8")), manifest);
});

test("pilot template has no fabricated participants and checklist links resolve", () => {
  const base = new URL("../../docs/training/", import.meta.url);
  const csv = readFileSync(new URL("task-first-pilot-results-template.csv", base), "utf8").trim();
  assert.equal(csv.split(/\r?\n/).length, 1);
  assert.ok(csv.startsWith("anonymous_participant_id,session_id,"));
  const checklist = readFileSync(new URL("task-first-certification-ready.md", base), "utf8");
  assert.ok(checklist.includes("No participants have been recruited or scheduled"));
  for (const match of checklist.matchAll(/\]\(([^)]+)\)/g)) {
    assert.ok(existsSync(new URL(match[1], base)), `Missing checklist artifact: ${match[1]}`);
  }
});
