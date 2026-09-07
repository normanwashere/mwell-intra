import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CANDIDATE, PASS_RULES, renderAutomatedVendorEvidenceDryRun, renderVendorEvidenceDryRun } from './publish-vendor-evidence-learning.mjs';
test('local automated artifact binds exact vendor catalog/pass rules without human claims or apply mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vendor-review-fixture-'));
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  try {
    const artifact = { reviewMode: 'automated', verdict: 'approved', key: 'vendor_evidence', projectRef: 'kkoitlvydytdhlpxhuah',
      candidate: CANDIDATE, authorAgentId: 'local-fixture-author', reviewerAgentId: 'local-fixture-reviewer',
      userAuthorizationReference: 'LOCAL TEST ONLY: simulated authorization', reviewedAt: '2026-09-01T00:00:00Z',
      catalogSha256: hash(execFileSync('git', ['show', `${CANDIDATE}:modules/learning/src/catalog.ts`])),
      passRulesSha256: hash(JSON.stringify(PASS_RULES)) };
    const path = join(dir, 'review.json');
    writeFileSync(path, JSON.stringify(artifact));
    const input = { projectRef: artifact.projectRef, candidate: CANDIDATE, authorAgentId: artifact.authorAgentId,
      reviewerAgentId: artifact.reviewerAgentId, userAuthorizationReference: artifact.userAuthorizationReference,
      reviewArtifactPath: path, reviewArtifactSha256: hash(JSON.stringify(artifact)) };
    const sql = renderAutomatedVendorEvidenceDryRun(input);
    assert.match(sql, /"human_review_claimed":false/);
    assert.match(sql, /5f86c147-34aa-4722-be5b-ed085caf97eb/);
    assert.match(sql, /rollback;\s*$/);
    assert.doesNotMatch(sql, /update learning\.|insert into learning\.role_curricula/);
    for (const patch of [{ commit: true }, { reviewerAgentId: input.authorAgentId }, { reviewArtifactSha256: '0'.repeat(64) }]) {
      assert.throws(() => renderAutomatedVendorEvidenceDryRun({ ...input, ...patch }));
    }
    assert.throws(() => renderVendorEvidenceDryRun(input));
    artifact.passRulesSha256 = '0'.repeat(64);
    writeFileSync(path, JSON.stringify(artifact));
    assert.throws(() => renderAutomatedVendorEvidenceDryRun({ ...input, reviewArtifactSha256: hash(JSON.stringify(artifact)) }), /exact vendor catalog/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
