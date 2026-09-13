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

test("CI174 vendor failure blocks certification without a false viewport-scope error", async () => {
  const root = await makeCertificationBundle();
  try {
    const name = "transactions-desktop-1440.json";
    const report = JSON.parse(await readFile(path.join(root, name), "utf8"));
    const invite = report.workflows.find(
      (workflow) => workflow.workflow === "legal vendor invite",
    );
    invite.ok = false;
    report.scenarioCoverage = evaluateScenarioCoverage(report.workflows, [
      "desktop-1440",
    ]);
    assert.equal(
      report.scenarioCoverage.find((item) => item.id === "vendor-accreditation")
        .complete,
      false,
    );
    await writeJson(root, name, report);

    const failures = await verifyCertificationBundle(root);
    assert.ok(failures.includes(`${name} workflow legal vendor invite failed`));
    assert.ok(
      failures.includes(
        `${name} scenario vendor-accreditation reports incomplete coverage for desktop-1440`,
      ),
    );
    assert.ok(
      failures.some((failure) =>
        failure.startsWith(
          "cross-shard coverage: scenario vendor-accreditation/desktop-1440 incomplete:",
        ),
      ),
    );
    assert.ok(
      failures.every(
        (failure) => !failure.includes("does not certify only its selected viewport"),
      ),
    );
    assert.ok(failures.every((failure) => !failure.includes("mobile-390")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const complete of [false, undefined]) {
  test(`certification verifier rejects ${complete} completion metadata independently of scope`, async () => {
    const root = await makeCertificationBundle();
    try {
      const name = "transactions-desktop-1440.json";
      const report = JSON.parse(await readFile(path.join(root, name), "utf8"));
      const scenario = report.scenarioCoverage[0];
      scenario.complete = complete;
      await writeJson(root, name, report);
      assert.deepEqual(await verifyCertificationBundle(root), [
        `${name} scenario ${scenario.id} reports incomplete coverage for desktop-1440`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const requiredViewports of [undefined, [], ["mobile-390"]]) {
  test(`certification verifier rejects invalid viewport metadata ${JSON.stringify(requiredViewports)}`, async () => {
    const root = await makeCertificationBundle();
    try {
      const name = "transactions-desktop-1440.json";
      const report = JSON.parse(await readFile(path.join(root, name), "utf8"));
      report.scenarioCoverage[0].requiredViewports = requiredViewports;
      await writeJson(root, name, report);
      assert.deepEqual(await verifyCertificationBundle(root), [
        `${name} does not certify only its selected viewport`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("certification verifier rejects missing local scenario coverage", async () => {
  const root = await makeCertificationBundle();
  try {
    const name = "transactions-desktop-1440.json";
    const report = JSON.parse(await readFile(path.join(root, name), "utf8"));
    delete report.scenarioCoverage;
    await writeJson(root, name, report);
    assert.deepEqual(await verifyCertificationBundle(root), [
      `${name} does not certify only its selected viewport`,
    ]);
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
  assert.match(source, /Mwell Intra Standalone Operating Handbook/);
  assert.match(source, /Process Reference Library/);
  assert.doesNotMatch(source, /manual missing the live Knowledge Base link/);
});

test("explicit route non-execution and substantive legacy transaction evidence remain compatible", async () => {
  const root = await makeCertificationBundle();
  try {
    for (const viewport of routeViewports) {
      const file = `routes-${viewport}.json`;
      const report = JSON.parse(await readFile(path.join(root, file), "utf8"));
      report.scenarioCoverage = evaluateScenarioCoverage([], []);
      report.cleanup = { status: "not-applicable", complete: false, results: [], reason: "Route-only phase" };
      await writeJson(root, file, report);
    }
    for (const { name: viewport } of REQUIRED_TRANSACTION_VIEWPORTS) {
      const file = `transactions-${viewport}.json`;
      const report = JSON.parse(await readFile(path.join(root, file), "utf8"));
      for (const scenario of report.scenarioCoverage) delete scenario.status;
      await writeJson(root, file, report);
    }
    assert.deepEqual(await verifyCertificationBundle(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const status of ["not-run", "not-applicable"]) {
  for (const target of ["scenario", "transaction-cleanup", "standalone-cleanup"]) {
    test(`bundle rejects ${target} ${status} even with complete true`, async () => {
      const root = await makeCertificationBundle();
      try {
        const file = target === "standalone-cleanup" ? "cleanup-desktop-1440.json" : "transactions-desktop-1440.json";
        const report = JSON.parse(await readFile(path.join(root, file), "utf8"));
        const evidence = target === "scenario" ? report.scenarioCoverage[0] : target === "transaction-cleanup" ? report.cleanup : report;
        evidence.status = status;
        evidence.complete = true;
        await writeJson(root, file, report);
        assert.ok((await verifyCertificationBundle(root)).length > 0);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
}

test("bundle rejects vacuous per-viewport completion and relabeled route evidence", async () => {
  const root = await makeCertificationBundle();
  try {
    const file = "transactions-desktop-1440.json";
    const report = JSON.parse(await readFile(path.join(root, file), "utf8"));
    for (const perViewport of [undefined, [], {}, [{ viewport: "mobile-390", complete: true }], [{ viewport: "desktop-1440", complete: false }]]) {
      report.scenarioCoverage[0].perViewport = perViewport;
      await writeJson(root, file, report);
      assert.ok((await verifyCertificationBundle(root)).length > 0);
    }
    await writeJson(root, file, { phase: "transactions", workflows: [], scenarioCoverage: evaluateScenarioCoverage([], []), cleanup: { complete: true, results: [] } });
    const failures = await verifyCertificationBundle(root);
    assert.ok(failures.some(failure => failure.includes("no workflow evidence")));
    assert.ok(failures.some(failure => failure.includes("cross-shard coverage")));
    assert.ok(failures.some(failure => failure.includes("cleanup")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const results of [[], [{ entity: "fixture", remaining: 1 }], [{ entity: "fixture", remaining: null }], [{ entity: "fixture", remaining: 0, error: "failed readback" }]]) {
  test(`standalone cleanup cannot claim completion with ${JSON.stringify(results)}`, async () => {
    const root = await makeCertificationBundle();
    try {
      await writeJson(root, "cleanup-desktop-1440.json", { viewport: "desktop-1440", complete: true, results });
      assert.ok((await verifyCertificationBundle(root)).includes("cleanup-desktop-1440.json does not prove zero residue"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const result of [
  { remaining: 1 },
  { remaining: null },
  {},
  { remaining: 0, error: "failed readback" },
]) {
  test(`transaction cleanup rejects non-Product residue despite valid standalone cleanup: ${JSON.stringify(result)}`, async () => {
    const root = await makeCertificationBundle();
    try {
      const file = "transactions-desktop-1440.json";
      const report = JSON.parse(await readFile(path.join(root, file), "utf8"));
      report.cleanup.status = "complete";
      report.cleanup.results.push({ entity: "other-fixture", ...result });
      await writeJson(root, file, report);
      assert.deepEqual(await verifyCertificationBundle(root), [
        "transactions-desktop-1440.json reports incomplete cleanup",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
