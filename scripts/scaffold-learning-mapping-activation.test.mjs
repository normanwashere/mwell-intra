import assert from 'node:assert/strict';
import test from 'node:test';
import { scaffoldActivation } from './scaffold-learning-mapping-activation.mjs';
import { renderMappingActivation } from './activate-learning-mapping-correction.mjs';

for (const key of ['warehouse_operator', 'finance', 'admin']) {
  test(`${key}: scaffold carries exact binding but cannot assert health or approve activation`, () => {
    const result = scaffoldActivation(key);
    assert.equal(result.input.candidate, '06c9b80bc6c09c343800756ebcadc0efdb88619f');
    assert.equal(result.input.publishedFingerprint, null);
    assert.match(result.publishedFingerprintQuery, /cv\.version=2/);
    assert.equal(result.activationReviewDraft.verdict, null);
    assert.equal(result.publicHealthEvidence.healthy, null);
    assert.equal(result.publicHealthEvidence.commit, null);
    assert.equal(result.executionApprovalDraft.executionApproved, false);
    assert.throws(() => renderMappingActivation(result.input));
    const bound = scaffoldActivation(key, 'a'.repeat(32));
    assert.equal(bound.input.publishedFingerprint, 'a'.repeat(32));
    assert.throws(() => renderMappingActivation(bound.input));
  });
}
test('scaffold rejects vendor and malformed fingerprints rather than widening internal activation', () => {
  assert.throws(() => scaffoldActivation('vendor_portal'));
  assert.throws(() => scaffoldActivation('finance', 'unknown'));
});
