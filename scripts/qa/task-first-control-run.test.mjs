import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessRun, createRunTemplate } from "./task-first-control-run.mjs";

const manifest = { controls: [{ id: "feature:control", roleIds: ["staff"], routes: ["/route"] }] };
test("run template is blank and missing/duplicate controls cannot disappear from coverage", () => {
  const run = createRunTemplate(manifest);
  assert.deepEqual(run.controls[0].attempts, []);
  assert.equal(run.controls[0].candidateCommit, null);
  assert.equal(assessRun(manifest, run).results[0].status, "blocked");
  assert.deepEqual(assessRun(manifest, { controls: [] }).errors, ["missing-control:feature:control"]);
  run.controls.push(run.controls[0]);
  assert.deepEqual(assessRun(manifest, run).errors, ["unknown-or-duplicate:feature:control"]);
});

test("selected files outside the workspace or missing files are blocked without network reads", () => {
  for (const [file, error] of [["../outside.png", "invalid-artifact-path"], ["outputs/nonexistent-certification-test.png", "artifact-unreadable"]]) {
    const run = createRunTemplate(manifest);
    run.controls[0].attempts = [{ viewport: "desktop", selected: true, path: file }];
    const result = assessRun(manifest, run).results[0];
    assert.equal(result.status, "blocked");
    assert.ok(result.errors.includes(`desktop:${error}`));
  }
});

test("an existing image with mismatched digest is not accepted", () => {
  const inventory = JSON.parse(readFileSync(new URL("../../docs/training/task-first-certification-manifest.json", import.meta.url), "utf8"));
  const run = createRunTemplate(manifest);
  run.controls[0].attempts = [{ viewport: "desktop", selected: true,
    path: inventory.evidence[0].artifacts[0].repositoryPath, sha256: "0".repeat(64) }];
  const result = assessRun(manifest, run).results[0];
  assert.equal(result.status, "blocked");
  assert.ok(result.errors.includes("desktop:artifact-bytes-changed"));
});
