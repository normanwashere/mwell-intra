import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCOPED_READINESS_CANDIDATES } from '../../modules/learning/src/scopedReadinessCandidates.ts';
import { SCOPED_READINESS_CANDIDATE_RULES } from '../../modules/learning/src/scopedReadinessCandidateAuthority.server.ts';
import { OPS_CUSTODY_CANDIDATES } from '../../modules/learning/src/opsCustodyCandidates.ts';
import { OPS_CUSTODY_CANDIDATE_RULES } from '../../modules/learning/src/opsCustodyCandidateAuthority.server.ts';
import { VENDOR_CASES, VENDOR_SIMULATIONS, VENDOR_RULES } from './vendor-live-learning-cases.mjs';

const ORIGIN = 'https://mwell-intra-uat.vercel.app';
const PROJECT = 'kkoitlvydytdhlpxhuah';
const DB = `https://${PROJECT}.supabase.co`;
export const CASES = [
  ['operations_associate','intra.test.operations.associate@mwell.com.ph','internal.role.warehouse.warehouse_operator.quality-inspection.v1','warehouse-quality-inspection-review-v1'],
  ['operations_associate','intra.test.operations.associate@mwell.com.ph','internal.role.warehouse.warehouse_operator.putaway.v1','warehouse-putaway-review-v1'],
  ['operations_associate','intra.test.operations.associate@mwell.com.ph','internal.role.warehouse.warehouse_operator.pick-pack.v1','warehouse-pick-pack-review-v1'],
  ['finance_controller','intra.test.finance@mwell.com.ph','internal.role.procurement.finance.payment-readiness.v1','procurement-payment-readiness-review-v1'],
].map(([role,email,requirementId,simulationId]) => ({ role,email,requirementId,simulationId }));
const rules = { ...SCOPED_READINESS_CANDIDATE_RULES, ...OPS_CUSTODY_CANDIDATE_RULES };
const simulations = [...SCOPED_READINESS_CANDIDATES, ...OPS_CUSTODY_CANDIDATES];

export function validateEnvironment(env) {
  assert.equal(env.AUDIT_LEARNING_GO, 'MAIN_GO_AFTER_READONLY_SWEEP');
  assert.equal(env.AUDIT_MUTATIONS, 'learning-only');
  assert.equal(env.APP_ENV, 'uat');
  assert.equal(env.AUDIT_BASE_URL, ORIGIN);
  assert.equal(env.SUPABASE_PROJECT_REF, PROJECT);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, ''), DB);
  assert.match(env.AUDIT_EXPECTED_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(env.AUDIT_PASSWORD, 'AUDIT_PASSWORD required in process environment');
}

export function permittedRequest({ url, method, body, mobile, target, assignmentId, attemptId, attestationCheckpoint }) {
  mobile = mobile || target.readOnly === true;
  const u = new URL(url);
  if (![ORIGIN, DB].includes(u.origin)) return false;
  if (['GET','HEAD','OPTIONS'].includes(method)) {
    return !u.pathname.startsWith('/rest/v1/rpc/') || ['/rest/v1/rpc/my_learning_snapshot','/rest/v1/rpc/my_capability_snapshot'].includes(u.pathname);
  }
  if (u.origin === DB && u.pathname === '/auth/v1/token' && method === 'POST') return true;
  if (u.origin === DB && method === 'POST') {
    // Normal learner reconciliation only; no direct evidence/certification writes.
    if (['my_learning_snapshot','my_capability_snapshot','resolve_assignments','sync_shared_completions','evaluate_certifications'].some((name) => u.pathname === `/rest/v1/rpc/${name}`)) return true;
    if (!mobile && target.protocol === 'attestation' && target.requirementId === VENDOR_CASES[0].requirementId &&
        target.simulationId === 'vendor-evidence-review-v1' && u.pathname === '/rest/v1/rpc/record_simulation_checkpoint') {
      const p = body?.payload;
      return Boolean(assignmentId && attemptId && ['review-evidence','complete'].includes(attestationCheckpoint) &&
        p?.assignment_requirement_id === assignmentId && p.attempt_id === attemptId &&
        p.checkpoint_id === attestationCheckpoint && p.outcome_id === 'reviewed' &&
        typeof p.idempotency_key === 'string' && Object.keys(p).every((key) =>
          ['assignment_requirement_id','attempt_id','checkpoint_id','outcome_id','idempotency_key'].includes(key)));
    }
    return !mobile && assignmentId && u.pathname === '/rest/v1/rpc/start_requirement' && body?.payload?.assignment_requirement_id === assignmentId;
  }
  return !mobile && method === 'POST' && u.origin === ORIGIN && u.pathname === '/api/learning/simulation-choice' &&
    body?.simulationId === target.simulationId && body?.assignmentRequirementId === assignmentId;
}

