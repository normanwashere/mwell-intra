import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { classifyRecords } from './migrate-policy-review-records.mjs';

test('queues open records and preserves completed signed evidence', async () => {
  const records = JSON.parse(await readFile(new URL('./fixtures/policy-review-records.json', import.meta.url), 'utf8'));
  const result = classifyRecords(records, 'test-run');
  assert.equal(result.queued.length, 2);
  assert.equal(result.preserved.length, 2);
  assert.equal(result.ignored.length, 0);
  assert.ok(result.queued.every((row) => row.details.run_id === 'test-run'));
  assert.ok(result.preserved.every((row) => row.action === 'preserve_immutable_evidence'));
});

test('does not queue malformed or unclassified closed records', () => {
  const result = classifyRecords([
    { module: 'legal', status: 'draft' },
    { module: 'procurement', entityType: 'request', id: 'closed-1', status: 'cancelled' },
  ], 'test-run');
  assert.equal(result.queued.length, 0);
  assert.equal(result.ignored.length, 2);
});
