import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WMS_CHECKPOINTS, WMS_HUMAN_GATES, requiredWmsEvidence, evaluateWmsSignoff,
} from './wms-signoff-contract.mjs';

const scope = { runId: 'wms-run-1', buildId: 'sha-and-deployment-1', environment: 'isolated-uat' };

// Synthetic validator fixtures only: these are never live signoff evidence.
function fixture() {
  return requiredWmsEvidence().map(requirement => {
    const checkpoint = WMS_CHECKPOINTS.find(item => item.id === requirement.checkpoint);
    const actor = {
      id: checkpoint.id.endsWith('.release') ? 'independent-releaser' : 'operator-1',
      roles: [...(checkpoint.roles ?? ['warehouse_operator'])],
    };
    const evidenceScope = { ...scope, view: requirement.view };
    return {
      ...requirement, scope: evidenceScope, status: 'passed', kind: 'live', actor,
      ...(checkpoint.operation ? { operation: { ...checkpoint.operation } } : {}),
      journeyId: `${checkpoint.journey ?? checkpoint.id}-${requirement.view}`,
      actionRef: `actions/${checkpoint.id}/${requirement.view}.json`,
      readback: {
        scope: { ...evidenceScope }, source: 'persisted-requery',
        ref: `readbacks/${checkpoint.id}/${requirement.view}.json`,
        entityIds: ['run-owned-entity'], actorId: actor.id,
        assertions: checkpoint.checks.map(check => ({ check, expected: true, actual: true })),
      },
      screenshot: requirement.view === 'service' ? undefined : {
        scope: { ...evidenceScope }, ref: `screens/${checkpoint.id}/${requirement.view}.png`,
        width: requirement.view === 'desktop1440' ? 1440 : 390,
        height: requirement.view === 'desktop1440' ? 900 : 844,
        reviewed: true,
      },
      cleanup: {
        status: 'verified', ref: `cleanup/${checkpoint.id}/${requirement.view}.json`,
        scope: { ...evidenceScope }, failurePath: 'Run-owned fixtures reconciled in finally after success or failure.',
        residualEntityIds: [],
      },
    };
  });
}

function humanFixture() {
  return WMS_HUMAN_GATES.map(gate => ({
    id: gate.id, status: 'passed', buildId: scope.buildId, environment: scope.environment,
    reviewer: 'named-human-reviewer', completedAt: '2026-09-13T10:00:00Z',
    evidenceRef: `human/${gate.id}.json`, checks: [...gate.checks],
    ...(gate.id === 'hardware' ? { printersInUse: false, printerNotApplicableReason: 'Pilot uses existing labels, no printing.' } : {}),
  }));
}

function evaluate(evidence = fixture(), humanGates = []) {
  return evaluateWmsSignoff({ scope, evidence, humanGates });
}

test('replenishment requires the actual recommendation, Procurement acceptance and linked draft handoff', () => {
  const stages = ['recommend', 'accept', 'handoff'];
  for (const action of stages) {
    const stage = WMS_CHECKPOINTS.find(item => item.id === `replenishment.${action}`);
    assert.ok(stage, `Missing replenishment ${action} checkpoint`);
    assert.equal(stage.journey, 'replenishment');
    assert.deepEqual(stage.operation, { rpc: 'procurement.manage_replenishment_recommendation', action });
    assert.deepEqual([...stage.views], ['desktop1440', 'mobile390']);
  }
  const recommendation = WMS_CHECKPOINTS.find(item => item.id === 'replenishment.recommend');
  assert.ok(recommendation.checks.includes('effective-recommendation-authority-without-procurement-view-grant'));
  assert.ok(recommendation.checks.includes('accepted-and-handed-off-snapshots-not-overwritten'));
  const handoff = WMS_CHECKPOINTS.find(item => item.id === 'replenishment.handoff');
  assert.ok(handoff.checks.includes('linked-draft-request-quantity-rationale-and-actor'));
  assert.ok(handoff.checks.includes('no-stock-movement-or-purchase-order-implied'));
});

