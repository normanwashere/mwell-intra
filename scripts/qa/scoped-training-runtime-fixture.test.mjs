import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDIDATES, SCENARIO_IDS, assertCandidate, requestDisposition, scenarioSnapshot } from './scoped-training-runtime-fixture.mjs';

test('only exact authorized candidate and SHA can be selected', () => {
  for (const [origin, sha] of CANDIDATES) {
    assertCandidate(origin, sha);
    assert.throws(() => assertCandidate(origin, 'a'.repeat(40)));
    assert.throws(() => assertCandidate(`${origin}.example.org`, sha));
  }
  assert.throws(() => assertCandidate('https://mwell-intra-uat.vercel.app', undefined));
});

test('local runtime rejects all writes and every external origin', () => {
  const origin = 'http://127.0.0.1:3021';
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(requestDisposition(method, `${origin}/rest/v1/rpc/start_requirement`, origin), 'block');
  }
  assert.equal(requestDisposition('GET', `${origin}/fixture.js`, origin), 'read');
  assert.equal(requestDisposition('GET', 'https://example.org/', origin), 'block');
});

test('four exact IDs get isolated uncompleted API-shaped fixtures without certificates', () => {
  assert.equal(SCENARIO_IDS.length, 4);
  for (const id of SCENARIO_IDS) {
    const simulation = { id, title: 'Fixture title', capabilityOutcomes: [{ module: 'warehouse', capability: 'transfer_stock' }] };
    const fixture = scenarioSnapshot(simulation);
    assert.equal(fixture.progress[0].state, 'not_started');
    assert.equal(fixture.progress[0].allowsSharedCompletion, false);
    assert.equal(fixture.progress[0].activeAttempt, undefined);
    assert.deepEqual(fixture.certifications, []);
    assert.equal(scenarioSnapshot(simulation, 'audience').curricula[0].requirements[0].audience, 'vendor');
    assert.equal(scenarioSnapshot(simulation, 'version').curricula[0].requirements[0].version, 999);
    assert.notEqual(scenarioSnapshot(simulation, 'unknown').curricula[0].requirements[0].simulationId, id);
    assert.equal(scenarioSnapshot(simulation, 'kind').curricula[0].requirements[0].kind, 'attestation');
    assert.equal(simulation.capabilityOutcomes[0].capability, 'transfer_stock');
  }
});
