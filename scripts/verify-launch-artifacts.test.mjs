import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CURRENT_LIVE_ROLES,
  REQUIRED_TRANSACTION_VIEWPORTS,
  WORKFLOW_SCENARIO_EVIDENCE,
  evaluateScenarioCoverage,
} from "./qa/live-e2e-scenarios.mjs";
import { verifyCertificationBundle } from "./verify-launch-artifacts.mjs";

const routeViewports = [
  "desktop-1440",
  "desktop-1280",
  "tablet-768",
  "mobile-390",
  "mobile-360",
  "mobile-320",
];

const productWorkflowNames = new Set([
  "Product contributor readiness and pricing submission",
  "Product owner go-live and pricing decision",
  "Operations Product handoff acknowledgement",
]);

async function writeJson(root, name, value) {
  await writeFile(
    path.join(root, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function workflowsFor(viewport, screenshotNames) {
  return WORKFLOW_SCENARIO_EVIDENCE.map((item, index) => {
    const screenshot = `${viewport}-${index}.jpg`;
    if (productWorkflowNames.has(item.workflow))
      screenshotNames.add(screenshot);
    return {
      viewport,
      workflow: item.workflow,
      ok: true,
      networkErrors: [],
      consoleErrors: [],
      scenarioEvidence: [item],
      intermediateEvidence: productWorkflowNames.has(item.workflow)
        ? [
            {
              label: "action-state",
              screenshot: `/runner/test-results/evidence/${screenshot}`,
              audit: { keyboardHotspots: { undersizedTargets: [] } },
            },
          ]
        : [],
    };
  });
}

async function makeCertificationBundle() {
  const root = await mkdtemp(path.join(tmpdir(), "intra-certification-"));
  await mkdir(path.join(root, "evidence"));
  await writeJson(root, "deployment-readiness.json", { ready: true });

  for (const viewport of routeViewports) {
    await writeJson(root, `routes-${viewport}.json`, {
      phase: "routes",
      aggregate: CURRENT_LIVE_ROLES.map((persona) => ({
        viewport,
        role: persona.role,
        expectationMisses: [],
        blankOrErrors: [],
        overflowRoutes: [],
        overlapRoutes: [],
        deadLinkRoutes: [],
        unlabeledControlRoutes: [],
        networkErrors: [],
        consoleErrors: [],
      })),
    });
  }

  for (const { name: viewport } of REQUIRED_TRANSACTION_VIEWPORTS) {
    const screenshots = new Set();
    const workflows = workflowsFor(viewport, screenshots);
    for (const screenshot of screenshots) {
      await writeFile(path.join(root, "evidence", screenshot), "evidence");
    }
    await writeJson(root, `transactions-${viewport}.json`, {
      phase: "transactions",
      workflows,
      scenarioCoverage: evaluateScenarioCoverage(workflows, [viewport]),
      cleanup: {
        complete: true,
        results: [{ entity: "product-governance", remaining: 0 }],
      },
    });
    await writeJson(root, `cleanup-${viewport}.json`, {
      viewport,
      complete: true,
      results: [{ entity: "fixture", remaining: 0 }],
    });
  }
  return root;
}

test("certification verifier accepts complete local shards and their union", async () => {
  const root = await makeCertificationBundle();
  try {
    assert.deepEqual(await verifyCertificationBundle(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("certification verifier rejects a missing viewport and incomplete union", async () => {
  const root = await makeCertificationBundle();
  try {
    await unlink(path.join(root, "transactions-mobile-390.json"));
    const failures = await verifyCertificationBundle(root);
    assert.ok(
      failures.some((failure) =>
        failure.includes("transactions-mobile-390.json is missing"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("cross-shard coverage") &&
          failure.includes("mobile-390"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("certification verifier rejects a shard claiming the union", async () => {
  const root = await makeCertificationBundle();
  try {
    const file = path.join(root, "transactions-desktop-1440.json");
    const report = JSON.parse(await readFile(file, "utf8"));
    report.scenarioCoverage = evaluateScenarioCoverage(report.workflows);
    await writeJson(root, "transactions-desktop-1440.json", report);
    const failures = await verifyCertificationBundle(root);
    assert.ok(
      failures.some((failure) =>
        failure.includes("does not certify only its selected viewport"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static launch verifier no longer relies on quote-sensitive source includes", async () => {
  const source = await readFile(
    new URL("./verify-launch-artifacts.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /crawler\.includes\(/);
  assert.doesNotMatch(source, /providers\.includes\(/);
  assert.match(source, /hasRequiredEnvironmentGuard/);
  assert.match(source, /hasEnvironmentComparison/);
});
