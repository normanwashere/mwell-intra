#!/usr/bin/env node

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const OPEN_STATUSES = new Set(['draft', 'submitted', 'under_review', 'pending_approval', 'returned']);

export function classifyRecords(records, runId) {
  const queued = [];
  const preserved = [];
  const ignored = [];
  for (const record of records) {
    const normalized = {
      module: String(record.module ?? ''), entity_type: String(record.entityType ?? ''),
      entity_id: String(record.id ?? ''), policy_version: 'policy-alignment-2026-07-10',
      reason_code: String(record.reasonCode ?? 'policy_review_required'),
      details: { run_id: runId, prior_policy_version: record.policyVersion ?? null, prior_status: record.status ?? null },
      status: 'open',
    };
    if (!normalized.module || !normalized.entity_type || !normalized.entity_id) ignored.push({ ...record, reason: 'missing_identity' });
    else if (record.completedSignedEvidence === true) preserved.push({ ...record, action: 'preserve_immutable_evidence' });
    else if (OPEN_STATUSES.has(String(record.status))) queued.push(normalized);
    else ignored.push({ ...record, reason: 'closed_without_signed_evidence_flag' });
  }
  return { queued, preserved, ignored };
}

export function buildReport(classification, runId, source) {
  const reasons = [...new Set(classification.queued.map((row) => row.reason_code))].sort();
  return {
    runId, generatedAt: new Date().toISOString(), source, mode: 'dry-run',
    totals: { queued: classification.queued.length, preserved: classification.preserved.length, ignored: classification.ignored.length },
    byReason: Object.fromEntries(reasons.map((reason) => [reason, classification.queued.filter((row) => row.reason_code === reason).length])),
    ...classification,
  };
}

async function applyToTestProject(rows, projectRef) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.');
  if (!url.includes(projectRef) || process.env.POLICY_REMEDIATION_TEST_PROJECT !== projectRef) {
    throw new Error('The URL and POLICY_REMEDIATION_TEST_PROJECT must both match --test-project. Production is not an accepted default.');
  }
  for (const row of rows) {
    const endpoint = new URL('/rest/v1/policy_remediation_queue', url);
    const lookup = new URL(endpoint);
    lookup.searchParams.set('select', 'id');
    for (const key of ['module', 'entity_type', 'entity_id', 'policy_version', 'reason_code']) lookup.searchParams.set(key, `eq.${row[key]}`);
    lookup.searchParams.set('status', 'eq.open');
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Accept-Profile': 'core' };
    const existing = await fetch(lookup, { headers });
    if (!existing.ok) throw new Error(`Queue lookup failed for ${row.entity_id}: ${existing.status}`);
    if ((await existing.json()).length > 0) continue;
    const inserted = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Profile': 'core', 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    if (!inserted.ok) throw new Error(`Queue insert failed for ${row.entity_id}: ${inserted.status}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const input = resolve(valueAfter('--input') ?? 'scripts/fixtures/policy-review-records.json');
  const output = resolve(valueAfter('--output') ?? 'artifacts/policy-remediation-dry-run.json');
  const apply = args.includes('--apply');
  const testProject = valueAfter('--test-project');
  if (apply && !testProject) throw new Error('--apply requires --test-project <project-ref>.');
  const runId = valueAfter('--run-id') ?? `policy-review-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const records = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(records)) throw new Error('Input must be a JSON array.');
  const classification = classifyRecords(records, runId);
  const report = buildReport(classification, runId, input);
  if (apply) { await applyToTestProject(classification.queued, testProject); report.mode = 'applied-to-test-project'; }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`${report.mode}: queued=${report.totals.queued}, preserved=${report.totals.preserved}, ignored=${report.totals.ignored}`);
  console.log(`Report: ${output}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
