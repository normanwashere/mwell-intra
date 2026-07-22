import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForExactDeployment({
  baseUrl,
  expectedCommit,
  expectedAppEnv,
  expectedProjectRef,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
  onAttempt = () => {},
}) {
  if (!/^https:\/\//.test(String(baseUrl ?? "")))
    throw new Error("AUDIT_BASE_URL must be an HTTPS URL.");
  if (!/^[a-f0-9]{40}$/.test(String(expectedCommit ?? "")))
    throw new Error("GITHUB_SHA must be a full 40-character commit SHA.");
  if (!expectedAppEnv || !expectedProjectRef)
    throw new Error(
      "Expected app environment and Supabase project are required.",
    );

  const startedAt = Date.now();
  let attempts = 0;
  let lastObservation = "No response received.";
  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      const url = new URL("/api/health", `${baseUrl}/`);
      url.searchParams.set("certificationCommit", expectedCommit);
      url.searchParams.set("attempt", String(attempts));
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: { "cache-control": "no-cache, no-store, must-revalidate" },
      });
      if (response.ok) {
        const payload = await response.json();
        const appEnv = payload?.deployment?.appEnv;
        const projectRef = payload?.deployment?.supabaseProjectRef;
        const commit = payload?.commit;
        if (appEnv && appEnv !== expectedAppEnv)
          throw new Error(
            `Wrong APP_ENV: expected ${expectedAppEnv}, received ${appEnv}.`,
          );
        if (projectRef && projectRef !== expectedProjectRef)
          throw new Error(
            `Wrong Supabase project: expected ${expectedProjectRef}, received ${projectRef}.`,
          );
        if (
          appEnv === expectedAppEnv &&
          projectRef === expectedProjectRef &&
          commit === expectedCommit
        ) {
          const result = {
            ready: true,
            attempts,
            checkedAt: new Date().toISOString(),
            baseUrl,
            appEnv,
            projectRef,
            commit,
          };
          onAttempt(result);
          return result;
        }
        lastObservation = `health commit ${String(commit ?? "missing")} (waiting for ${expectedCommit})`;
      } else {
        lastObservation = `health returned HTTP ${response.status}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/^Wrong (APP_ENV|Supabase project):/.test(message)) throw error;
      lastObservation = message;
    }
    onAttempt({ ready: false, attempts, observation: lastObservation });
    if (Date.now() - startedAt + intervalMs > timeoutMs) break;
    await sleepImpl(intervalMs);
  }
  throw new Error(
    `Timed out waiting for deployed commit ${expectedCommit}. Last observation: ${lastObservation}`,
  );
}

async function writeEvidence(outputPath, evidence) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function main() {
  const outputPath =
    process.env.DEPLOYMENT_EVIDENCE_PATH ??
    "test-results/deployment-readiness.json";
  try {
    const result = await waitForExactDeployment({
      baseUrl: process.env.AUDIT_BASE_URL,
      expectedCommit: process.env.GITHUB_SHA,
      expectedAppEnv: process.env.APP_ENV,
      expectedProjectRef: process.env.SUPABASE_PROJECT_REF,
      timeoutMs: Number(
        process.env.DEPLOYMENT_WAIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
      ),
      intervalMs: Number(
        process.env.DEPLOYMENT_WAIT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
      ),
      onAttempt: (attempt) => console.log(JSON.stringify(attempt)),
    });
    await writeEvidence(outputPath, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeEvidence(outputPath, {
      ready: false,
      checkedAt: new Date().toISOString(),
      baseUrl: process.env.AUDIT_BASE_URL ?? null,
      expectedCommit: process.env.GITHUB_SHA ?? null,
      error: message,
    });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
