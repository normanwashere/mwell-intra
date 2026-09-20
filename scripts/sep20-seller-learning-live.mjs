import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST } from './sep20-seller-learning-manifest.mjs';
import { manifestSha256, sha256 } from './sep20-seller-learning.mjs';
import { EVENT_SELLER_REQUIREMENT as seller, EVENT_SELLER_SIMULATION as simulation } from '../modules/learning/src/eventSellerTraining.ts';
import { EVENT_SELLER_CHOICE_RULES as rules } from '../modules/learning/src/eventSellerTrainingAuthority.server.ts';
import { TARGET, PUBLIC_KEY, authorizeOnboardingRequest, executeAssignedRequirement, observeUiCommand } from './sep20-seller-learning-ui.mjs';

export const MARKETING = '7e55e54e-86cd-4157-9fdb-7616be83e340';
const EMAIL = 'intra.seller.uat.sep20@mwell.com.ph';
const parent = '01a0b4fc-57b0-7351-84ee-b8baeb3a422c';
const orientation = 'internal.general_employee.orientation.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const expectedCaps = ['record_event_outcome', 'view_event_custody'];
const ownRoles = roles => Object.entries(roles ?? {}).flatMap(([module, values]) => {
  assert(Array.isArray(values), 'Malformed roles');
  return values.map(role => `${module}.${role}`);
}).sort();

export async function runnerSource() {
  const files = ['scripts/sep20-seller-learning-live.mjs', 'scripts/sep20-seller-learning.mjs', 'scripts/sep20-seller-learning-manifest.mjs',
    'scripts/sep20-seller-learning-ui.mjs',
    'modules/learning/src/eventSellerTraining.ts', 'modules/learning/src/eventSellerTrainingAuthority.server.ts',
    'modules/learning/src/OnboardingTrainingSession.tsx', 'modules/learning/src/LearningProvider.tsx', 'modules/learning/src/repository.ts'];
  const hashes = {};
  for (const file of files) hashes[file] = sha256(await readFile(new URL(`../${file}`, import.meta.url)));
  return { hashes, sha256: sha256(JSON.stringify(hashes)) };
}

export function validateSellerRun(env, a, sourceSha256) {
  assert(env.AUDIT_LEARNING_GO === 'MAIN_GO_AFTER_SELLER_ISOLATION_AND_PUBLICATION' && env.AUDIT_MUTATIONS === 'learning-only', 'Explicit parent learning-only GO required');
  assert(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length > 0, 'Ephemeral AUDIT_PASSWORD required');
  assert(a?.schemaVersion === 1 && a.authorizedByAgentId === parent && a.projectRef === TARGET.project && a.origin === TARGET.origin,
    'Exact parent-approved UAT target required');
  assert(a.synthetic === true && a.email === EMAIL && UUID.test(a.actorId) && a.departmentId === MARKETING, 'Exact synthetic Marketing seller required');
  assert.deepEqual(ownRoles(a.roles), ['events.seller'], 'Only events.seller; no core.staff');
  assert(/^[a-f0-9]{40}$/.test(a.expectedCommit) && a.manifestSha256 === manifestSha256 && a.sourceSha256 === sourceSha256,
    'Exact build, manifest and reviewed runner source required');
  assert(UUID.test(a.runId) && UUID.test(a.provisionRunId) && HASH.test(a.provisionSha256), 'Actual provision evidence and run IDs required');
  for (const field of ['roleIsolationEvidence', 'learningPublicationEvidence']) assert(typeof a[field] === 'string' && a[field].trim().length >= 12, 'Actual isolation/publication evidence required');
  const now = Date.now(), authorized = Date.parse(a.authorizedAt), expiry = Date.parse(a.expiresAt);
  assert(Number.isFinite(authorized) && authorized <= now && expiry > now && expiry - authorized <= 24 * 60 * 60 * 1000, 'Current bounded execution approval required');
  return { actor: { id: a.actorId, email: EMAIL, role: 'seller', departmentId: MARKETING }, scope: {
    origin: TARGET.origin, project: TARGET.project, environment: 'uat', runId: a.runId, buildId: a.expectedCommit,
    provisionRunId: a.provisionRunId, provisionSha256: a.provisionSha256,
  } };
}