test('replenishment rejects missing, unrelated or substituted handoff evidence', () => {
  const evidence = fixture();
  const handoff = evidence.find(row => row.checkpoint === 'replenishment.handoff' && row.view === 'desktop1440');
  assert.ok(handoff, 'A handoff must be explicitly required');
  handoff.journeyId = 'unrelated-recommendation';
  assert.match(evaluate(evidence).failures.join('\n'), /replenishment:desktop1440: continuous journey/);
  const substituted = fixture();
  substituted.find(row => row.checkpoint === 'replenishment.handoff').operation.action = 'recommend';
  assert.equal(evaluate(substituted).automatedPassed, false);
  assert.equal(evaluate(fixture().filter(row => !row.checkpoint.startsWith('replenishment.'))).automatedPassed, false);
});

test('complete automated evidence still leaves both human gates pending', () => {
  const result = evaluate();
  assert.deepEqual(result.failures, []);
  assert.equal(result.automatedPassed, true);
  assert.equal(result.productionReady, false);
  assert.deepEqual(result.pendingHumanGates, WMS_HUMAN_GATES.map(gate => gate.id));
});

test('only complete same-build human attestations can open production gate', () => {
  assert.equal(evaluate(fixture(), humanFixture()).productionReady, true);
  for (const field of ['reviewer', 'completedAt', 'evidenceRef', 'checks', 'buildId', 'environment']) {
    const humans = humanFixture();
    delete humans[0][field];
    assert.equal(evaluate(fixture(), humans).productionReady, false, field);
  }
  const humans = humanFixture();
  humans[0].buildId = 'old-build';
  assert.equal(evaluate(fixture(), humans).productionReady, false);
  assert.equal(evaluate(fixture(), [...humanFixture(), humanFixture()[0]]).productionReady, false);
});

test('empty, malformed and partial evidence fail closed without throwing', () => {
  for (const input of [undefined, null, {}, { scope, evidence: null }, { scope, evidence: [null] }]) {
    assert.equal(evaluateWmsSignoff(input).productionReady, false);
    assert.equal(evaluateWmsSignoff(input).automatedPassed, false);
  }
  const evidence = fixture();
  evidence.pop();
  assert.equal(evaluate(evidence).automatedPassed, false);
});

test('duplicate evidence is rejected, never last-write-wins', () => {
  const evidence = fixture();
  evidence.push(structuredClone(evidence[0]));
  assert.match(evaluate(evidence).failures.join('\n'), /duplicate/);
});

test('every required checkpoint and viewport independently gates completion', () => {
  const evidence = fixture();
  for (let i = 0; i < evidence.length; i += 1) {
    assert.equal(evaluate(evidence.filter((_, index) => index !== i)).automatedPassed, false,
      `${evidence[i].checkpoint}:${evidence[i].view}`);
  }
});

test('run, build, environment and view scope must match at every evidence layer', () => {
  for (const layer of ['scope', 'readback', 'screenshot', 'cleanup']) {
    for (const field of ['runId', 'buildId', 'environment', 'view']) {
      const evidence = fixture();
      const target = layer === 'scope' ? evidence[0].scope : evidence[0][layer].scope;
      target[field] = 'incorrect';
      assert.equal(evaluate(evidence).automatedPassed, false, `${layer}.${field}`);
    }
  }
});

test('surface-only passes and legacy full-intra workflow names earn no credit', () => {
  const evidence = fixture();
  evidence[0] = { checkpoint: evidence[0].checkpoint, view: evidence[0].view, status: 'passed' };
  assert.equal(evaluate(evidence).automatedPassed, false);
  for (const kind of ['surface', 'unit', 'mock', 'sql-fixture']) {
    const rows = fixture();
    rows[0].kind = kind;
    assert.equal(evaluate(rows).automatedPassed, false, kind);
  }
  const legacy = fixture();
  legacy[0].checkpoint = 'full-intra-live-e2e';
  assert.match(evaluate(legacy).failures.join('\n'), /unknown|missing/);
});

