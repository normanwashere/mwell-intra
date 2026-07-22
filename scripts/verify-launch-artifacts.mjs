import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CURRENT_LIVE_ROLES,
  REQUIRED_TRANSACTION_VIEWPORTS,
  evaluateScenarioCoverage,
  scenarioCoverageFailures,
} from "./qa/live-e2e-scenarios.mjs";

const requiredDocs = [
  "docs/REQUIREMENTS_TRACEABILITY_MATRIX.md",
  "docs/UAT_AND_ISSUE_MANAGEMENT.md",
  "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md",
  "docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md",
  "docs/import-templates/README.md",
  "docs/manual/MWELL_INTRA_USER_MANUAL.md",
];

const csvHeaders = new Map([
  [
    "docs/import-templates/users-v1.csv",
    "template_version,email,full_name,status,module,role",
  ],
  [
    "docs/import-templates/warehouse-locations-bins-v1.csv",
    "template_version,location_external_id,location_name,location_type,bin_code,bin_label,zone,active",
  ],
  [
    "docs/import-templates/warehouse-products-opening-stock-v1.csv",
    "template_version,sku,product_name,category,serialized,unit_cost,reorder_point,location_external_id,bin_code,quantity,serial_number",
  ],
  [
    "docs/import-templates/vendors-v1.csv",
    "template_version,vendor_external_id,company_name,contact_email,category,jurisdiction,risk_tier,status",
  ],
]);

const routeViewports = [
  "desktop-1440",
  "desktop-1280",
  "tablet-768",
  "mobile-390",
  "mobile-360",
  "mobile-320",
];

const productWorkflowNames = [
  "Product contributor readiness and pricing submission",
  "Product owner go-live and pricing decision",
  "Operations Product handoff acknowledgement",
];

function sourceWithoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readsEnvironmentVariable(source, variable) {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`process\\s*\\.\\s*env\\s*\\.\\s*${escaped}\\b`).test(
    sourceWithoutComments(source),
  );
}

function hasEnvironmentComparison(source, variable, value) {
  const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `process\\s*\\.\\s*env\\s*\\.\\s*${escapedVariable}\\s*===?\\s*(["'])${escapedValue}\\1`,
  ).test(sourceWithoutComments(source));
}

function hasRequiredEnvironmentGuard(source) {
  const code = sourceWithoutComments(source);
  const assignment = code.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*process\s*\.\s*env\s*\.\s*AUDIT_PASSWORD\s*;/,
  );
  if (!assignment) return false;
  const escapedIdentifier = assignment[1].replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(
    `if\\s*\\(\\s*!\\s*${escapedIdentifier}\\s*\\)\\s*\\{[\\s\\S]*?throw\\s+new\\s+Error\\s*\\(`,
  ).test(code);
}