export function verifySellerIdentity(user, actor) {
  assert(user?.id === actor.id && user.email === actor.email && user.role === 'authenticated' && user.app_metadata?.kind === 'employee', 'Wrong ordinary UI identity');
  assert.deepEqual(ownRoles(user.app_metadata.roles), ['events.seller'], 'Unexpected seller role scope');
  return true;
}

export function planSellerTraining(snapshot) {
  assert(snapshot?.curricula?.length === 1, 'Only the exact seller curriculum may be assigned');
  const item = snapshot.curricula[0];
  assert(item.curriculum?.id === 'internal.role.events.seller.v1' && item.curriculum.version === 1 && item.curriculum.audience === 'internal'
    && item.source === 'role', 'Wrong assigned seller curriculum');
  assert.deepEqual(item.curriculum.requirementIds, [orientation, seller.id]);
  assert(item.requirements?.length === 2, 'Exactly orientation and seller practice required');
  const o = item.requirements.find(r => r.id === orientation), s = item.requirements.find(r => r.id === seller.id);
  assert(o?.version === 1 && o.audience === 'internal' && o.kind === 'orientation' && o.mandatory && o.simulationId === orientation, 'Pinned orientation required');
  assert.deepEqual(o.requiredCheckpointIds, ['complete']);
  assert.deepEqual(o.prerequisiteIds, []);
  assert.deepEqual(o.capabilityOutcomes, []);
  for (const field of ['id', 'version', 'audience', 'kind', 'title', 'mandatory', 'prerequisiteIds', 'capabilityOutcomes', 'simulationId', 'requiredCheckpointIds', 'maxAttempts']) {
    assert.deepEqual(s?.[field], seller[field], `Seller ${field} differs from reviewed source`);
  }
  return [{ requirement: o, orientation: true, steps: [{ kind: 'checkpoint', checkpointId: 'complete', title: o.title, outcomeId: 'reviewed', buttonText: 'Continue' }] },
    { requirement: s, orientation: false, steps: simulation.embeddedSteps.map(step => {
      const choiceId = rules[`${simulation.id}:${step.checkpointId}`].acceptedChoiceId;
      const choice = step.choices.find(c => c.id === choiceId);
      assert(choice, 'Reviewed visible choice missing');
      return { kind: 'choice', checkpointId: step.checkpointId, title: step.title, choiceId, buttonText: choice.label };
    }) }];
}

function verifyCapabilities(caps, complete) {
  const flatten = field => Object.entries(caps?.[field] ?? {}).flatMap(([module, values]) => {
    assert(Array.isArray(values), 'Malformed capability snapshot');
    return values.map(cap => `${module}.${cap}`);
  }).sort();
  assert.deepEqual(flatten('roleCapabilities'), expectedCaps.map(c => `events.${c}`));
  assert.deepEqual(flatten('userCapabilities'), (complete ? expectedCaps : ['view_event_custody']).map(c => `events.${c}`));
}

export function verifySellerCompletion(snapshot, capabilities, actor) {
  const plans = planSellerTraining(snapshot);
  for (const plan of plans) {
    const progress = snapshot.progress.filter(p => p.requirementId === plan.requirement.id && p.requirementVersion === 1);
    assert(progress.length === 1 && progress[0].state === 'passed' && progress[0].attemptCount === 1
      && UUID.test(progress[0].assignmentRequirementId) && Number.isFinite(Date.parse(progress[0].completedAt)), 'Own persisted first-attempt pass required; no waiver credit');
  }
  assert(snapshot.certifications?.length === 1, 'Exactly one seller certificate expected');
  const c = snapshot.certifications[0];
  assert(UUID.test(c.id) && c.userId === actor.id && c.curriculumId === 'internal.role.events.seller.v1' && c.curriculumVersion === 1
    && c.capability?.module === 'events' && c.capability.capability === 'record_event_outcome'
    && Date.parse(c.effectiveAt) <= Date.now() && (!c.expiresAt || Date.parse(c.expiresAt) > Date.now()) && !c.revokedAt && !c.supersededAt,
  'Own current scoped certification required');
  if (actor.sourceRoleAssignmentId) assert.equal(c.sourceRoleAssignmentId, actor.sourceRoleAssignmentId);
  if (actor.departmentId) assert.equal(c.departmentId, actor.departmentId);
  assert.deepEqual([...c.requirementIds].sort(), [orientation, seller.id].sort());
  verifyCapabilities(capabilities, true);
  assert(!snapshot.lockedCapabilities.some(l => l.capability?.module === 'events' && l.capability.capability === 'record_event_outcome'), 'Seller capability still locked');
  return true;
}

