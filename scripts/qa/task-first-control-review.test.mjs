import test from "node:test";
import assert from "node:assert/strict";
import { evaluateControlReview, planControl } from "./task-first-control-review.mjs";

const row = { id: "knowledge-library:Search handbook", control: "Search handbook", roleIds: ["staff"], capabilityIds: [], routes: ["/knowledge"] };
function fixture() {
  const commit = "a".repeat(40);
  return {
    controlId: row.id, candidateCommit: commit, healthCommit: commit, healthVerifiedAt: "2026-09-06T15:00:00Z",
    actorRoleId: "staff", authorizationConfirmed: true, noBusinessWrites: true,
    fixtureReference: "approved-empty-search", state: "empty search", routeTemplate: "/knowledge", actualRoute: "/knowledge",
    attempts: ["desktop", "mobile"].map((viewport) => ({
      viewport, selected: true, path: `outputs/example-${viewport}.png`, sha256: "b".repeat(64),
      capturedAt: "2026-09-06T15:01:00Z", capturedBy: "capture-agent", commit,
      width: viewport === "desktop" ? 1440 : 390, height: 900, locator: "scoped exact search textbox",
      matchCount: 1, targetVisible: true, targetMasked: false, exactStateConfirmed: true, businessWritesObserved: false,
    })),
  };
}
function reviewed(run) {
  for (const attempt of run.attempts) attempt.review = {
    disposition: "accepted", openedImage: true, targetLegible: true, contextCorrect: true, privacySafe: true,
    noClippingOrOverlap: true, sha256: attempt.sha256, candidateCommit: run.candidateCommit,
    reviewedBy: "independent-reviewer", reviewedAt: "2026-09-06T15:02:00Z",
  };
  return run;
}

test("classification is bounded and never grants activation", () => {
  for (const [control, classification] of [
    ["Search handbook", "navigation-or-local-view-review-required"],
    ["Delete draft route", "destructive-prohibited"],
    ["Sign in", "identity-or-authority-main-only"],
    ["Confirm signature", "external-io-or-sensitive-prohibited"],
    ["Retry", "read-recovery-needs-fault-fixture"],
    ["Submit receipt", "write-or-unresolved-prohibited"],
    ["Unknown future action", "write-or-unresolved-prohibited"],
  ]) {
    const plan = planControl({ ...row, control });
    assert.equal(plan.classification, classification);
    assert.equal(plan.activationAllowed, false);
    assert.equal(plan.fixtureRequired, !plan.routineUiApproval);
  }
});

test("main-approved routine empty UI needs no separate business-owner fixture", () => {
  const plan = planControl(row);
  assert.equal(plan.fixtureRequired, false);
  assert.match(plan.routineUiApproval, /main-approved/);
  assert.equal(plan.activationAllowed, false);
  assert.equal(planControl({ ...row, id: "warehouse-receiving:Submit receipt", control: "Submit receipt" }).fixtureRequired, true);
});

test("filename existence is neither capture provenance nor certification", () => {
  const run = fixture();
  run.attempts = [{ viewport: "desktop", selected: true, path: "existing.png" }];
  assert.equal(evaluateControlReview(row, run).status, "blocked");
  assert.equal(evaluateControlReview(row, fixture()).status, "captured-unreviewed");
});

test("baseline and unhealthy candidate cannot pass", () => {
  for (const change of [
    { candidateCommit: `7083373${"a".repeat(33)}` },
    { healthCommit: "c".repeat(40) }, { healthVerifiedAt: null },
  ]) assert.equal(evaluateControlReview(row, { ...reviewed(fixture()), ...change }).status, "blocked");
});

test("masked, nonunique, wrong-state and write-observed captures are blocked", () => {
  for (const change of [{ targetMasked: true }, { matchCount: 2 }, { exactStateConfirmed: false }, { businessWritesObserved: true }]) {
    const run = reviewed(fixture()); Object.assign(run.attempts[0], change);
    assert.equal(evaluateControlReview(row, run).status, "blocked");
  }
});

test("independent review must open the exact image and cannot accept changed bytes", () => {
  for (const change of [{ reviewedBy: "capture-agent" }, { openedImage: false }, { sha256: "d".repeat(64) }, { privacySafe: false }]) {
    const run = reviewed(fixture()); Object.assign(run.attempts[0].review, change);
    assert.equal(evaluateControlReview(row, run).status, "blocked");
  }
});

test("selected failures remain rejected; previous failed attempts remain in history", () => {
  const run = reviewed(fixture()); run.attempts[0].review.disposition = "rejected";
  assert.equal(evaluateControlReview(row, run).status, "review-rejected");
  const before = structuredClone(run.attempts[0]); before.selected = false;
  run.attempts[0].review.disposition = "accepted"; run.attempts.push(before);
  assert.equal(evaluateControlReview(row, run).status, "reviewed-instruction-only");
  assert.equal(run.attempts.length, 3);
  assert.equal(run.attempts[2].review.disposition, "rejected");
});

test("scoped instruction review never returns business certification", () => {
  const result = evaluateControlReview(row, reviewed(fixture()));
  assert.equal(result.status, "reviewed-instruction-only");
  assert.match(result.limitation, /not proof of business transition/);
  assert.equal(evaluateControlReview(row, { ...reviewed(fixture()), actorRoleId: "unauthorized" }).status, "blocked");
  assert.equal(evaluateControlReview(row, { ...reviewed(fixture()), actualRoute: "/another-page" }).status, "blocked");
});
