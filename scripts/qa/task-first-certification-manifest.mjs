import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HANDBOOK_EVIDENCE_TARGETS } from "./handbook-evidence-targets.mjs";
import { planControl } from "./task-first-control-review.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const destination = path.join(root, "docs/training/task-first-certification-manifest.json");

export async function buildManifest() {
  const require = createRequire(path.join(root, "apps/shell/package.json"));
  const { build } = require("esbuild");
  const bundled = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { KNOWLEDGE_CONTENT } from './apps/shell/lib/knowledge/content.ts';
        import { validateTaskCoverage } from './apps/shell/lib/knowledge/coverage.ts';
        export const content = KNOWLEDGE_CONTENT;
        export const coverage = validateTaskCoverage(content);`,
      resolveDir: root, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", target: "node22", write: false,
  });
  const { content, coverage } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const evidence = content.evidence.map((item) => ({
    id: item.id, featureId: item.featureId ?? null, flowId: item.flowId ?? null,
    relatedFlowIds: content.flows.filter((flow) => flow.nodes.some((node) => node.id === item.nodeId)).map((flow) => flow.id),
    nodeId: item.nodeId ?? null, route: item.route, roleId: item.roleId,
    state: item.state, expectedLandmark: item.expectedLandmark,
    sourceCommit: item.appCommit, capturedAt: item.capturedAt,
    historicalReviewedAt: item.reviewedAt, environment: item.environment,
    targets: item.hotspots.map(({ label, instruction }) => ({ label, instruction })),
    artifacts: ["desktop", "mobile"].map((viewport) => {
      const src = item[`${viewport}Src`];
      const artifact = src?.startsWith("/") ? `apps/shell/public${src}` : null;
      return { viewport, src, repositoryPath: artifact, exists: Boolean(artifact && existsSync(path.join(root, artifact))) };
    }),
    candidateCertification: "notcaptured",
  }));
  const controls = coverage.inventory.filter((row) => row.executable).map((row) => {
    const related = evidence.filter((item) => item.featureId === row.featureId ||
      item.relatedFlowIds.some((id) => row.flowIds.includes(id)) || row.routes.includes(item.route));
    // Label matches are only candidates: identical names on unrelated pages are not bindings.
    const targetCandidates = Object.entries(HANDBOOK_EVIDENCE_TARGETS)
      .filter(([, target]) => target.names.includes(row.control))
      .map(([bindingId, target]) => ({ bindingId, ...target, scopeVerified: false }));
    const feature = content.features.find((item) => item.id === row.featureId);
    return {
      id: row.key, featureId: row.featureId, control: row.control,
      routes: row.routes, roleIds: row.roleIds, capabilityIds: row.capabilityIds,
      owner: row.owner, prerequisite: row.prerequisite,
      behavior: feature.controls.find((item) => item.name === row.control).behavior,
      expectedResult: row.result, recovery: row.recovery,
      capturePlan: planControl(row),
      referenceId: row.referenceId, policyReferences: row.policyReferences,
      target: { source: "documented-control-name", name: row.control,
        role: null, locator: null, scopeVerified: false,
        resolution: "Confirm exact live accessible role/name or stable field target within the authorized route and fixture; do not use a first-match fallback." },
      existingToolTargetCandidates: targetCandidates,
      historicalEvidenceIds: related.map((item) => item.id),
      exactControlEvidenceIds: row.evidenceIds,
      tooling: ["scripts/qa/knowledge-evidence-catalog.mjs", "scripts/qa/capture-knowledge-evidence.mjs",
        "scripts/qa/handbook-evidence-targets.mjs", "scripts/qa/capture-handbook-stage-evidence.mjs"],
      toolingCoverage: targetCandidates.length ? "label-candidate-only-scope-unverified" : "new-control-target-binding-required",
      status: "notcaptured", blockedBy: ["capture-run-exact-protected-candidate-health-binding", "exact-target-and-approved-state-resolution", "desktop-mobile-capture-and-independent-review"],
      authorization: "Read-only observation only. Do not invoke state-changing controls; main/process owner must authorize any separate synthetic transition session.",
      capture: { deployedCommit: null, fixtureReference: null, desktopPath: null, mobilePath: null,
        capturedAt: null, reviewer: null, reviewedAt: null, outcome: null },
    };
  });
  return { schemaVersion: 1, purpose: "Planning inventory, not certification results",
    baselineLimitations: {
      directory: "outputs/task-first-live-baseline/desktop",
      evidenceBasis: "Assistant-reviewed baseline administrator Knowledge Base first frame (main's tool-image review); not an independent review of every baseline image. No user review or acceptance claimed.",
      reportedLiveBaselineCommit: "7083373",
      baselineIsPendingCandidate: false,
      exampleArtifact: "outputs/task-first-live-baseline/desktop/desktop-1440-platform-administrator-knowledge-allowed-frame-01.jpg",
      blockers: [
        { id: "masked-target-controls", classification: "privacy-redaction-not-ui-defect",
          scope: "Harness masks inputs in magenta, including blank search. Masked target controls cannot establish instructional appearance or exact control state.",
          resolution: "Main must approve a privacy-safe capture with the target visible and no sensitive values; preserve existing redacted baseline artifacts." },
        { id: "existing-user-not-fresh-pilot", classification: "evidence-scope-limitation",
          scope: "All-complete onboarding shows an existing user's state only, not a fresh-user journey or human pilot result.",
          resolution: "Keep fresh-user acceptance pending approved first-time participants and actual observed sessions." },
      ],
      certifiedControls: 0, humanPilotResults: 0,
    },
    candidate: {
      deployedCommit: "39a509cab9a769c1b1c611fa9decd55d0b02c454",
      url: "https://mwell-intra-6ena7ruqm-normans-projects-d718ecb1.vercel.app",
      healthVerifiedAt: null, healthEvidenceBasis: "Main reports health OK and correct UAT project; exact timestamp not supplied. Capture run must record its own observed health metadata.",
      status: "protected-deployed-main-health-confirmed",
      publicAliasCommit: "7083373", publicAliasStatus: "unchanged-pending-genuine-vendor-review",
    },
    counts: { controls: controls.length, excludedRoadmapControls: coverage.inventory.length - controls.length,
      historicalEvidenceRecords: evidence.length, artifactReferences: evidence.reduce((n, item) => n + item.artifacts.length, 0),
      uniqueArtifactPaths: new Set(evidence.flatMap((item) => item.artifacts.map((artifact) => artifact.repositoryPath))).size,
      missingArtifactReferences: evidence.flatMap((item) => item.artifacts).filter((item) => !item.exists).length,
      exactControlEvidenceMatches: controls.filter((item) => item.exactControlEvidenceIds.length).length,
      controlsWithToolLabelCandidates: controls.filter((item) => item.existingToolTargetCandidates.length).length,
      safetyClasses: Object.fromEntries([...new Set(controls.map((item) => item.capturePlan.classification))].sort()
        .map((classification) => [classification, controls.filter((item) => item.capturePlan.classification === classification).length])),
      certifiedControls: 0, notcaptured: controls.length },
    evidence, controls };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = `${JSON.stringify(await buildManifest(), null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8") !== result) throw new Error("Certification planning manifest is stale; regenerate before review.");
  } else {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, result);
  }
  console.log(JSON.stringify(JSON.parse(result).counts));
}
