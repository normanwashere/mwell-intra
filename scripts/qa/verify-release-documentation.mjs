import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LEGACY_ROUTES } from "../docs/handbook-guides.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const REQUIRED_DOCUMENTS = [
  "docs/manual/MWELL_INTRA_USER_MANUAL.md",
  "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md",
  "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md",
  "docs/TRAINING_AND_HANDOVER_CONTENT.md",
  "docs/manual/index.html",
];

export const LEGACY_ROUTE_COUNT_DOCUMENTS = [
  {
    file: "docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md",
    prefix: "Exhaustive migration from all ",
    suffix: " maintained legacy tab, article, and heading routes",
  },
  {
    file: "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md",
    prefix: "and ",
    suffix: " legacy-route migrations",
  },
  {
    file: "docs/TRAINING_AND_HANDOVER_CONTENT.md",
    prefix: "and ",
    suffix: " migrated legacy links",
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateLegacyRouteDocumentation(documents, expectedCount = LEGACY_ROUTES.length) {
  const failures = [];
  for (const { file, prefix, suffix } of LEGACY_ROUTE_COUNT_DOCUMENTS) {
    const contents = documents[file];
    if (typeof contents !== "string") {
      failures.push(`${file} is unavailable for legacy-route count verification.`);
      continue;
    }
    const declaration = new RegExp(`${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}`, "i").exec(contents);
    if (!declaration) {
      failures.push(`${file} does not declare its certified legacy-route count.`);
      continue;
    }
    const declaredCount = Number(declaration[1]);
    if (declaredCount !== expectedCount) {
      failures.push(`${file} declares ${declaredCount} legacy routes; generated LEGACY_ROUTES contains ${expectedCount}.`);
    }
  }
  return { ready: failures.length === 0, expectedCount, failures };
}

function readLegacyRouteCountDocuments() {
  return Object.fromEntries(
    LEGACY_ROUTE_COUNT_DOCUMENTS.map(({ file }) => [
      file,
      existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), "utf8") : null,
    ]),
  );
}

function normalized(file) {
  return file.replaceAll("\\", "/");
}

export function isOperationalSource(file) {
  const name = normalized(file);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return false;
  if (name.includes("/__tests__/")) return false;
  if (name.startsWith("apps/shell/lib/knowledge/")) return false;
  return (
    (name.startsWith("apps/shell/app/") &&
      !name.startsWith("apps/shell/app/api/")) ||
    name.startsWith("apps/shell/components/") ||
    /^modules\/[^/]+\/src\//.test(name) ||
    /^packages\/[^/]+\/src\//.test(name)
  );
}

export function validateDocumentationSync(changedFiles) {
  const changed = [...new Set(changedFiles.map(normalized))];
  const operationalFiles = changed.filter(isOperationalSource);
  const documentationFiles = changed.filter(
    (file) =>
      file.startsWith("apps/shell/lib/knowledge/") || file.startsWith("docs/"),
  );

  if (operationalFiles.length === 0) {
    return { ready: true, operationalFiles, documentationFiles, failures: [] };
  }

  const failures = [];
  if (!changed.some((file) => file.startsWith("apps/shell/lib/knowledge/"))) {
    failures.push("Live Knowledge Base content was not updated.");
  }
  for (const document of REQUIRED_DOCUMENTS) {
    if (!changed.includes(document))
      failures.push(`${document} was not updated.`);
  }
  if (
    !changed.some((file) =>
      /^docs\/releases\/\d{4}-\d{2}-\d{2}-.+\.md$/.test(file),
    )
  ) {
    failures.push(
      "A dated docs/releases release note was not added or updated.",
    );
  }

  return {
    ready: failures.length === 0,
    operationalFiles,
    documentationFiles,
    failures,
  };
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function validCommit(value) {
  if (!value || /^0+$/.test(value)) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${value}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function resolveComparisonBase(explicitBase) {
  const candidates = [
    explicitBase,
    process.env.DOCUMENTATION_BASE_SHA,
    process.env.GITHUB_EVENT_BEFORE,
    "HEAD^",
  ];
  return candidates.find(validCommit) ?? null;
}

function changedFiles(base, head) {
  if (!base) return [];
  const output = git("diff", "--name-only", `${base}..${head}`);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function sha256(file) {
  return createHash("sha256")
    .update(readFileSync(path.join(root, file)))
    .digest("hex");
}

function countImages(directory) {
  if (!directory || !existsSync(directory)) return 0;
  let count = 0;
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) count += countImages(target);
    else if (/\.(png|jpe?g|webp)$/i.test(entry)) count += 1;
  }
  return count;
}

function writeManifest(target, payload, evidenceDir) {
  const output = path.resolve(root, target);
  mkdirSync(path.dirname(output), { recursive: true });
  const documents = Object.fromEntries(
    REQUIRED_DOCUMENTS.map((file) => [file, { sha256: sha256(file) }]),
  );
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commit: git("rev-parse", "HEAD"),
        ...payload,
        documents,
        liveEvidenceImageCount: countImages(
          evidenceDir ? path.resolve(root, evidenceDir) : undefined,
        ),
      },
      null,
      2,
    )}\n`,
  );
}

export function runDocumentationVerification() {
  const head = argument("--head") ?? "HEAD";
  const base = resolveComparisonBase(argument("--base"));
  const files = changedFiles(base, head);
  const result = validateDocumentationSync(files);
  const legacyRouteResult = validateLegacyRouteDocumentation(
    readLegacyRouteCountDocuments(),
  );
  const failures = [...result.failures, ...legacyRouteResult.failures];
  const payload = {
    base,
    head: git("rev-parse", head),
    changedFiles: files,
    ...result,
    ready: failures.length === 0,
    failures,
    legacyRouteCount: legacyRouteResult.expectedCount,
  };

  const manifest = argument("--manifest");
  if (manifest) writeManifest(manifest, payload, argument("--evidence-dir"));

  if (failures.length > 0) {
    throw new Error(
      `Release documentation is stale:\n- ${failures.join("\n- ")}`,
    );
  }

  console.log(
    operationalFilesMessage(
      result.operationalFiles.length,
      result.documentationFiles.length,
    ),
  );
  return payload;
}

function operationalFilesMessage(operationalCount, documentationCount) {
  return operationalCount === 0
    ? "Release documentation check passed: no operational source changed."
    : `Release documentation check passed: ${operationalCount} operational and ${documentationCount} documentation files changed.`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runDocumentationVerification();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
