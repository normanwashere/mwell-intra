import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId = process.env.SUPABASE_PROJECT_ID?.trim();
const outputPath = path.resolve(
  process.env.SUPABASE_ADVISOR_OUTPUT ??
    "output/supabase-advisors/latest.json",
);

if (!projectId) {
  throw new Error("SUPABASE_PROJECT_ID is required.");
}

async function readAdvisor(kind) {
  const upper = kind.toUpperCase();
  const inline = process.env[`SUPABASE_${upper}_ADVISORS_JSON`];
  const file = process.env[`SUPABASE_${upper}_ADVISORS_FILE`];
  if (!inline && !file) {
    throw new Error(
      `SUPABASE_${upper}_ADVISORS_JSON or SUPABASE_${upper}_ADVISORS_FILE is required.`,
    );
  }
  const source = inline ?? (await readFile(path.resolve(file), "utf8"));
  const parsed = JSON.parse(source);
  const lints = Array.isArray(parsed)
    ? parsed
    : (parsed.result?.lints ?? parsed.lints);
  if (!Array.isArray(lints)) {
    throw new Error(`${kind} advisor payload does not contain a lint array.`);
  }
  return lints;
}

function normalize(lints) {
  const findings = lints
    .map((lint) => ({
      name: String(lint.name ?? "unknown"),
      title: String(lint.title ?? lint.name ?? "Unknown"),
      level: String(lint.level ?? "INFO").toUpperCase(),
      detail: String(lint.detail ?? lint.description ?? ""),
      remediation: lint.remediation ? String(lint.remediation) : null,
      schema: lint.metadata?.schema ? String(lint.metadata.schema) : null,
      table: lint.metadata?.name ? String(lint.metadata.name) : null,
    }))
    .sort((left, right) =>
      [left.level, left.name, left.schema, left.table]
        .map((value) => value ?? "")
        .join(":")
        .localeCompare(
          [right.level, right.name, right.schema, right.table]
            .map((value) => value ?? "")
            .join(":"),
        ),
    );

  return {
    total: findings.length,
    byLevel: Object.fromEntries(
      Object.entries(
        Object.groupBy(findings, (finding) => finding.level),
      ).map(([level, items]) => [level, items.length]),
    ),
    byName: Object.fromEntries(
      Object.entries(
        Object.groupBy(findings, (finding) => finding.name),
      ).map(([name, items]) => [name, items.length]),
    ),
    findings,
  };
}

const [security, performance] = await Promise.all([
  readAdvisor("security"),
  readAdvisor("performance"),
]);
const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  security: normalize(security),
  performance: normalize(performance),
};
const serialized = JSON.stringify(report, null, 2);
if (
  /service[_-]?role|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|AUDIT_PASSWORD|VERCEL_OIDC_TOKEN/i.test(
    serialized,
  )
) {
  throw new Error("Advisor report contains credential-shaped content.");
}

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, `${serialized}\n`, "utf8");
await rename(temporaryPath, outputPath);
console.log(
  `PASS Supabase advisor snapshot: ${report.security.total} security and ${report.performance.total} performance findings.`,
);
