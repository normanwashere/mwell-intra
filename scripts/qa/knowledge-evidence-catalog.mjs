import { createRequire } from "node:module";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(".");
const require = createRequire(path.resolve("apps/shell/package.json"));
const { build } = require("esbuild");
const outputPath = path.resolve(
  process.env.KNOWLEDGE_EVIDENCE_CATALOG ??
    "output/knowledge-evidence/catalog.json",
);

const bundled = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      import { KNOWLEDGE_CONTENT } from "./apps/shell/lib/knowledge/content.ts";
      import {
        evidenceRequirements,
        validateEvidenceRequirements,
      } from "./apps/shell/lib/knowledge/evidenceContract.ts";
      export const requirements = evidenceRequirements(KNOWLEDGE_CONTENT);
      export const errors = validateEvidenceRequirements(requirements, {
        deployedCommit: process.env.DEPLOYED_COMMIT || undefined,
      });
    `,
    resolveDir: root,
    sourcefile: "knowledge-evidence-catalog-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
});

const moduleUrl = `${pathToFileURL(
  path.join(root, "knowledge-evidence-catalog.mjs"),
).href}?bundle=${Buffer.from(bundled.outputFiles[0].text).toString("base64url")}`;
const generated = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${bundled.outputFiles[0].text}\n//# sourceURL=${moduleUrl}`,
  ).toString("base64")}`
);

if (generated.errors.length) {
  throw new Error(
    `Knowledge evidence catalog is invalid:\n- ${generated.errors.join("\n- ")}`,
  );
}

const sourceCommits = new Set(
  generated.requirements.map((item) => item.sourceCommit),
);
if (sourceCommits.size !== 1)
  throw new Error("Knowledge evidence must be tied to one source commit.");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit: [...sourceCommits][0],
  environment: "production",
  count: generated.requirements.length,
  requirements: generated.requirements.map((item) => ({
    ...item,
    targetSelector: { strategy: "semantic-key", value: item.targetKey },
  })),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (/service_role|AUDIT_PASSWORD|eyJ[a-zA-Z0-9_-]{20,}/.test(serialized))
  throw new Error("Credential-shaped content was rejected from the catalog.");

await mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, serialized, "utf8");
await rename(temporary, outputPath);
console.log(
  `PASS Knowledge evidence catalog: ${report.count} production requirements.`,
);
