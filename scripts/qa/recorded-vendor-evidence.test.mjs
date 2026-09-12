import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedWorkflowScenarioEvidence, evaluateScenarioCoverage } from './live-e2e-scenarios.mjs';

const name = 'legal vendor invite';
const saved = { ok: true, checkpoint: { matched: 1 }, inviteCheckpoint: { matched: 1 } };

test('form-only, failed and unverified invitations earn no transaction credit', () => {
  for (const result of [{ ok: true, interactionSurfaceOnly: true }, { ...saved, ok: false }, { ok: true },
    { ...saved, inviteCheckpoint: { matched: 0 } }, { ...saved, checkpoint: { matched: 2 } }]) {
    assert.deepEqual(recordedWorkflowScenarioEvidence(name, result), []);
  }
});

test('saved invitation with deferred delivery proves creation, not vendor action', () => {
  const [evidence] = recordedWorkflowScenarioEvidence(name, { ...saved, deliveryStatus: 'delivery_failed' });
  assert.deepEqual(evidence.actors, ['legal_compliance_lead']);
  assert.deepEqual(evidence.cases, ['authorized']);
  assert.deepEqual(evidence.checkpoints, ['invite-created', 'case-visible']);
});

test('acceptance and rejected replay do not prove application submission or Legal handoff', () => {
  const evidence = recordedWorkflowScenarioEvidence(name, { ...saved, acceptanceCheckpoint: { matched: 1 }, replayStatus: 409 });
  assert.deepEqual(evidence[0].actors, ['legal_compliance_lead', 'vendor_representative']);
  assert.deepEqual(evidence[0].cases, ['authorized', 'duplicate']);
  const coverage = evaluateScenarioCoverage([{ ok: true, viewport: 'desktop-1440', scenarioEvidence: evidence }], ['desktop-1440'])
    .find(row => row.id === 'vendor-accreditation');
  assert.equal(coverage.complete, false);
  assert(coverage.perViewport[0].missing.checkpoints.includes('application-readback'));
  assert(coverage.perViewport[0].missing.checkpoints.includes('legal-handoff'));
});

test('other verified workflows retain their registered evidence', () => {
  const evidence = recordedWorkflowScenarioEvidence('procurement request draft', { ok: true });
  assert.deepEqual(evidence[0].checkpoints, ['draft-created']);
});
