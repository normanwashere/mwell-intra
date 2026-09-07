import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_LIVE_ROLES } from "./live-e2e-scenarios.mjs";
import { eligibleTaskTargets, readinessStatus, summarizeTasks } from "./task-readiness-sweep.mjs";

const origin = "https://example.invalid";
const state = { regionCount: 1, visible: true, selectedTaskId: "one", unavailableAlerts: 0, knownReadinessHeading: true };

test("every eligible task is retained for all eleven role paths, including vendor and multirole", () => {
  assert.equal(CURRENT_LIVE_ROLES.length, 11);
  for (const role of CURRENT_LIVE_ROLES) {
    const pathname = role.kind === "vendor" ? "/vendor/onboarding" : "/onboarding";
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `task-${i}`, actionHref: "/work?record=example#action" }));
    const targets = eligibleTaskTargets(tasks, origin, pathname);
    assert.equal(targets.length, 8);
    targets.forEach(({ task, url }) => {
      const target = new URL(url);
      assert.equal(target.pathname, pathname);
      assert.equal(target.searchParams.get("task"), task.id);
      assert.equal(target.searchParams.get("next"), task.actionHref);
    });
  }
});

test("invalid/duplicate tasks fail closed, never silently truncate or deduplicate", () => {
  for (const tasks of [[], [{ id: "one", actionHref: "//evil.invalid" }], [{ id: "one", actionHref: "/work" }, { id: "one", actionHref: "/work" }]]) {
    assert.throws(() => eligibleTaskTargets(tasks, origin, "/onboarding"));
  }
});

test("visible region alone cannot pass readiness; identity, known content and no warning are required", () => {
  assert.equal(readinessStatus([state], "one"), "passed");
  for (const change of [{ unavailableAlerts: 1 }, { selectedTaskId: "other" }, { visible: false }, { regionCount: 0 }, { knownReadinessHeading: false }]) {
    assert.equal(readinessStatus([{ ...state, ...change }], "one"), "failed");
  }
});

test("reload cannot erase earlier readiness warning and unexecuted is not a pass", () => {
  assert.equal(readinessStatus([{ ...state, unavailableAlerts: 1 }, state], "one"), "failed");
  assert.equal(readinessStatus([], "one"), "unexecuted");
});

test("summary keeps navigation success, readiness failure and unexecuted tasks distinct", () => {
  assert.deepEqual(summarizeTasks([
    { navigation: "passed", readiness: "failed" },
    { navigation: "failed", readiness: "unexecuted" },
    { navigation: "passed", readiness: "passed" },
  ], 4), { expected: 4, attempted: 3, navigationPassed: 2, readinessPassed: 1, readinessFailed: 1, readinessUnexecuted: 2, complete: false });
});
