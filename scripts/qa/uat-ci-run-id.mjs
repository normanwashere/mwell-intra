import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DATE_PATTERN = /^\d{8}$/;
const RUN_ID_PATTERN = /^QA-\d{8}-[A-F0-9]{8}$/;

export function buildDeterministicAuditRunId({ date, runNumber, ordinal }) {
  const normalizedDate = String(date ?? "");
  const normalizedRunNumber = Number(runNumber);
  const normalizedOrdinal = Number(ordinal);
  if (!DATE_PATTERN.test(normalizedDate))
    throw new Error("date must use YYYYMMDD format.");
  if (!Number.isSafeInteger(normalizedRunNumber) || normalizedRunNumber < 1)
    throw new Error("runNumber must be a positive integer.");
  if (!Number.isSafeInteger(normalizedOrdinal) || normalizedOrdinal < 0)
    throw new Error("ordinal must be a non-negative integer.");

  const numericSuffix = normalizedRunNumber * 100 + normalizedOrdinal;
  if (numericSuffix > 0xffffffff)
    throw new Error("The deterministic audit suffix exceeds eight hex digits.");
  return `QA-${normalizedDate}-${numericSuffix.toString(16).padStart(8, "0").toUpperCase()}`;
}

export function assertDeterministicAuditRunId(value) {
  if (!RUN_ID_PATTERN.test(String(value ?? "")))
    throw new Error("AUDIT_RUN_ID must use QA-YYYYMMDD-8HEX format.");
  return value;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const githubOutput = readArgument("--github-output");
  if (githubOutput) {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    await appendFile(githubOutput, `audit_date=${date}\n`, "utf8");
    return;
  }

  const runId = buildDeterministicAuditRunId({
    date: readArgument("--date"),
    runNumber: readArgument("--run-number"),
    ordinal: readArgument("--ordinal"),
  });
  process.stdout.write(runId);
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
