import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  command,
  [
    "--filter",
    "@intra/shell",
    "exec",
    "vitest",
    "run",
    "lib/knowledge/content.test.ts",
    "lib/knowledge/validate.test.ts",
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, KNOWLEDGE_ARTIFACT_GATE: "1" },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Knowledge Base content and evidence provenance verified.");
