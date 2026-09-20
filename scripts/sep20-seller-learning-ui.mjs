import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

// Bounded adaptation of the existing onboarding harness, without its unrelated WMS/provisioning imports.
export const TARGET = Object.freeze({ origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah', backend: 'https://kkoitlvydytdhlpxhuah.supabase.co' });
export const PUBLIC_KEY = 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9';
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort());

export function authorizeOnboardingRequest(request, state) {
  const u = new URL(request.url), h = new Headers(request.headers), method = request.method;
  assert([TARGET.origin, TARGET.backend].includes(u.origin) && !u.username && !u.password && !u.hash, 'Foreign request');
  if (method === 'OPTIONS') {
    assert(u.origin === TARGET.backend && h.get('origin') === TARGET.origin && ['GET', 'HEAD', 'POST'].includes(h.get('access-control-request-method'))
      && (u.pathname.startsWith('/rest/v1/') || u.pathname.startsWith('/auth/v1/')), 'Unreviewed CORS preflight');
    return 'read';
  }
  if (['GET', 'HEAD'].includes(method)) {
    assert(!u.pathname.startsWith('/rest/v1/rpc/'), 'GET RPC not permitted');
    if (u.origin === TARGET.origin) {
      const contextualHelp = u.pathname === '/api/knowledge/context' && u.searchParams.size === 1
        && u.searchParams.get('path') === '/onboarding';
      const taskSuggestions = u.pathname === '/api/knowledge/tasks' && !u.search;
      assert(!u.pathname.startsWith('/api/') || u.pathname === '/api/health' || contextualHelp || taskSuggestions, `Unreviewed app API read: ${u.pathname}`);
    }
    else assert(u.pathname === '/auth/v1/user' || u.pathname.startsWith('/rest/v1/') || u.pathname.startsWith('/storage/v1/object/'), 'Unreviewed backend read');
    return 'read';
  }
  assert(method === 'POST', 'Non-POST mutation blocked');
  if (u.origin === TARGET.backend && u.pathname === '/auth/v1/token') {
    assert(state.phase === 'login' && u.search === '?grant_type=password'
      && (exact(request.body, ['email', 'password']) || exact(request.body, ['email', 'password', 'gotrue_meta_security']) && exact(request.body.gotrue_meta_security, []))
      && request.body.email === state.actor.email && request.body.password === state.password, 'Only bound ordinary UI login allowed');
    return 'auth';
  }
  assert(state.token && !state.stopped, 'Unverified/stopped session');
  if (u.origin === TARGET.backend) {
    assert(h.get('authorization') === `Bearer ${state.token}` && !u.search, 'Foreign session');
    const name = u.pathname.replace('/rest/v1/rpc/', ''), schema = h.get('content-profile');
    if (exact(request.body, []) && ((schema === 'core' && name === 'my_capability_snapshot') || (schema === 'learning' && name === 'my_learning_snapshot'))) return 'read';
    if (schema === 'learning' && ['resolve_assignments', 'evaluate_certifications', 'sync_shared_completions'].includes(name)
      && exact(request.body, []) && state.phase === 'onboarding') return 'bootstrap';
  }
  const armed = state.armed, a = armed?.context.action;
  assert(armed && !armed.consumed && a && uuid(a.assignmentRequirementId), 'Unarmed or consumed learning command');
  assert(armed.context.actor.id === state.actor.id, 'Foreign command identity');
  if (a.kind === 'choice') {
    assert(request.url === `${TARGET.origin}/api/learning/simulation-choice`, 'Same-origin choice required');
    assert(uuid(request.body?.idempotencyKey), 'Choice key required');
    assert.deepEqual(request.body, { assignmentRequirementId: a.assignmentRequirementId, attemptId: a.attemptId,
      simulationId: a.simulationId, checkpointId: a.checkpointId, choiceId: a.choiceId, idempotencyKey: request.body.idempotencyKey });
  } else {
    assert(['start', 'checkpoint'].includes(a.kind), 'Unknown command');
    const rpc = a.kind === 'start' ? 'start_requirement' : 'record_simulation_checkpoint';
    assert(request.url === `${TARGET.backend}/rest/v1/rpc/${rpc}` && h.get('content-profile') === 'learning' && exact(request.body, ['payload']), 'Exact learning RPC required');
    assert(uuid(request.body.payload?.idempotency_key), 'Command key required');
    assert.deepEqual(request.body.payload, { assignment_requirement_id: a.assignmentRequirementId,
      ...(a.kind === 'start' ? {} : { attempt_id: a.attemptId, checkpoint_id: a.checkpointId, outcome_id: a.outcomeId }), idempotency_key: request.body.payload.idempotency_key });
  }
  armed.consumed = true;
  armed.idempotencyKey = request.body.idempotencyKey ?? request.body.payload.idempotency_key;
  return 'command';
}

export async function observeUiCommand({ page, state, context, check, before, click }) {
  check(); await before(); state.armed = { context, consumed: false };
  const expected = context.action.kind === 'choice' ? `${TARGET.origin}/api/learning/simulation-choice`
    : `${TARGET.backend}/rest/v1/rpc/${context.action.kind === 'start' ? 'start_requirement' : 'record_simulation_checkpoint'}`;
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === expected);
  response.catch(() => {});
  await click(); await response; check();
  assert(state.armed.consumed && state.armed.response, 'Missing governed response');
  const recorded = state.armed; state.armed = null; return recorded;
}

