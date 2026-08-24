import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const attestationPath = path.join(
  root,
  "docs/manual/assets/knowledge-base/task-stage-ci-attestation.json",
);

export const EXPECTED_ATTESTATION = Object.freeze({
  schemaVersion: 1,
  repository: "normanwashere/mwell-intra",
  runId: 32653705717,
  runUrl: "https://github.com/normanwashere/mwell-intra/actions/runs/32653705717",
  apiUrl: "https://api.github.com/repos/normanwashere/mwell-intra/actions/runs/32653705717",
  status: "completed",
  conclusion: "success",
  headSha: "138e326f05d016d26393841cbf57695787cfe226",
  sourceCommit: "138e326f05d016d26393841cbf57695787cfe226",
  runAttempt: 1,
  workflowName: "UAT Live Certification",
  workflowPath: ".github/workflows/uat-live-certification.yml",
  event: "push",
  headBranch: "codex/uat-launch-blockers",
  fetchedAt: "2026-08-25T04:10:00.000Z",
  responseDigest: "5325f75aa82234a5b3816f51b2cd216aacf0233d58263e28100b66dc2e707f9c",
});

const EXPECTED_KEYS = Object.freeze(Object.keys(EXPECTED_ATTESTATION));

function digest(payload) {
  const { responseDigest: _ignored, ...unsigned } = payload;
  return createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
}

function projectRun(run) {
  return {
    schemaVersion: 1,
    repository: run.repository?.full_name,
    runId: run.id,
    runUrl: run.html_url,
    apiUrl: run.url,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    sourceCommit: run.head_sha,
    runAttempt: run.run_attempt,
    workflowName: run.name,
    workflowPath: run.path,
    event: run.event,
    headBranch: run.head_branch,
    fetchedAt: new Date().toISOString(),
  };
}

export function validateAttestation(attestation) {
  const errors = [];
  const actualKeys = Object.keys(attestation ?? {});
  for (const field of EXPECTED_KEYS) {
    if (!Object.hasOwn(attestation ?? {}, field)) {
      errors.push(`CI attestation ${field} is missing.`);
    }
  }
  for (const field of actualKeys) {
    if (!EXPECTED_KEYS.includes(field)) {
      errors.push(`CI attestation has unexpected field ${field}.`);
    }
  }
  for (const [field, expected] of Object.entries(EXPECTED_ATTESTATION)) {
    if (attestation[field] !== expected) {
      const label = field === "conclusion"
        ? "successful conclusion"
        : field === "headSha" || field === "sourceCommit"
          ? "head SHA"
          : field;
      errors.push(`CI attestation ${label} must be ${expected}.`);
    }
  }
  if (attestation.responseDigest !== EXPECTED_ATTESTATION.responseDigest) {
    errors.push("CI attestation digest must match the anchored expected response digest.");
  }
  if (digest(EXPECTED_ATTESTATION) !== EXPECTED_ATTESTATION.responseDigest) {
    errors.push("CI attestation anchored expected digest is internally inconsistent.");
  }
  return errors;
}

function validateFetchedRun(projected) {
  const errors = [];
  for (const field of EXPECTED_KEYS.filter((key) => !["fetchedAt", "responseDigest"].includes(key))) {
    if (projected[field] !== EXPECTED_ATTESTATION[field]) {
      errors.push(`GitHub run ${field} must be ${EXPECTED_ATTESTATION[field]}.`);
    }
  }
  return errors;
}

async function main() {
  const write = process.argv.includes("--write");
  if (write) {
    const response = await fetch(EXPECTED_ATTESTATION.apiUrl, {
      headers: { "User-Agent": "mwell-intra-handbook-attestation" },
    });
    if (!response.ok) {
      throw new Error(`GitHub run fetch failed: ${response.status} ${response.statusText}`);
    }
    const projected = projectRun(await response.json());
    const fetchedErrors = validateFetchedRun(projected);
    if (fetchedErrors.length) throw new Error(fetchedErrors.join("\n"));
    projected.responseDigest = digest(projected);
    await writeFile(attestationPath, `${JSON.stringify(projected, null, 2)}\n`, "utf8");
    console.log(`Updated ${path.relative(root, attestationPath)}.`);
    return;
  }

  const attestation = JSON.parse(await readFile(attestationPath, "utf8"));
  const errors = validateAttestation(attestation);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Verified ${path.relative(root, attestationPath)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