test('explicit actor, readback, screenshot and cleanup evidence are mandatory', () => {
  for (const field of ['actor', 'readback', 'screenshot', 'cleanup', 'actionRef', 'journeyId']) {
    const evidence = fixture();
    delete evidence[0][field];
    assert.equal(evaluate(evidence).automatedPassed, false, field);
  }
  for (const status of ['failed', 'skipped', 'pending', 'blocked']) {
    const evidence = fixture();
    evidence[0].status = status;
    assert.equal(evaluate(evidence).automatedPassed, false, status);
  }
});

test('readback requires all named assertions, exact equality and persisted identity', () => {
  const mutations = [
    row => { row.readback.source = 'dom'; },
    row => { row.readback.entityIds = []; },
    row => { row.readback.actorId = 'different-actor'; },
    row => { row.readback.assertions.pop(); },
    row => { row.readback.assertions.push(row.readback.assertions[0]); },
    row => { row.readback.assertions[0].actual = false; },
    row => { delete row.readback.assertions[0].actual; },
    row => { row.readback.assertions[0].expected = null; row.readback.assertions[0].actual = null; },
  ];
  for (const mutate of mutations) {
    const evidence = fixture();
    mutate(evidence[0]);
    assert.equal(evaluate(evidence).automatedPassed, false);
  }
});

test('UI screenshots must have the required dimensions and human/runner visual review', () => {
  for (const mutate of [
    row => { row.screenshot.width = 1280; },
    row => { row.screenshot.height = 0; },
    row => { row.screenshot.reviewed = false; },
    row => { row.screenshot.ref = ''; },
  ]) {
    const evidence = fixture();
    mutate(evidence[0]);
    assert.equal(evaluate(evidence).automatedPassed, false);
  }
});

test('cleanup must include verified failure-path reconciliation with no residual fixtures', () => {
  for (const mutate of [
    row => { row.cleanup.status = 'pending'; },
    row => { row.cleanup.failurePath = ''; },
    row => { row.cleanup.residualEntityIds = ['unreconciled-stock']; },
    row => { delete row.cleanup.residualEntityIds; },
  ]) {
    const evidence = fixture();
    mutate(evidence[0]);
    assert.equal(evaluate(evidence).automatedPassed, false);
  }
});

test('release rejects the packer but permits the picker, including multiple roles', () => {
  for (const flow of ['ecommerce', 'department', 'replacement']) {
    for (const stage of ['pick', 'pack']) {
      const evidence = fixture();
      const release = evidence.find(row => row.checkpoint === `${flow}.release`);
      const preparer = evidence.find(row => row.checkpoint === `${flow}.${stage}` && row.view === release.view);
      preparer.actor.id = release.actor.id;
      preparer.readback.actorId = release.actor.id;
      release.actor.roles = ['warehouse_operator', 'warehouse_supervisor'];
      if (stage === 'pack') assert.match(evaluate(evidence).failures.join('\n'), /independent of packer/);
      else assert.equal(evaluate(evidence).automatedPassed, true, `${flow}: picker may release another actor's pack`);
    }
  }
});

test('shipment completion permits the releasing operator, department acknowledgment does not', () => {
  for (const flow of ['ecommerce', 'replacement', 'department']) {
    const evidence = fixture();
    const release = evidence.find(row => row.checkpoint === `${flow}.release`);
    const receipt = evidence.find(row => row.checkpoint === `${flow}.receipt` && row.view === release.view);
    receipt.actor.id = release.actor.id;
    receipt.readback.actorId = release.actor.id;
    assert.equal(evaluate(evidence).automatedPassed, flow !== 'department', flow);
  }
});