export async function run(env = process.env, vendor = false) {
  validateEnvironment(env); // Must run before network, browser creation or output directory creation.
  if (vendor) assert.equal(env.AUDIT_VENDOR_LEARNING_GO,'MAIN_GO_AFTER_VENDOR_SWEEP');
  const cases = vendor ? VENDOR_CASES.map((target) => ({...target, readOnly:target.protocol !== 'attestation'})) : CASES;
  const activeSimulations = vendor ? VENDOR_SIMULATIONS : simulations;
  const activeRules = vendor ? VENDOR_RULES : rules;
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium, expect: baseExpect } = require('@playwright/test');
  const expect = baseExpect.configure({ timeout: 30000 });
  const output = path.resolve('outputs/task-first-candidate', `${vendor ? 'vendor-' : ''}live-learning-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  const report = { candidate: env.AUDIT_EXPECTED_SHA, projectRef: PROJECT, actorKind: 'existing synthetic UAT learner; automated UI exercise',
    authorization: 'Explicit learning-only flow; main GO after read-only sweep', serviceWorkers: 'blocked to enforce request guard',
    businessWrites: false, resets: false, fabricatedCertification: false,
    reconciliation: 'Normal UI resolve/shared-completion/certification evaluation remains server-derived; no fabricated records', results: [] };
  const persist = () => writeFile(path.join(output, 'results.json'), JSON.stringify(report,null,2));
  const health = await fetch(`${ORIGIN}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert.equal(health.status, 200);
  const identity = await health.json();
  assert.equal(identity.commit, env.AUDIT_EXPECTED_SHA);
  assert.equal(identity.deployment?.appEnv, 'uat');
  assert.equal(identity.deployment?.supabaseProjectRef, PROJECT);
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false,true]) for (const target of cases) {
      const item = { ...target, viewport: mobile ? 'mobile-390' : 'desktop-1440', status: 'running', screenshots: [], blockedRequests: [] };
      report.results.push(item);
      const context = await browser.newContext({ viewport: mobile ? { width:390,height:844 } : { width:1440,height:900 },
        isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      let snapshot, assignmentId, signedInEmail, attestationCheckpoint;
      const pendingReads = [];
      const page = await context.newPage();
      await context.route('**/*', async (route) => {
        const request = route.request();
        let body;
        try { body = request.postDataJSON(); } catch { /* Non-JSON auth/static traffic is checked by path. */ }
        if (permittedRequest({ url: request.url(), method: request.method(), body, mobile, target, assignmentId,
          attemptId: progress()?.activeAttempt?.id, attestationCheckpoint })) return route.continue();
        item.blockedRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
        return route.abort('blockedbyclient');
      });
      page.on('response', (response) => {
        const u = new URL(response.url());
        if (u.origin === DB && ['/auth/v1/token','/auth/v1/user'].includes(u.pathname) && response.ok()) {
          pendingReads.push(response.json().then((data) => {
            const user = data.user ?? data;
            signedInEmail = user.email;
            item.authenticatedActorId = user.id;
          }).catch(() => {}));
        }
        if (u.origin === DB && ['/rest/v1/rpc/my_learning_snapshot','/rest/v1/rpc/resolve_assignments'].includes(u.pathname) && response.ok()) {
          pendingReads.push(response.json().then((data) => { snapshot = data; }).catch(() => {}));
        }
      });
      const progress = () => snapshot?.progress?.find((p) => p.requirementId === target.requirementId && p.requirementVersion === 1);
      const capture = async (label) => {
        assert.notEqual(new URL(page.url()).pathname, '/login');
        const file = `${target.role}-${target.simulationId}-${item.viewport}-${label}.png`;
        await page.screenshot({ path:path.join(output,file),fullPage:true,mask:[page.locator('input,textarea,[contenteditable="true"]')] });
        item.screenshots.push({ file,sha256:createHash('sha256').update(await readFile(path.join(output,file))).digest('hex') });
      };
      try {
        await page.goto(`${ORIGIN}/login?redirect=%2Fonboarding`, { waitUntil:'domcontentloaded' });
        await page.locator('#email').fill(target.email);
        await page.locator('#password').fill(env.AUDIT_PASSWORD);
        await page.getByRole('button',{name:/^sign in$/i}).click();
        await page.waitForURL((u) => u.pathname !== '/login');
        await expect.poll(() => signedInEmail).toBe(target.email);
        await page.goto(`${ORIGIN}${target.route ?? '/onboarding'}?requirement=${encodeURIComponent(target.requirementId)}`);
        await expect.poll(() => Boolean(progress())).toBe(true);
        assignmentId = progress().assignmentRequirementId;
        assert.ok(assignmentId);
        item.before = { state:progress().state,assignmentRequirementId:assignmentId,attemptCount:progress().attemptCount };
        if (target.readOnly) {
          assert.equal(progress().state,'passed','Practice must retain its existing server-derived completion');
          item.coverage = 'Pre-existing completion readback only; no fresh practice attempt or completion earned by this run';
          await capture('existing-practice-history');
        }
        if (!mobile && !target.readOnly) {
          assert.equal(progress().state,'not_started','Target must be fresh; do not reset or manufacture another attempt');
          const row = page.locator(`[id="onboarding-requirement-${encodeURIComponent(target.requirementId)}"]`);
          const simulation = activeSimulations.find((s) => s.id === target.simulationId);
          assert.equal(simulation.embeddedSteps.length,vendor ? 2 : 3);
          const rowStart = row.getByRole('button',{name:/^Start /});
          if (await rowStart.count()) await rowStart.click();
          else await page.getByRole('button',{name:`Start ${simulation.title}`,exact:true}).click();
          const dialog = page.getByRole('dialog');
          const first = simulation.embeddedSteps[0];
          await expect(dialog.getByRole('heading',{name:first.title,exact:true})).toBeVisible();
          await capture('started');
          if (target.protocol === 'attestation') {
            item.protocol = 'Learning attestation checkpoints only; no legal declaration or signature';
            for (const step of simulation.embeddedSteps) {
              await expect(dialog.getByRole('heading',{name:step.title,exact:true})).toBeVisible();
              attestationCheckpoint=step.checkpointId;
              await expect.poll(() => Boolean(progress()?.activeAttempt?.id)).toBe(true);
              const recorded = page.waitForResponse((r) => new URL(r.url()).pathname === '/rest/v1/rpc/record_simulation_checkpoint');
              await dialog.getByRole('button',{name:'Continue',exact:true}).click();
              assert.equal((await recorded).ok(),true);
              attestationCheckpoint=undefined;
            }
          } else {
          const wrong = first.choices.find((c) => c.id !== activeRules[`${simulation.id}:${first.checkpointId}`].acceptedChoiceId);
          const wrongResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/learning/simulation-choice');
          await dialog.getByRole('button',{name:wrong.label,exact:true}).click();
          const rejected = await (await wrongResponse).json();
          assert.equal(rejected.accepted,false);
          assert.equal(rejected.recorded,false);
          await expect(dialog.getByRole('alert')).toBeVisible();
          await expect(dialog.getByRole('heading',{name:first.title,exact:true})).toBeVisible();
          item.wrongChoiceDidNotAdvance = true;
          await capture('wrong-no-advance');
          for (const step of simulation.embeddedSteps) {
            await expect(dialog.getByRole('heading',{name:step.title,exact:true})).toBeVisible();
            const correct = step.choices.find((c) => c.id === activeRules[`${simulation.id}:${step.checkpointId}`].acceptedChoiceId);
            const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/learning/simulation-choice');
            await dialog.getByRole('button',{name:correct.label,exact:true}).click();
            assert.equal((await (await response).json()).accepted,true);
          }
          }
          await expect(dialog.getByRole('heading',{name:'Guided practice complete',exact:true})).toBeVisible();
          await capture('complete');
        }
        snapshot = undefined;
        await page.reload();
        await expect.poll(() => progress()?.state).toBe('passed');
        const row = page.locator(`[id="onboarding-requirement-${encodeURIComponent(target.requirementId)}"]`);
        await expect(row).toContainText(/complete|passed/i);
        await row.scrollIntoViewIfNeeded();
        await capture('completed-reload');
        item.after = { state:progress().state,assignmentRequirementId:progress().assignmentRequirementId,completedAt:progress().completedAt,
          attemptCount:progress().attemptCount,activeAttemptId:progress().activeAttempt?.id ?? null };
        assert.deepEqual(item.blockedRequests, [], 'Unexpected request attempted; inspect before continuing');
        item.status = 'passed';
      } catch (error) {
        item.status='failed';
        item.error=String(error.message).replaceAll(env.AUDIT_PASSWORD,'[REDACTED]').slice(0,3000);
        if (new URL(page.url()).pathname !== '/login') await capture('failure').catch(() => { item.captureFailed=true; });
        throw new Error('Learner-flow case failed; inspect redacted report. No retry/reset performed.');
      } finally {
        await Promise.all(pendingReads);
        await context.close();
        await persist();
      }
    }
  } finally { await browser.close(); await persist(); }
  return { output, cases:report.results.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
    process.stderr.write('Live learning flow stopped. Check environment/GO or the redacted results artifact.\n'); process.exitCode=1;
  });
}