export async function locateStartAction(page, requirement) {
  const row = page.locator(`[id="onboarding-requirement-${encodeURIComponent(requirement.id)}"]`);
  await row.waitFor({ state: 'visible' });
  const options = { name: `Start ${requirement.title}`, exact: true };
  let button = row.getByRole('button', options);
  assert(await button.count() <= 1, 'Ambiguous inline start');
  if (await button.count() === 0) {
    assert.equal(await row.getByText('Continue above', { exact: true }).count(), 1, 'Missing next-action marker');
    const next = page.locator('section').filter({ has: page.getByText('Next required action', { exact: true }) });
    assert.equal(await next.count(), 1, 'Ambiguous next-action section');
    button = next.getByRole('button', options);
  }
  assert.equal(await button.count(), 1, 'Missing or ambiguous start');
  await button.waitFor({ state: 'visible' }); return button;
}

function actionContext(observation, actor, scope, action) {
  assert(observation.actorId === actor.id && isDeepStrictEqual(observation.scope, scope) && observation.source === 'learning.my_learning_snapshot', 'Own authoritative snapshot required');
  const p = observation.snapshot.progress.find(p => p.assignmentRequirementId === action.assignmentRequirementId);
  assert(p && p.requirementId === action.requirementId && p.requirementVersion === action.requirementVersion, 'Assigned version mismatch');
  if (action.kind !== 'start') assert(p.state === 'in_progress' && p.activeAttempt?.id === action.attemptId, 'Own active attempt required');
  return { actor, scope, action };
}

export function verifyCheckpointEvents(rows, context, key, terminal) {
  const { actor, action: a } = context, outcome = a.choiceId ?? a.outcomeId;
  assert(Array.isArray(rows) && rows.length === 1, 'Exactly one persisted checkpoint required');
  const e = rows[0];
  assert(uuid(e.id) && e.user_id === actor.id && e.actor_id === actor.id && e.attempt_id === a.attemptId && e.audience === 'internal'
    && e.checkpoint_id === a.checkpointId && e.idempotency_key === key && e.event_type === (terminal ? 'completed' : 'checkpoint')
    && Number.isFinite(Date.parse(e.event_at)) && e.detail?.validated === true && e.detail.terminal === terminal && e.detail.outcome_id === outcome
    && e.evidence_hash === createHash('sha256').update(`${a.attemptId}:${a.checkpointId}:${outcome}:${key}`).digest('hex'), 'Persisted own checkpoint mismatch');
  return true;
}

