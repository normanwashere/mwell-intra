import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MANIFEST } from './sep20-seller-learning-manifest.mjs';
import { manifestSha256 } from './sep20-seller-learning.mjs';
import { EVENT_SELLER_REQUIREMENT } from '../modules/learning/src/eventSellerTraining.ts';
import { TARGET, authorizeOnboardingRequest, verifyCheckpointEvents } from './sep20-seller-learning-ui.mjs';
import { validateSellerRun, verifySellerIdentity, verifyUnstartedSeller, planSellerTraining, verifySellerCompletion, runnerSource } from './sep20-seller-learning-live.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const email = 'intra.seller.uat.sep20@mwell.com.ph';
const user = { id, email, role: 'authenticated', app_metadata: { kind: 'employee', roles: { events: ['seller'] } } };
const snapshot = () => ({
  curricula: [{ curriculum: { id: 'internal.role.events.seller.v1', version: 1, audience: 'internal',
    requirementIds: ['internal.general_employee.orientation.v1', EVENT_SELLER_REQUIREMENT.id] },
    source: 'role', requirements: [{ id: 'internal.general_employee.orientation.v1', version: 1, audience: 'internal', kind: 'orientation',
      title: 'Role orientation', mandatory: true, prerequisiteIds: [], capabilityOutcomes: [], simulationId: 'internal.general_employee.orientation.v1', requiredCheckpointIds: ['complete'] }, EVENT_SELLER_REQUIREMENT] }],
  progress: [], certifications: [], lockedCapabilities: [], refreshedAt: new Date().toISOString(),
});

test('live runner requires exact parent-authorized synthetic identity and fresh readiness/build/source binding', async () => {
  const source = await runnerSource();
  const approval = { schemaVersion: 1, authorizedByAgentId: '01a0b4fc-57b0-7351-84ee-b8baeb3a422c',
    projectRef: TARGET.project, origin: TARGET.origin, expectedCommit: '998906fee743dfc9baaa895c5d713d152a488de2',
    actorId: id, email, synthetic: true, roles: { events: ['seller'] }, departmentId: '7e55e54e-86cd-4157-9fdb-7616be83e340',
    runId: id, provisionRunId: id, provisionSha256: 'a'.repeat(64), sourceSha256: source.sha256, manifestSha256,
    roleIsolationEvidence: 'FIXTURE ONLY: not live evidence', learningPublicationEvidence: 'FIXTURE ONLY: not live evidence',
    authorizedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const env = { AUDIT_LEARNING_GO: 'MAIN_GO_AFTER_SELLER_ISOLATION_AND_PUBLICATION', AUDIT_MUTATIONS: 'learning-only', AUDIT_PASSWORD: 'fixture-not-a-real-password' };
  assert.equal(validateSellerRun(env, approval, source.sha256).actor.id, id);
  for (const patch of [{ synthetic: false }, { actorId: '' }, { email: 'real@example.invalid' }, { roles: { core: ['staff'], events: ['seller'] } },
    { manifestSha256: '0'.repeat(64) }, { sourceSha256: '0'.repeat(64) }, { roleIsolationEvidence: '' }, { learningPublicationEvidence: '' },
    { expiresAt: '2020-01-01T00:00:00Z' }, { origin: 'http://localhost:3031' }, { departmentId: id }]) {
    assert.throws(() => validateSellerRun(env, { ...approval, ...patch }, source.sha256));
  }
  assert.throws(() => validateSellerRun({ ...env, AUDIT_LEARNING_GO: '' }, approval, source.sha256));
});

test('release runner has no dependency on unrelated dirty or untracked WMS helpers', async () => {
  for (const file of ['sep20-seller-learning-live.mjs', 'sep20-seller-learning-ui.mjs']) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.\/qa\/|scripts\/qa\//);
  }
});

