import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
export const SCENARIO_IDS = [
  'warehouse-quality-inspection-review-v1',
  'procurement-payment-readiness-review-v1',
  'warehouse-putaway-review-v1',
  'warehouse-pick-pack-review-v1',
];

// Exact user-authorized deployment only; never accept a project-wide hostname pattern.
export const CANDIDATES = new Map([
  ['https://mwell-intra-o22mhp238-normans-projects-d718ecb1.vercel.app', '06c9b80bc6c09c343800756ebcadc0efdb88619f'],
]);
export function assertCandidate(origin, sha) {
  assert.equal(CANDIDATES.get(origin), sha, 'Exact protected candidate URL/SHA is not authorized');
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
}

export function requestDisposition(method, url, origin) {
  const parsed = new URL(url);
  if (parsed.origin !== origin) return 'block';
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read' : 'block';
}

// Mirrors LearningSnapshot / RequirementProgress, not a start or completion response.
export function scenarioSnapshot(simulation, variant = 'valid') {
  const requirement = {
    id: `simulated.${simulation.id}`, version: 1, audience: 'internal', kind: 'scenario',
    title: simulation.title, mandatory: true, prerequisiteIds: [],
    capabilityOutcomes: structuredClone(simulation.capabilityOutcomes), simulationId: simulation.id,
  };
  if (variant === 'audience') requirement.audience = 'vendor';
  if (variant === 'version') requirement.version = 999;
  if (variant === 'unknown') requirement.simulationId = 'unregistered-runtime-negative-v1';
  if (variant === 'kind') requirement.kind = 'attestation';
  const time = '2026-09-07T00:00:00.000Z';
  return {
    curricula: [{ source: 'assignment', curriculum: {
      id: `simulated.curriculum.${simulation.id}`, version: 1, personaId: 'operations_associate',
      audience: requirement.audience, requirementIds: [requirement.id],
    }, requirements: [requirement] }],
    progress: [{ assignmentRequirementId: '00000000-0000-4000-8000-000000000001',
      requirementId: requirement.id, requirementVersion: requirement.version, state: 'not_started',
      attemptCount: 0, allowsSharedCompletion: false, updatedAt: time }],
    certifications: [], lockedCapabilities: [], refreshedAt: time,
  };
}