function markdownHeadings(markdown) {
  return new Set(
    [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((match) =>
      match[1].replace(/[*_`]/g, "").trim(),
    ),
  );
}

function normalizedSql(source) {
  return source
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function readText(rootDir, relativePath) {
  return readFile(path.resolve(rootDir, relativePath), "utf8");
}

export async function verifyStaticLaunchArtifacts(rootDir = process.cwd()) {
  const failures = [];
  const advisorSnapshot = path.resolve(
    rootDir,
    "scripts/qa/snapshot-supabase-advisors.mjs",
  );
  if (!existsSync(advisorSnapshot)) {
    failures.push("Supabase advisor snapshot script is missing");
  }

  try {
    const pkg = JSON.parse(await readText(rootDir, "package.json"));
    if (
      pkg.scripts?.["verify:supabase-advisors"] !==
      "node scripts/qa/snapshot-supabase-advisors.mjs"
    ) {
      failures.push(
        "verify:supabase-advisors must run the governed snapshot script",
      );
    }
  } catch {
    failures.push("package.json could not be read for advisor verification");
  }

  for (const file of requiredDocs) {
    try {
      const content = await readText(rootDir, file);
      if (content.trim().length < 200) {
        failures.push(`${file}: content is incomplete`);
      }
    } catch {
      failures.push(`${file}: missing`);
    }
  }

  for (const [file, expected] of csvHeaders) {
    try {
      const content = await readText(rootDir, file);
      const actual = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
      if (actual !== expected) {
        failures.push(`${file}: header does not match v1 contract`);
      }
    } catch {
      failures.push(`${file}: missing`);
    }
  }

  try {
    const crawler = await readText(
      rootDir,
      "scripts/qa/full-intra-live-e2e.mjs",
    );
    if (
      !readsEnvironmentVariable(crawler, "AUDIT_PASSWORD") ||
      !hasRequiredEnvironmentGuard(crawler)
    ) {
      failures.push(
        "live crawler must read AUDIT_PASSWORD and reject a missing vaulted credential",
      );
    }
    if (/mWell-Demo-\d{4}!/.test(crawler)) {
      failures.push("live crawler contains an embedded demo password");
    }
  } catch {
    failures.push("scripts/qa/full-intra-live-e2e.mjs: missing");
  }

  try {
    const providers = await readText(rootDir, "apps/shell/app/providers.tsx");
    if (
      !hasEnvironmentComparison(
        providers,
        "NEXT_PUBLIC_DATA_SOURCE",
        "memory",
      ) ||
      !hasEnvironmentComparison(
        providers,
        "NEXT_PUBLIC_ALLOW_DEMO_IN_PROD",
        "true",
      ) ||
      !/NEXT_PUBLIC_DATA_SOURCE[\s\S]{0,160}&&[\s\S]{0,160}NEXT_PUBLIC_ALLOW_DEMO_IN_PROD/.test(
        sourceWithoutComments(providers),
      )
    ) {
      failures.push(
        "production demo mode must require both explicit escape-hatch flags",
      );
    }
  } catch {
    failures.push("apps/shell/app/providers.tsx: missing");
  }

  for (const file of [
    "apps/shell/app/knowledge/page.tsx",
    "apps/shell/lib/knowledge/content.ts",
    "apps/shell/lib/knowledge/workflows.ts",
    "docs/manual/index.html",
  ]) {
    try {
      const content = await readText(rootDir, file);
      if (content.trim().length < 100) {
        failures.push(`${file}: Knowledge Base artifact is incomplete`);
      }
    } catch {
      failures.push(`${file}: missing Knowledge Base artifact`);
    }
  }

  try {
    const manual = await readText(
      rootDir,
      "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    );
    const headings = markdownHeadings(manual);
    for (const required of [
      "Comprehensive Launch Flow",
      "User Types and Responsibilities",
      "Future Recommended Features",
    ]) {
      if (!headings.has(required)) {
        failures.push(`manual missing heading: ${required}`);
      }
    }
    if (
      !/https:\/\/mwell-intra\.vercel\.app\/knowledge(?:\b|\/)/.test(manual)
    ) {
      failures.push("manual missing the live Knowledge Base link");
    }
  } catch {
    failures.push("docs/manual/MWELL_INTRA_USER_MANUAL.md: missing");
  }

  try {
    const migration = normalizedSql(
      await readText(
        rootDir,
        "supabase/migrations/20260710043410_govern_warehouse_csv_exports.sql",
      ),
    );
    if (!/created_by\s*<>\s*auth\.uid\s*\(\s*\)/.test(migration)) {
      failures.push(
        "warehouse export review must enforce creator/reviewer separation",
      );
    }
    if (
      !/j\.status\s*=\s*'correction_required'/.test(migration) ||
      !/j\.export_type\s*=\s*v_kind/.test(migration)
    ) {
      failures.push(
        "warehouse export corrections must validate source status and type",
      );
    }
  } catch {
    failures.push("governed warehouse export migration: missing");
  }

  return failures;
}

async function listFiles(rootDir) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else files.push(absolute);
    }
  }
  await visit(rootDir);
  return files;
}

async function readJson(file, failures) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(
      `${path.basename(file)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function firstByBasename(files, basename) {
  return files.find((file) => path.basename(file) === basename);
}

function routeReportFailures(report, viewport) {
  const failures = [];
  if (report.phase !== "routes") {
    failures.push(`routes-${viewport}.json does not declare the routes phase`);
  }
  const aggregates = Array.isArray(report.aggregate) ? report.aggregate : [];
  if (!aggregates.length) {
    failures.push(`routes-${viewport}.json has no persona aggregate`);
  }
  const coveredRoles = new Set(aggregates.map((row) => row.role));
  for (const persona of CURRENT_LIVE_ROLES) {
    if (!coveredRoles.has(persona.role)) {
      failures.push(`routes-${viewport}.json omits persona ${persona.role}`);
    }
  }
  for (const row of aggregates) {
    if (row.viewport !== viewport) {
      failures.push(
        `routes-${viewport}.json contains foreign viewport ${row.viewport ?? "unknown"}`,
      );
    }
    for (const field of [
      "expectationMisses",
      "blankOrErrors",
      "overflowRoutes",
      "overlapRoutes",
      "deadLinkRoutes",
      "unlabeledControlRoutes",
      "networkErrors",
      "consoleErrors",
    ]) {
      if (!Array.isArray(row[field])) {
        failures.push(
          `routes-${viewport}.json ${row.role ?? "unknown role"} omits ${field}`,
        );
      } else if (row[field].length) {
        failures.push(
          `routes-${viewport}.json ${row.role ?? "unknown role"} reports ${field}`,
        );
      }
    }
  }
  return failures;
}

function transactionReportFailures(report, viewport, evidenceBasenames) {
  const failures = [];
  if (report.phase !== "transactions") {
    failures.push(
      `transactions-${viewport}.json does not declare the transactions phase`,
    );
  }
  if (!report.cleanup?.complete) {
    failures.push(`transactions-${viewport}.json reports incomplete cleanup`);
  }
  const productCleanup = report.cleanup?.results?.find(
    (item) => item.entity === "product-governance",
  );
  if (
    !productCleanup ||
    productCleanup.remaining !== 0 ||
    productCleanup.error
  ) {
    failures.push(
      `transactions-${viewport}.json does not certify Product cleanup`,
    );
  }
  const workflows = Array.isArray(report.workflows) ? report.workflows : [];
  if (!workflows.length) {
    failures.push(`transactions-${viewport}.json has no workflow evidence`);
  }
  for (const workflow of workflows) {
    if (workflow.viewport !== viewport) {
      failures.push(
        `transactions-${viewport}.json contains foreign viewport ${workflow.viewport ?? "unknown"}`,
      );
    }
    if (
      !workflow.ok ||
      workflow.error ||
      workflow.networkErrors?.length ||
      workflow.consoleErrors?.length
    ) {
      failures.push(
        `transactions-${viewport}.json workflow ${workflow.workflow ?? "unknown"} failed`,
      );
    }
    if (!Array.isArray(workflow.scenarioEvidence)) {
      failures.push(
        `transactions-${viewport}.json workflow ${workflow.workflow ?? "unknown"} omits enforceable scenario evidence`,
      );
    }
  }

  const localCoverage = Array.isArray(report.scenarioCoverage)
    ? report.scenarioCoverage
    : [];
  if (
    localCoverage.length === 0 ||
    localCoverage.some(
      (scenario) =>
        !scenario.complete ||
        scenario.requiredViewports?.length !== 1 ||
        scenario.requiredViewports[0] !== viewport,
    )
  ) {
    failures.push(
      `transactions-${viewport}.json does not certify only its selected viewport`,
    );
  }

  for (const workflowName of productWorkflowNames) {
    const workflow = workflows.find((item) => item.workflow === workflowName);
    if (!workflow) {
      failures.push(
        `transactions-${viewport}.json omits Product workflow ${workflowName}`,
      );
      continue;
    }
    const states = Array.isArray(workflow.intermediateEvidence)
      ? workflow.intermediateEvidence
      : [];
    if (states.length === 0) {
      failures.push(
        `transactions-${viewport}.json Product workflow ${workflowName} has no action-state evidence`,
      );
    }
    for (const state of states) {
      const screenshotName = state.screenshot
        ? path.basename(state.screenshot)
        : null;
      if (!screenshotName || !evidenceBasenames.has(screenshotName)) {
        failures.push(
          `transactions-${viewport}.json Product workflow ${workflowName} references a missing screenshot`,
        );
      }
      if (!state.audit?.keyboardHotspots) {
        failures.push(
          `transactions-${viewport}.json Product workflow ${workflowName} omits keyboard/hotspot evidence`,
        );
      }
    }
  }
  return failures;
}

export async function verifyCertificationBundle(certificationDir) {
  const rootDir = path.resolve(certificationDir);
  const failures = [];
  let files;
  try {
    files = await listFiles(rootDir);
  } catch (error) {
    return [
      `certification artifact directory is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const evidenceBasenames = new Set(files.map((file) => path.basename(file)));

  const deploymentFile = firstByBasename(files, "deployment-readiness.json");
  if (!deploymentFile) {
    failures.push("deployment-readiness.json is missing");
  } else {
    const deployment = await readJson(deploymentFile, failures);
    if (deployment && deployment.ready !== true) {
      failures.push(
        "deployment-readiness.json does not certify the exact commit",
      );
    }
  }

  for (const viewport of routeViewports) {
    const file = firstByBasename(files, `routes-${viewport}.json`);
    if (!file) {
      failures.push(`routes-${viewport}.json is missing`);
      continue;
    }
    const report = await readJson(file, failures);
    if (report) failures.push(...routeReportFailures(report, viewport));
  }

  const allWorkflows = [];
  for (const { name: viewport } of REQUIRED_TRANSACTION_VIEWPORTS) {
    const file = firstByBasename(files, `transactions-${viewport}.json`);
    if (!file) {
      failures.push(`transactions-${viewport}.json is missing`);
    } else {
      const report = await readJson(file, failures);
      if (report) {
        failures.push(
          ...transactionReportFailures(report, viewport, evidenceBasenames),
        );
        allWorkflows.push(...(report.workflows ?? []));
      }
    }

    const cleanupFile = firstByBasename(files, `cleanup-${viewport}.json`);
    if (!cleanupFile) {
      failures.push(`cleanup-${viewport}.json is missing`);
    } else {
      const cleanup = await readJson(cleanupFile, failures);
      if (
        cleanup &&
        (!cleanup.complete ||
          cleanup.viewport !== viewport ||
          !Array.isArray(cleanup.results) ||
          cleanup.results.length === 0 ||
          cleanup.results.some(
            (item) => item.remaining !== 0 || Boolean(item.error),
          ))
      ) {
        failures.push(`cleanup-${viewport}.json does not prove zero residue`);
      }
    }
  }

  const unionCoverage = evaluateScenarioCoverage(
    allWorkflows,
    REQUIRED_TRANSACTION_VIEWPORTS.map((item) => item.name),
  );
  failures.push(
    ...scenarioCoverageFailures(unionCoverage).map(
      (failure) => `cross-shard coverage: ${failure}`,
    ),
  );
  return failures;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const failures = await verifyStaticLaunchArtifacts();
  const certificationDir = argument("--certification-dir");
  if (certificationDir) {
    failures.push(...(await verifyCertificationBundle(certificationDir)));
  }
  if (failures.length > 0) {
    throw new Error(
      `Launch artifact verification failed:\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    certificationDir
      ? "PASS static launch contracts and cross-shard UAT certification bundle."
      : "PASS launch governance documents, import headers, and live crawler contract.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
