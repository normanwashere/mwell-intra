#!/usr/bin/env node
// Coverage gate for CI (see .github/workflows/ci.yml).
//
// Vitest's `--coverage.reporter=json-summary` writes a per-package
// `coverage/coverage-summary.json` under every workspace that ran tests.
// This script walks the repo (skipping node_modules / .next / dist), merges
// every summary it finds into a single total, and fails the job when the
// overall lines or statements percentage drops below $COVERAGE_MIN.
//
// Kept dependency-free (Node built-ins only) so the CI matrix doesn't need
// an extra install for the gate itself.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const MIN = Number.parseFloat(process.env.COVERAGE_MIN ?? '50');
if (!Number.isFinite(MIN) || MIN < 0 || MIN > 100) {
  console.error(`Invalid COVERAGE_MIN=${process.env.COVERAGE_MIN}`);
  process.exit(2);
}

const ROOT = resolve(process.cwd());
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.git',
  'dist',
  'build',
  '.output',
]);

/** @type {string[]} */
const summaryFiles = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name === 'coverage-summary.json') {
      summaryFiles.push(full);
    }
  }
}

walk(ROOT);

if (summaryFiles.length === 0) {
  console.error(
    '::error::No coverage-summary.json files found. Did vitest run with --coverage?',
  );
  process.exit(1);
}

/** @type {Record<string, { total: number; covered: number }>} */
const totals = {
  lines: { total: 0, covered: 0 },
  statements: { total: 0, covered: 0 },
  functions: { total: 0, covered: 0 },
  branches: { total: 0, covered: 0 },
};

for (const file of summaryFiles) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const total = parsed.total;
    if (!total) continue;
    for (const key of Object.keys(totals)) {
      if (total[key]) {
        totals[key].total += total[key].total ?? 0;
        totals[key].covered += total[key].covered ?? 0;
      }
    }
    const rel = relative(ROOT, file).split(sep).join('/');
    console.log(`  ${rel} — lines ${total.lines?.pct ?? 'n/a'}%`);
  } catch (err) {
    console.warn(`  skip ${file}: ${err.message}`);
  }
}

const pct = (m) => (m.total === 0 ? 0 : (m.covered / m.total) * 100);
const summary = Object.fromEntries(
  Object.entries(totals).map(([k, v]) => [k, pct(v)]),
);

console.log('\nAggregate coverage:');
for (const [k, v] of Object.entries(summary)) {
  console.log(`  ${k.padEnd(12)} ${v.toFixed(2)}%`);
}

const overall = Math.min(summary.lines, summary.statements);
if (overall + 1e-9 < MIN) {
  console.error(
    `::error::Coverage gate FAILED: min(lines,statements)=${overall.toFixed(
      2,
    )}% < ${MIN}%`,
  );
  process.exit(1);
}
console.log(
  `\nCoverage gate PASSED: min(lines,statements)=${overall.toFixed(
    2,
  )}% >= ${MIN}%`,
);