export async function executeAssignedRequirement({ page, actor, scope, plan, initial, readSnapshot, readEvents, capture, command, check, recordCheckpoint }) {
  const r = plan.requirement;
  const progress = observation => {
    const matches = observation.snapshot.progress.filter(p => p.requirementId === r.id && p.requirementVersion === r.version);
    assert.equal(matches.length, 1, 'Exactly one assigned requirement required'); return matches[0];
  };
  const before = progress(initial);
  assert(before.state === 'not_started' && before.attemptCount === 0, 'Fresh assignment required; no automatic resume/replay');
  assert(r.prerequisiteIds.every(id => initial.snapshot.progress.some(p => p.requirementId === id && p.requirementVersion === 1 && p.state === 'passed')), 'Passed prerequisite required');
  await page.goto(`${scope.origin}/onboarding?requirement=${encodeURIComponent(r.id)}`, { waitUntil: 'domcontentloaded' });
  const start = { kind: 'start', assignmentRequirementId: before.assignmentRequirementId, requirementId: r.id, requirementVersion: r.version, buttonText: `Start ${r.title}` };
  const button = await locateStartAction(page, r); await capture('before-start');
  await command(actionContext(initial, actor, scope, start), () => button.click());
  let observed = await readSnapshot(), current = progress(observed);
  assert(current.state === 'in_progress' && current.assignmentRequirementId === before.assignmentRequirementId && current.attemptCount === 1 && uuid(current.activeAttempt?.id), 'Started attempt not persisted');
  const attemptId = current.activeAttempt.id;
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#training-coach-title') });
  if (plan.orientation) {
    await dialog.getByRole('heading', { name: 'Confirm why this step is assigned', exact: true }).waitFor({ state: 'visible' });
    await capture('orientation-context'); await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  const checkpoints = [];
  for (const [index, step] of plan.steps.entries()) {
    check(); await dialog.getByRole('heading', { name: step.title, exact: true }).waitFor({ state: 'visible' });
    const action = { ...step, assignmentRequirementId: before.assignmentRequirementId, requirementId: r.id, requirementVersion: r.version, simulationId: r.simulationId, attemptId };
    const context = actionContext(observed, actor, scope, action);
    await capture(`step-${index + 1}-before`);
    const result = await command(context, () => dialog.getByRole('button', { name: step.buttonText, exact: true }).click());
    const events = await readEvents(attemptId, result.idempotencyKey), terminal = index === plan.steps.length - 1;
    verifyCheckpointEvents(events, context, result.idempotencyKey, terminal);
    observed = await readSnapshot(); current = progress(observed);
    assert(current.assignmentRequirementId === before.assignmentRequirementId && current.attemptCount === 1
      && (terminal ? current.state === 'passed' && Number.isFinite(Date.parse(current.completedAt)) : current.state === 'in_progress' && current.activeAttempt?.id === attemptId), 'Checkpoint readback mismatch');
    const checkpoint = { checkpointId: step.checkpointId, idempotencyKey: result.idempotencyKey, events, observation: observed };
    checkpoints.push(checkpoint); await recordCheckpoint(checkpoint);
    await dialog.getByRole('heading', { name: terminal ? (plan.orientation ? 'Guided review complete' : 'Guided practice complete') : plan.steps[index + 1].title, exact: true }).waitFor({ state: 'visible' });
    await capture(`step-${index + 1}-persisted`);
  }
  await dialog.getByRole('button', { name: 'Finish review', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloaded = await readSnapshot();
  assert(progress(reloaded).state === 'passed' && progress(reloaded).assignmentRequirementId === before.assignmentRequirementId, 'Completion lost on reload');
  await capture('completed-reload');
  return { requirementId: r.id, version: r.version, assignmentRequirementId: before.assignmentRequirementId, attemptId, before, checkpoints, reloaded, status: 'passed' };
}
