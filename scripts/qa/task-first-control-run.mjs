import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateControlReview } from "./task-first-control-review.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifestPath = path.join(root, "docs/training/task-first-certification-manifest.json");

export function createRunTemplate(manifest) {
  return { schemaVersion: 1, purpose: "Exact control instruction review, not business or human-pilot certification",
    controls: manifest.controls.map((row) => ({
      controlId: row.id, candidateCommit: null, healthCommit: null, healthVerifiedAt: null,
      actorRoleId: null, authorizationConfirmed: false, noBusinessWrites: null,
      fixtureReference: null, state: null, routeTemplate: null, actualRoute: null, attempts: [],
    })) };
}

export function assessRun(manifest, run, artifactRoot = root) {
  const errors = [];
  if (!Array.isArray(run.controls)) return { errors: ["control-rows-required"], results: [] };
  const expected = new Map(manifest.controls.map((row) => [row.id, row]));
  const seen = new Set();
  const results = [];
  for (const control of run.controls) {
    if (seen.has(control.controlId) || !expected.has(control.controlId)) { errors.push(`unknown-or-duplicate:${control.controlId}`); continue; }
    seen.add(control.controlId);
    const result = evaluateControlReview(expected.get(control.controlId), control);
    for (const attempt of control.attempts ?? []) {
      if (!attempt.selected) continue;
      // Only inspect files inside the artifact root; never fetch remote URLs or deserialize auth state.
      const absolute = path.resolve(artifactRoot, attempt.path ?? "");
      const relative = path.relative(artifactRoot, absolute);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/\.(png|jpe?g)$/i.test(relative)) {
        result.errors.push(`${attempt.viewport}:invalid-artifact-path`); continue;
      }
      try {
        const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
        if (digest !== attempt.sha256) result.errors.push(`${attempt.viewport}:artifact-bytes-changed`);
      } catch { result.errors.push(`${attempt.viewport}:artifact-unreadable`); }
    }
    if (result.errors.length && result.status !== "review-rejected") result.status = "blocked";
    results.push({ controlId: control.controlId, ...result });
  }
  for (const id of expected.keys()) if (!seen.has(id)) errors.push(`missing-control:${id}`);
  return { errors, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, file] = process.argv.slice(2);
  if (!["--init", "--check"].includes(mode) || !file) throw new Error("Use --init NEW_RUN.json or --check EXISTING_RUN.json; no browser or business actions are performed.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (mode === "--init") {
    if (existsSync(file)) throw new Error("Refusing to overwrite prior run evidence.");
    writeFileSync(file, `${JSON.stringify(createRunTemplate(manifest), null, 2)}\n`, { flag: "wx" });
    console.log(`Created ${manifest.controls.length} blank control rows; no captures or certification.`);
  } else {
    const result = assessRun(manifest, JSON.parse(readFileSync(file, "utf8")));
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length || result.results.some((row) => row.status !== "reviewed-instruction-only")) process.exitCode = 1;
  }
}