test('completion requires the actual channel RPC rather than generic recipient confirmation', () => {
  for (const flow of ['ecommerce', 'replacement', 'department']) {
    const evidence = fixture();
    const row = evidence.find(item => item.checkpoint === `${flow}.receipt`);
    assert.deepEqual(row.operation, flow === 'department'
      ? { rpc: 'warehouse.advance_fulfillment_order', action: 'acknowledge_receipt' }
      : { rpc: 'warehouse.update_shipment_tracking', action: 'confirm_delivery' });
    row.operation = { rpc: 'warehouse.advance_fulfillment_order', action: 'confirm_delivery' };
    assert.equal(evaluate(evidence).automatedPassed, false);
    delete row.operation;
    assert.equal(evaluate(evidence).automatedPassed, false);
  }
});

test('return case resolution and physical intake/QC use separate supported branches', () => {
  const get = id => WMS_CHECKPOINTS.find(row => row.id === id);
  assert.ok(get('returns.case-resolution').checks.includes('replacement-refund-vendor_return-re_kit-write_off'));
  assert.ok(get('returns.disposition').checks.includes('accepted-damaged-hold-vendor_return-unavailable'));
  assert.ok(get('returns.case-resolution').checks.includes('case-resolution-not-physical-restock'));
  assert.ok(get('returns.closure').checks.includes('customer-closure-not-physical-restock'));
  assert.notEqual(get('returns.intake').journey, get('returns.case-resolution').journey);
  assert.equal(get('returns.intake').journey, get('returns.disposition').journey);
  assert.equal(evaluate().automatedPassed, true);
});

test('printer verification is conditional on documented operational use, not silently waived', () => {
  assert.equal(evaluate(fixture(), humanFixture()).productionReady, true);
  const humans = humanFixture();
  const hardware = humans.find(row => row.id === 'hardware');
  delete hardware.printerNotApplicableReason;
  assert.equal(evaluate(fixture(), humans).productionReady, false);
  delete hardware.printersInUse;
  assert.equal(evaluate(fixture(), humans).productionReady, false);
  hardware.printersInUse = true;
  assert.equal(evaluate(fixture(), humans).productionReady, false);
  hardware.checks.push('label-printers-and-rescan');
  assert.equal(evaluate(fixture(), humans).productionReady, true);
});

test('unrelated fixtures cannot masquerade as a continuous journey', () => {
  const evidence = fixture();
  evidence.find(row => row.checkpoint === 'department.receipt').journeyId = 'unrelated-order';
  assert.match(evaluate(evidence).failures.join('\n'), /journey/);
});

test('all registry roles, isolated access and genuine multi-role evidence are required', () => {
  const roleIds = WMS_CHECKPOINTS.filter(item => item.id.startsWith('roles.single.'));
  assert.equal(roleIds.length, 11);
  const evidence = fixture();
  const single = evidence.find(row => row.checkpoint === 'roles.single.finance');
  single.actor.roles.push('warehouse_admin');
  assert.equal(evaluate(evidence).automatedPassed, false);
  const multiple = fixture();
  multiple.find(row => row.checkpoint === 'roles.multi').actor.roles = ['warehouse_operator'];
  assert.equal(evaluate(multiple).automatedPassed, false);
});

test('requirements are independent copies and contain no duplicate keys', () => {
  const requirements = requiredWmsEvidence();
  assert.equal(new Set(requirements.map(row => `${row.checkpoint}:${row.view}`)).size, requirements.length);
  requirements[0].view = 'tampered';
  assert.equal(requiredWmsEvidence()[0].view, 'desktop1440');
});

test('malformed nested role data fails closed without throwing', () => {
  const evidence = fixture();
  evidence.find(row => row.checkpoint === 'roles.multi').actor.roles = { includes: true };
  assert.equal(evaluate(evidence).automatedPassed, false);
});

test('human approval cannot compensate for failed automated evidence', () => {
  const evidence = fixture();
  evidence[0].status = 'failed';
  assert.equal(evaluate(evidence, humanFixture()).productionReady, false);
});