async function localRun() {
  assert.equal(process.argv.includes('--local'), true, 'Only --local is prepared; candidate execution is not authorized yet');
  const { build } = require('esbuild');
  const { chromium, expect } = require('@playwright/test');
  const output = path.join(root, 'outputs/scoped-training-runtime-fixture', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(output, { recursive: true });
  const report = { simulated: true, mode: 'local-real-component-fixture', startedAt: new Date().toISOString(),
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    liveDbCertification: false, launch: 'unexecuted: persistence required; never synthesize start success',
    scope: 'First checkpoint rendering only; component mounted directly, no authenticated launch or completion',
    cases: [], blockedRequests: [], browserClosed: false, serverClosed: false };
  // Bundle the actual runtime and resolver. No surrogate training markup or answer evaluator.
  const entry = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {OnboardingTrainingSession} from './modules/learning/src/OnboardingTrainingSession';
    import {LEARNING_CATALOG, simulationForRequirement} from './modules/learning/src/catalog';
    import {SupabaseLearningRepository} from './modules/learning/src/repository';
    window.simulations = LEARNING_CATALOG.simulations;
    window.resolveRequirement = r => Boolean(simulationForRequirement(r));
    window.parseFixture = async snapshot => {
      const repo = new SupabaseLearningRepository({schema:()=>({rpc: async name => {
        if(name !== 'my_learning_snapshot') throw new Error('SIMULATED: persistence blocked: '+name);
        return {data:snapshot,error:null};
      }})});
      return await repo.snapshot();
    };
    const root=createRoot(document.getElementById('root'));
    window.mountScenario = simulation => root.render(React.createElement(OnboardingTrainingSession, {
      key:simulation.id, requirementTitle:simulation.title, scenarioId:simulation.id,
      assignmentRequirementId:'simulated-only', attemptId:'simulated-only',
      onCheckpoint:async()=>{throw new Error('SIMULATED: persistence blocked');},
      onEvaluateChoice:async()=>{throw new Error('SIMULATED: persistence blocked');}, onClose:()=>root.render(null)
    }));
  `;
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'scoped-runtime-fixture.tsx', loader: 'tsx' },
    bundle: true, write: false, outdir: 'fixture', platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) },
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); }
    else if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><p>SIMULATED LOCAL COMPONENT: no authentication, launch or completion proof. Utility theme not bundled.</p><section data-onboarding-anchor="onboarding-required-steps">Scenario fixture</section><div id="root"></div><script src="/fixture.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch();
    for (const view of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport: view, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const request = route.request();
        if (requestDisposition(request.method(), request.url(), origin) === 'block') {
          report.blockedRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      try {
        for (const id of SCENARIO_IDS) {
          const page = await context.newPage();
          const result = { id, width: view.width, simulated: true, controls: [], status: 'failed' };
          report.cases.push(result);
          try {
            await page.goto(origin);
            await page.waitForFunction(() => Boolean(window.simulations));
            const simulation = await page.evaluate(id => window.simulations.find(s => s.id === id), id);
            assert.ok(simulation, `Actual runtime catalog missing ${id}`);
            for (const variant of ['valid', 'audience', 'version', 'unknown', 'kind']) {
              const fixture = scenarioSnapshot(simulation, variant);
              const parsed = await page.evaluate(value => window.parseFixture(value), fixture);
              assert.deepEqual(JSON.parse(JSON.stringify(parsed)), fixture, 'Fixture JSON must survive the actual repository parser');
              const supported = await page.evaluate(r => window.resolveRequirement(r), fixture.curricula[0].requirements[0]);
              result.controls.push({ variant, supported, expectedSupported: variant === 'version' ? null : variant === 'valid',
                status: variant === 'version' ? 'observation:requirement and simulation versions are independent by contract; not a defect'
                  : supported === (variant === 'valid') ? 'passed' : 'failed' });
            }
            await page.evaluate(s => window.mountScenario(s), simulation);
            const step = simulation.embeddedSteps[0];
            await expect(page.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
            await expect(page.getByText(step.instruction, { exact: true })).toBeVisible();
            await expect(page.getByText(step.question, { exact: true })).toBeVisible();
            for (const choice of step.choices) await expect(page.getByText(choice.label, { exact: true })).toBeVisible();
            const file = `${id}-${view.width}-simulated.png`;
            const png = await page.screenshot({ path: path.join(output, file) });
            result.image = { file, sha256: createHash('sha256').update(png).digest('hex'), capturedAt: new Date().toISOString(), width: view.width, height: view.height };
            result.dom = await page.locator('body').innerText();
            result.rendering = 'passed:first checkpoint';
            // Deliberately reject every evaluation. No accepted choice, progress or terminal state is synthesized.
            await page.getByText(step.choices[0].label, { exact: true }).click();
            await expect(page.getByText('SIMULATED: persistence blocked', { exact: true })).toBeVisible();
            await expect(page.getByRole('heading', { name: step.title, exact: true })).toBeVisible();
            result.persistenceBoundary = 'blocked; first checkpoint retained';
            result.status = result.controls.some(control => control.status === 'failed') ? 'failed' : 'passed';
          } catch (error) { result.error = String(error.message); }
          finally { await page.close(); result.pageClosed = true; }
        }
      } finally { await context.close(); }
    }
  } finally {
    if (browser) { await browser.close(); report.browserClosed = true; }
    await new Promise(resolve => server.close(resolve)); report.serverClosed = true;
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, finishedAt: report.finishedAt, cases: report.cases.length,
      passed: report.cases.filter(item => item.status === 'passed').length, browserClosed: report.browserClosed, serverClosed: report.serverClosed }));
  }
  if (report.cases.length !== 8 || report.cases.some(item => item.status !== 'passed')) process.exitCode = 1;
}

async function protectedRun() {
  const origin = process.env.AUDIT_BASE_URL;
  const sha = process.env.AUDIT_EXPECTED_SHA;
  assertCandidate(origin, sha);
  assert.equal(process.env.AUDIT_MUTATIONS, 'false');
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const password = process.env.AUDIT_PASSWORD;
  assert.ok(secret && password, 'Environment-only credentials required');
  const projectOrigin = 'https://kkoitlvydytdhlpxhuah.supabase.co';
  const headers = { 'x-vercel-protection-bypass': secret };
  const health = await fetch(`${origin}/api/health`, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(health.status, 200);
  const identity = await health.json();
  assert.equal(identity.commit, sha);
  assert.equal(identity.deployment?.appEnv, 'uat');
  assert.equal(identity.deployment?.supabaseProjectRef, 'kkoitlvydytdhlpxhuah');
  const { build } = require('esbuild');
  const compiled = await build({ stdin: { contents: `export {SCOPED_READINESS_CANDIDATES} from './modules/learning/src/scopedReadinessCandidates'; export {OPS_CUSTODY_CANDIDATES} from './modules/learning/src/opsCustodyCandidates';`, resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  const definitions = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const simulations = [...definitions.SCOPED_READINESS_CANDIDATES, ...definitions.OPS_CUSTODY_CANDIDATES];
  assert.deepEqual(simulations.map(s => s.id), SCENARIO_IDS);
  const { CURRENT_LIVE_ROLES } = await import('./live-e2e-scenarios.mjs');
  const actor = CURRENT_LIVE_ROLES.find(actor => actor.role === 'operations_associate');
  const { chromium, expect } = require('@playwright/test');
  const output = path.join(root, 'outputs/scoped-training-runtime-fixture', `protected-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(output, { recursive: true });
  const report = { simulated: true, sourceSha: sha, origin, identityVerified: true, startedAt: new Date().toISOString(),
    liveDbCertification: false, cases: [], blockedRequests: [], browserClosed: false,
    limitation: 'Synthetic assignment snapshots only. No start response fabricated. Runtime rendering unexecuted when start requires persistence. Actor scope is unchanged; this is not a role/grant certification.' };
  const browser = await chromium.launch();
  const redact = message => String(message).replaceAll(secret, '[REDACTED]').replaceAll(password, '[REDACTED]');
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      let fixture = scenarioSnapshot(simulations[0]);
      let authenticated = false;
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === projectOrigin && ['/rest/v1/rpc/my_learning_snapshot', '/rest/v1/rpc/resolve_assignments'].includes(url.pathname)) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
        }
        // Only the explicitly authorized authentication handshake may POST upstream.
        const auth = !authenticated && url.origin === projectOrigin && url.pathname === '/auth/v1/token' && request.method() === 'POST';
        const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && [origin, projectOrigin].includes(url.origin);
        if (!auth && !read) {
          report.blockedRequests.push({ method: request.method(), path: url.pathname });
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'SIMULATED: persistence blocked', code: 'FIXTURE_WRITE_BLOCKED' }) });
        }
        return route.continue({ headers: url.origin === origin ? { ...request.headers(), ...headers } : request.headers() });
      });
      try {
        await context.request.get(`${origin}/login`, { headers: { ...headers, 'x-vercel-set-bypass-cookie': 'true' }, maxRedirects: 0 });
        const cookieCheck = await context.request.get(`${origin}/login`, { maxRedirects: 0 });
        assert.equal(cookieCheck.status(), 200, 'Bypass cookie preflight failed');
        const page = await context.newPage();
        await page.goto(`${origin}/login`);
        await page.locator('#email').fill(actor.email);
        await page.locator('#password').fill(password);
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL(url => url.pathname !== '/login', { timeout: 30000 });
        authenticated = true;
        for (const simulation of simulations) {
          for (const variant of ['valid', 'audience', 'version', 'unknown', 'kind']) {
            fixture = scenarioSnapshot(simulation, variant);
            const result = { id: simulation.id, variant, width: viewport.width, simulated: true, runtimeRendering: 'unexecuted', status: 'failed' };
            report.cases.push(result);
            try {
              await page.goto(`${origin}/onboarding`, { waitUntil: 'domcontentloaded' });
              await expect(page.getByRole('heading', { name: 'Role onboarding', exact: true })).toBeVisible({ timeout: 30000 });
              const button = page.getByRole('button', { name: `Start ${simulation.title}`, exact: true }).first();
              const available = await button.isVisible() && await button.isEnabled();
              result.launchAvailable = available;
              if (available) {
                const before = report.blockedRequests.length;
                await button.click();
                await expect.poll(() => report.blockedRequests.slice(before).some(r => r.path.endsWith('/start_requirement')), { timeout: 10000 }).toBe(true);
                result.launch = 'blocked:persistence required';
                result.status = variant === 'version' ? 'observation:independent versions; not a defect' : variant === 'valid' ? 'blocked' : 'failed';
              } else {
                result.launch = 'unavailable';
                result.status = variant === 'version' ? 'observation:independent versions; not a defect' : variant === 'valid' ? 'failed' : 'passed';
              }
              result.dom = (await page.locator('main').innerText()).replaceAll(actor.email, '[REDACTED]');
              const file = `${simulation.id}-${variant}-${viewport.width}-SIMULATED.png`;
              const png = await page.screenshot({ path: path.join(output, file), mask: [page.locator('input[type="password"]')] });
              result.image = { file, sha256: createHash('sha256').update(png).digest('hex'), capturedAt: new Date().toISOString() };
            } catch (error) { result.error = redact(error.message); }
          }
        }
      } finally { await context.close(); }
    }
  } catch (error) { report.error = redact(error.message); }
  finally {
    await browser.close(); report.browserClosed = true; report.contextsClosed = true;
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, cases: report.cases.length, finishedAt: report.finishedAt, browserClosed: true }));
  }
  if (report.error || report.cases.some(c => c.status !== 'passed')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--protected')) await protectedRun();
  else await localRun();
}