export async function runSellerLearning({ env = process.env, approval, chromium, fetchImpl = globalThis.fetch }) {
  const source = await runnerSource();
  const { actor, scope } = validateSellerRun(env, approval, source.sha256);
  const output = path.join(tmpdir(), `sep20-seller-learning-${approval.runId}-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  const report = { scope, actor, source, manifestSha256, complete: false, humanPilot: false, operationalSuccess: false,
    requirements: [], screenshots: [], commands: [], failures: [], startedAt: new Date().toISOString(),
    mobileCoverage: 'Responsive continuation of the same desktop attempt; no second completion',
    cleanup: { contextClosed: false, authSessionsRevoked: false } };
  let persistence = Promise.resolve();
  const persist = () => {
    const bytes = JSON.stringify(report, null, 2);
    persistence = persistence.then(() => writeFile(path.join(output, 'report.json'), bytes, { flush: true }));
    return persistence;
  };
  const state = { actor, scope, password: env.AUDIT_PASSWORD, token: null, phase: 'login', stopped: false, armed: null };
  const deadline = Math.min(Date.parse(approval.expiresAt), Date.now() + 15 * 60 * 1000);
  const check = () => assert(!state.stopped && Date.now() < deadline && !report.failures.length, 'Runner stopped or approval/deadline expired; no replay');
  const headers = schema => ({ apikey: PUBLIC_KEY, authorization: `Bearer ${state.token}`, 'content-type': 'application/json', 'accept-profile': schema, 'content-profile': schema });
  const read = async (url, init = {}) => {
    assert([TARGET.origin, TARGET.backend].includes(new URL(url).origin), 'Foreign read denied');
    const response = await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    assert(response.ok, `Readback failed (${response.status})`);
    return { data: await response.json(), response };
  };
  const rpc = async (schema, name) => (await read(`${TARGET.backend}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(schema), body: '{}' })).data;
  const health = async () => {
    check();
    const { data } = await read(`${TARGET.origin}/api/health`);
    assert(data.status === 'ok' && data.supabase === 'reachable' && data.commit === scope.buildId
      && data.deployment?.appEnv === 'uat' && data.deployment.supabaseProjectRef === TARGET.project, 'Live build/project/health mismatch');
    return data;
  };
  const readSnapshot = async () => ({ actorId: actor.id, scope, source: 'learning.my_learning_snapshot', observedAt: new Date().toISOString(), snapshot: await rpc('learning', 'my_learning_snapshot') });
  const readOwnScope = async () => {
    const rows = async (table, filter) => (await read(`${TARGET.backend}/rest/v1/${table}?${filter}`, { headers: headers('core') })).data;
    const profiles = await rows('profiles', `id=eq.${actor.id}&select=id,email,kind,status,title&limit=2`);
    assert(profiles.length === 1 && profiles[0].id === actor.id && profiles[0].email === EMAIL && profiles[0].kind === 'employee' && profiles[0].status === 'active'
      && /synthetic/i.test(profiles[0].title ?? ''), 'Actual synthetic active profile required');
    const roles = await rows('user_roles', `user_id=eq.${actor.id}&select=id,module,role,effective_at,expires_at&limit=3`);
    assert(roles.length === 1 && roles[0].module === 'events' && roles[0].role === 'seller' && Date.parse(roles[0].effective_at) <= Date.now()
      && (!roles[0].expires_at || Date.parse(roles[0].expires_at) > Date.now()), 'Exact single active seller assignment required');
    actor.sourceRoleAssignmentId = roles[0].id;
    const scopes = await rows('profile_department_scopes', `profile_id=eq.${actor.id}&select=department_id,scope_type,effective_from,effective_to&limit=3`);
    const today = new Date().toISOString().slice(0, 10);
    assert(scopes.length === 1 && scopes[0].department_id === MARKETING && scopes[0].scope_type === 'member' && scopes[0].effective_from <= today
      && (!scopes[0].effective_to || scopes[0].effective_to >= today), 'Actual Marketing member scope only required');
    const departments = await rows('departments', `id=eq.${MARKETING}&select=id,code,is_active&limit=2`);
    assert(departments.length === 1 && departments[0].code === 'marketing' && departments[0].is_active === true, 'Actual active Marketing department required');
    return { profiles, roles, scopes, departments };
  };
  let browser, context, page;
  const redact = error => String(error?.message ?? 'Stopped').replaceAll(env.AUDIT_PASSWORD, '[REDACTED]')
    .replaceAll(state.token ?? 'TOKEN_NOT_SET', '[REDACTED]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(0, 1200);
  try {
    report.health = await health(); await persist();
    chromium ??= createRequire(new URL('../apps/shell/package.json', import.meta.url))('@playwright/test').chromium;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
    let captureIndex = 0, authCount = 0, bootstrapCount = 0;
    const capture = async label => {
      assert(new URL(page.url()).pathname === '/onboarding', 'Only authenticated onboarding screenshots');
      for (const [view, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
        await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready);
        const file = `${++captureIndex}-${label}-${view}.png`;
        const bytes = await page.screenshot({ fullPage: true, animations: 'disabled', mask: [page.locator('input[type=password]')] });
        await writeFile(path.join(output, file), bytes, { flag: 'wx' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        report.screenshots.push({ file, sha256: sha256(bytes), view, width, height, overflow, observedAt: new Date().toISOString() });
        assert(!overflow, 'Onboarding horizontal overflow');
      }
      await page.setViewportSize({ width: 1440, height: 900 }); await persist();
    };
    page.on('pageerror', () => { report.failures.push('page-error'); state.stopped = true; });
    page.on('console', msg => { if (msg.type() === 'error') { report.failures.push('console-error'); state.stopped = true; } });
    await context.route('**/*', async route => {
      const req = route.request();
      try {
        check(); let body;
        try { body = req.postDataJSON(); } catch { body = undefined; }
        const category = authorizeOnboardingRequest({ url: req.url(), method: req.method(), headers: req.headers(), body }, state);
        if (category === 'read') return await route.continue();
        if (category === 'auth') assert(++authCount === 1, 'One normal UI login only');
        if (category === 'bootstrap') assert(++bootstrapCount <= 100, 'Bounded learning bootstrap only');
        const armed = state.armed;
        if (category === 'command') {
          const intent = { action: armed.context.action, idempotencyKey: armed.idempotencyKey, outcome: 'intent-before-dispatch' };
          report.commands.push(intent);
          await writeFile(path.join(output, `command-${report.commands.length}-intent.json`), JSON.stringify(intent), { flag: 'wx', flush: true });
          await persist();
        }
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 20000 });
        assert(response.ok(), 'UI request rejected; no replay');
        const data = await response.json();
        if (category === 'auth') {
          verifySellerIdentity(data.user, actor);
          assert(typeof data.access_token === 'string' && data.access_token.length > 0, 'Missing ordinary session');
          state.token = data.access_token;
          report.ownScope = await readOwnScope();
          report.beforeBootstrap = await readSnapshot();
          assert(report.beforeBootstrap.snapshot.progress.length === 0 && report.beforeBootstrap.snapshot.certifications.length === 0, 'Fresh synthetic learner required; no replay');
          state.phase = 'onboarding'; await persist();
        }
        if (category === 'command') {
          if (armed.context.action.kind === 'choice') assert(data.accepted === true && data.recorded === true, 'Choice not recorded');
          armed.response = data; report.commands.at(-1).outcome = 'response-received'; await persist();
        }
        await route.fulfill({ response });
      } catch (error) {
        state.stopped = true; report.failures.push(redact(error)); await persist();
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    await page.goto(`${TARGET.origin}/login?redirect=%2Fonboarding`, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(EMAIL); await page.locator('#password').fill(env.AUDIT_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click(); await page.waitForURL(url => url.pathname === '/onboarding');
    await page.getByRole('heading', { name: /^(Role onboarding|No onboarding assigned yet|Onboarding unavailable)$/ }).waitFor({ state: 'visible' });
    verifySellerIdentity((await read(`${TARGET.backend}/auth/v1/user`, { headers: headers('core') })).data, actor);
    report.initial = await readSnapshot();
    const plans = planSellerTraining(report.initial.snapshot);
    report.beforeCapabilities = await rpc('core', 'my_capability_snapshot'); verifyCapabilities(report.beforeCapabilities, false);
    await capture('assigned');
    for (const plan of plans) {
      const initial = await readSnapshot();
      const result = await executeAssignedRequirement({ page, actor, scope, plan, initial, readSnapshot, capture, check,
        command: (commandContext, click) => observeUiCommand({ page, state, context: commandContext, click, check, before: health }),
        readEvents: async (attemptId, key) => {
          const query = new URLSearchParams({ select: 'id,user_id,actor_id,attempt_id,audience,checkpoint_id,idempotency_key,event_type,evidence_hash,event_at,detail',
            user_id: `eq.${actor.id}`, attempt_id: `eq.${attemptId}`, idempotency_key: `eq.${key}`, limit: '2' });
          const result = await read(`${TARGET.backend}/rest/v1/attempt_events?${query}`, { headers: { ...headers('learning'), prefer: 'count=exact' } });
          assert(result.response.headers.get('content-range')?.endsWith('/1'), 'Exactly one checkpoint readback required'); return result.data;
        }, recordCheckpoint: async checkpoint => {
          report.lastCheckpoint = checkpoint; await persist();
        } });
      report.requirements.push(result); await persist();
    }
    report.final = await readSnapshot(); report.afterCapabilities = await rpc('core', 'my_capability_snapshot');
    report.finalScope = await readOwnScope();
    verifySellerCompletion(report.final.snapshot, report.afterCapabilities, actor);
    report.endHealth = await health(); assert.equal((await runnerSource()).sha256, source.sha256, 'Runner source changed during run');
    check(); report.complete = true;
  } catch (error) {
    state.stopped = true; report.failure = redact(error);
    report.recovery = { noReplay: true, observation: state.token ? await readSnapshot().catch(() => null) : null };
  } finally {
    await context?.close().then(() => { report.cleanup.contextClosed = true; }).catch(() => { report.complete = false; });
    await browser?.close().catch(() => { report.complete = false; });
    report.finishedAt = new Date().toISOString(); await persist();
  }
  return { output, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'inspect' && process.argv.length === 3) console.log(JSON.stringify({ target: TARGET, email: EMAIL, departmentId: MARKETING, manifestSha256, source: await runnerSource(), liveExecuted: false }, null, 2));
  else if (process.argv[2] === 'run' && process.argv.length === 3) {
    assert(HASH.test(process.env.SELLER_LEARNING_APPROVAL_SHA256 ?? ''), 'Actual parent approval hash required');
    const bytes = await readFile(process.env.SELLER_LEARNING_APPROVAL_PATH);
    assert.equal(sha256(bytes), process.env.SELLER_LEARNING_APPROVAL_SHA256, 'Approval file hash mismatch');
    const result = await runSellerLearning({ approval: JSON.parse(bytes.toString('utf8')) });
    console.log(JSON.stringify({ output: result.output, complete: result.report.complete, liveHumanPilot: false, operationalSuccess: false }));
    if (!result.report.complete) process.exitCode = 1;
  } else throw new Error('Usage: node scripts/sep20-seller-learning-live.mjs inspect | run. Run requires explicit parent approval and ephemeral password.');
}
