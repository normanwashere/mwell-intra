import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const shellDirectory = resolve(process.cwd(), "apps/shell");
const vitestCli = resolve(shellDirectory, "node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitestCli,
    "run",
    "lib/knowledge/content.test.ts",
    "lib/knowledge/validate.test.ts",
  ],
  {
    cwd: shellDirectory,
    stdio: "inherit",
    env: { ...process.env, KNOWLEDGE_ARTIFACT_GATE: "1" },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Knowledge Base content and evidence provenance verified.");
