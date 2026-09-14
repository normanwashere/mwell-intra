import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedWorkflowScenarioEvidence, evaluateScenarioCoverage } from './live-e2e-scenarios.mjs';

const name = 'legal vendor invite';
const saved = { ok: true, checkpoint: { matched: 1 }, inviteCheckpoint: { matched: 1 } };

const creation = { ...saved, invitationMode: 'creation-only', acceptanceNotExercised: true,
  acceptanceCheckpoint: null, acceptanceUsedAuditToken: false, replayStatus: null, deliveryStatus: 'sent',
  creationLineage: { source: 'ordinary-legal-ui', caseId: 'invited-case', inviteId: 'new-invite', vendorId: 'new-vendor',
    actorId: 'legal-actor', applicationFixtureIsSeparate: true } };
test('creation-only evidence preserves its own lineage and rejects missing or contradictory provenance', () => {
  const [row] = recordedWorkflowScenarioEvidence(name, creation);
  assert.deepEqual(row.lineage, creation.creationLineage);
  assert.deepEqual(row.checkpoints, ['invite-created', 'case-visible']);
  for (const change of [{ creationLineage: null }, { acceptanceNotExercised: false }, { acceptanceUsedAuditToken: true },
    { acceptanceCheckpoint: { matched: 1 } }, { replayStatus: 409 }, { deliveryStatus: 'pending_delivery' },
    { creationLineage: { ...creation.creationLineage, source: 'service-fixture' } },
    { creationLineage: { ...creation.creationLineage, caseId: '' } }]) {
    assert.deepEqual(recordedWorkflowScenarioEvidence(name, { ...creation, ...change }), []);
  }
});

test('vendor coverage reports separate governed legs and never transfers invite credit to another viewport', () => {
  const row = { ...creation, viewport: 'desktop-1440', scenarioEvidence: recordedWorkflowScenarioEvidence(name, creation) };
  const coverage = evaluateScenarioCoverage([row], ['desktop-1440', 'mobile-390']).find(item => item.id === 'vendor-accreditation');
  assert.equal(coverage.coverageSemantics, 'separate-governed-legs');
  assert.equal(coverage.continuousInvitationToApplicationProven, false);
  assert.equal(coverage.complete, false);
  assert.ok(coverage.perViewport[1].missing.checkpoints.includes('invite-created'));
  assert.deepEqual(coverage.perViewport[0].lineages, [creation.creationLineage]);
});

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

const application = { matched: 1, caseId: 'qa_vendor_application_123', vendorId: 'vendor', actorId: 'vendor-actor',
  snapshotId: 'snapshot', version: 2, documentHash: 'a'.repeat(64), documentCount: 8 };
test('only a verified signed application earns application-readback, not invite or Legal handoff credit', () => {
  const result = { ok: true, applicationCheckpoint: application, validationGuard: true,
    replayCheckpoint: { replayed: true, snapshotId: application.snapshotId, version: application.version, unchanged: true, commandKeySha256: 'b'.repeat(64) } };
  const [row] = recordedWorkflowScenarioEvidence('vendor owned application submission', result);
  assert.deepEqual(row.checkpoints, ['application-readback']);
  assert.equal(row.lineage.caseId, application.caseId);
  assert.equal(row.lineage.vendorId, application.vendorId);
  assert.equal(row.lineage.leg, 'application-to-legal');
  assert.deepEqual(row.actors, ['vendor_representative']);
  assert.deepEqual(row.cases, ['authorized', 'validation', 'duplicate']);
  for (const replayCheckpoint of [null, { ...result.replayCheckpoint, unchanged: false }, { ...result.replayCheckpoint, snapshotId: 'foreign' }]) {
    assert.ok(!recordedWorkflowScenarioEvidence('vendor owned application submission', { ...result, replayCheckpoint })[0].cases.includes('duplicate'));
  }
  for (const changed of [{ applicationCheckpoint: null }, { applicationCheckpoint: { ...application, matched: 0 } },
    { applicationCheckpoint: { ...application, documentCount: 0 } }, { ok: false }, { interactionSurfaceOnly: true }]) {
    assert.deepEqual(recordedWorkflowScenarioEvidence('vendor owned application submission', { ...result, ...changed }), []);
  }
});

test('Legal handoff needs an attributable independent reader of the persisted version', () => {
  const result = { ok: true, handoffCheckpoint: { ...application, readerId: 'legal-actor' } };
  const [row] = recordedWorkflowScenarioEvidence('legal submitted application handoff', result);
  assert.deepEqual(row.checkpoints, ['legal-handoff']);
  assert.deepEqual(row.cases, ['handoff']);
  assert.deepEqual(row.actors, ['legal_compliance_lead']);
  for (const handoffCheckpoint of [null, { ...application, readerId: application.actorId }, { ...application, version: 0 }]) {
    assert.deepEqual(recordedWorkflowScenarioEvidence('legal submitted application handoff', { ...result, handoffCheckpoint }), []);
  }
});
