import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const attestationPath = path.join(
  root,
  "docs/manual/assets/knowledge-base/task-stage-ci-attestation.json",
);

const REQUIRED = Object.freeze({
  repository: "normanwashere/mwell-intra",
  runId: 32653705717,
  runUrl: "https://github.com/normanwashere/mwell-intra/actions/runs/32653705717",
  apiUrl: "https://api.github.com/repos/normanwashere/mwell-intra/actions/runs/32653705717",
  conclusion: "success",
  status: "completed",
  headSha: "138e326f05d016d26393841cbf57695787cfe226",
  sourceCommit: "138e326f05d016d26393841cbf57695787cfe226",
});

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
  for (const [field, expected] of Object.entries(REQUIRED)) {
    if (attestation[field] !== expected) {
      const label = field === "conclusion"
        ? "successful conclusion"
        : field === "headSha" || field === "sourceCommit"
          ? "head SHA"
          : field;
      errors.push(`CI attestation ${label} must be ${expected}.`);
    }
  }
  if (attestation.responseDigest !== digest(attestation)) {
    errors.push("CI attestation digest does not match its signed payload.");
  }
  return errors;
}

async function main() {
  const write = process.argv.includes("--write");
  if (write) {
    const response = await fetch(REQUIRED.apiUrl, {
      headers: { "User-Agent": "mwell-intra-handbook-attestation" },
    });
    if (!response.ok) {
      throw new Error(`GitHub run fetch failed: ${response.status} ${response.statusText}`);
    }
    const projected = projectRun(await response.json());
    projected.responseDigest = digest(projected);
    const errors = validateAttestation(projected);
    if (errors.length) throw new Error(errors.join("\n"));
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