test('request guard refuses operational writes, foreign identities and unarmed/replayed commands', () => {
  const state = { actor: { id, email }, token: 'fixture-token', phase: 'onboarding', stopped: false, armed: null };
  const request = { url: `${TARGET.backend}/rest/v1/rpc/resolve_assignments`, method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-profile': 'learning' }, body: {} };
  assert.equal(authorizeOnboardingRequest(request, state), 'bootstrap');
  for (const patch of [{ method: 'DELETE' }, { url: `${TARGET.backend}/rest/v1/rpc/record_event_outcome` },
    { url: `${TARGET.origin}/api/learning/simulation-choice` }, { body: { user_id: MANIFEST.ownerId } }]) {
    assert.throws(() => authorizeOnboardingRequest({ ...request, ...patch }, state));
  }
  state.armed = { consumed: false, context: { actor: state.actor, action: { kind: 'start', assignmentRequirementId: id } } };
  const start = { ...request, url: `${TARGET.backend}/rest/v1/rpc/start_requirement`, body: { payload: { assignment_requirement_id: id, idempotency_key: id } } };
  assert.equal(authorizeOnboardingRequest(start, state), 'command');
  assert.throws(() => authorizeOnboardingRequest(start, state));
  assert.throws(() => verifyCheckpointEvents([], state.armed.context, id, false));
});

test('normal authenticated seller must not carry core staff or any other action role', () => {
  assert.equal(verifySellerIdentity(user, { id, email }), true);
  for (const roles of [{ events: ['seller', 'event_manager'] }, { core: ['staff'], events: ['seller'] }, { events: ['viewer'] }]) {
    assert.throws(() => verifySellerIdentity({ ...user, app_metadata: { ...user.app_metadata, roles } }, { id, email }));
  }
  assert.throws(() => verifySellerIdentity({ ...user, id: MANIFEST.ownerId }, { id, email }));
});

test('onboarding permits only its reviewed contextual help read', () => {
  const state = { actor: { id, email }, token: 'fixture-token', phase: 'onboarding', stopped: false, armed: null };
  const request = { url: `${TARGET.origin}/api/knowledge/context?path=%2Fonboarding`, method: 'GET', headers: {} };
  assert.equal(authorizeOnboardingRequest(request, state), 'read');
  assert.equal(authorizeOnboardingRequest({ ...request, url: `${TARGET.origin}/api/knowledge/tasks` }, state), 'read');
  assert.throws(() => authorizeOnboardingRequest({ ...request, url: `${TARGET.origin}/api/knowledge/tasks?demoProfile=admin` }, state));
  for (const url of [`${TARGET.origin}/api/admin/audit`, `${TARGET.origin}/api/knowledge/context?article=foreign`,
    `${TARGET.origin}/api/knowledge/context?path=%2Fwarehouse`, `${TARGET.origin}/api/knowledge/context?path=%2Fonboarding&extra=1`]) {
    assert.throws(() => authorizeOnboardingRequest({ ...request, url }, state));
  }
  assert.throws(() => authorizeOnboardingRequest({ ...request, method: 'POST', body: {} }, state));
});

test('a materialized assignment is not an attempted or completed learning session', () => {
  const s = snapshot();
  assert.equal(verifyUnstartedSeller(s), true);
  s.progress = s.curricula[0].requirements.map(r => ({ requirementId: r.id, requirementVersion: 1,
    state: 'not_started', attemptCount: 0, activeAttempt: null, completedAt: null }));
  assert.equal(verifyUnstartedSeller(s), true);
  for (const patch of [{ state: 'passed' }, { attemptCount: 1 }, { activeAttempt: { id } },
    { completedAt: new Date().toISOString() }, { requirementVersion: 2 }, { requirementId: 'foreign' }]) {
    const v = structuredClone(s); Object.assign(v.progress[0], patch); assert.throws(() => verifyUnstartedSeller(v));
  }
  assert.throws(() => verifyUnstartedSeller({ ...s, certifications: [{ id }] }));
});

test('only exact assigned orientation and six reviewed seller decisions are executable', () => {
  const plans = planSellerTraining(snapshot());
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[0].steps, [{ kind: 'checkpoint', checkpointId: 'complete', title: 'Role orientation', outcomeId: 'reviewed', buttonText: 'Continue' }]);
  assert.equal(plans[1].steps.length, 6);
  assert.deepEqual(plans[1].steps.map(s => s.checkpointId), EVENT_SELLER_REQUIREMENT.requiredCheckpointIds);
  for (const change of [s => s.curricula[0].requirements.pop(), s => s.curricula[0].requirements[1] = { ...EVENT_SELLER_REQUIREMENT, maxAttempts: 99 },
    s => s.curricula[0].requirements[1] = { ...EVENT_SELLER_REQUIREMENT, capabilityOutcomes: [{ module: 'events', capability: 'manage_events' }] },
    s => s.curricula[0].requirements[1] = { ...EVENT_SELLER_REQUIREMENT, requiredCheckpointIds: ['complete'] }]) {
    const s = snapshot(); change(s); assert.throws(() => planSellerTraining(s));
  }
});

test('post-learning proof requires own persisted passes and exact scoped active certificate', () => {
  const s = snapshot();
  s.progress = s.curricula[0].requirements.map((r, n) => ({ requirementId: r.id, requirementVersion: 1,
    assignmentRequirementId: `00000000-0000-4000-8000-00000000000${n + 2}`, state: 'passed', attemptCount: 1, completedAt: new Date().toISOString() }));
  s.certifications = [{ id, userId: id, departmentId: id, sourceRoleAssignmentId: id, curriculumId: 'internal.role.events.seller.v1', curriculumVersion: 1,
    capability: { module: 'events', capability: 'record_event_outcome' }, requirementIds: s.progress.map(p => p.requirementId),
    issuedAt: new Date().toISOString(), effectiveAt: new Date().toISOString() }];
  const caps = { roleCapabilities: { events: ['view_event_custody', 'record_event_outcome'] }, userCapabilities: { events: ['view_event_custody', 'record_event_outcome'] } };
  assert.equal(verifySellerCompletion(s, caps, { id }), true);
  for (const change of [v => v.progress[0].state = 'waived', v => v.certifications[0].userId = MANIFEST.ownerId,
    v => v.certifications[0].expiresAt = '2020-01-01T00:00:00Z', v => v.certifications[0].requirementIds = [], v => v.certifications = []]) {
    const v = structuredClone(s); change(v); assert.throws(() => verifySellerCompletion(v, caps, { id }));
  }
  assert.throws(() => verifySellerCompletion(s, { ...caps, userCapabilities: { ...caps.userCapabilities, warehouse: ['inspect_quality'] } }, { id }));
});
