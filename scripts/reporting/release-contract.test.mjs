import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const workflow = () => yaml.load(readFileSync(new URL('../../.github/workflows/uat-live-certification.yml', import.meta.url), 'utf8'));

function assertReportingGates(document) {
  const job = document.jobs.prepare;
  const steps = job.steps;
  const audit = steps.filter(step => step.name === 'Block known build and test tooling vulnerabilities');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].run, 'pnpm audit --audit-level moderate');
  const native = steps.filter(step => step.name === 'Verify private reporting authority on disposable PostgreSQL');
  assert.equal(native.length, 1);
  assert.equal(native[0].run, 'node --test scripts/reporting/verify-authority.postgres.test.mjs');
  assert.equal(native[0].env.SEP22_DOA_EPHEMERAL_CI, '1');
  assert.equal(native[0].env.SEP22_DOA_CI_DATABASE_URL, 'postgresql://postgres:sep22-ci-disposable-only@127.0.0.1:5432/postgres');
  assert.equal(job.services['doa-postgres'].image, 'postgres:17-alpine');
  for (const step of [...audit, ...native]) {
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
    assert(steps.indexOf(step) < steps.findIndex(item => item.name === 'Reconcile guarded UAT personas'));
  }
}

test('reporting release requires tooling and real PostgreSQL gates before live mutations', () => {
  assertReportingGates(workflow());
});

test('removing, skipping or ignoring a reporting gate is rejected', () => {
  for (const name of ['Block known build and test tooling vulnerabilities', 'Verify private reporting authority on disposable PostgreSQL']) {
    for (const mutate of [
      document => { document.jobs.prepare.steps = document.jobs.prepare.steps.filter(step => step.name !== name); },
      document => { document.jobs.prepare.steps.find(step => step.name === name).if = 'false'; },
      document => { document.jobs.prepare.steps.find(step => step.name === name)['continue-on-error'] = true; },
    ]) {
      const document = workflow();
      mutate(document);
      assert.throws(() => assertReportingGates(document));
    }
  }
});

test('Vercel deploy installation uses the reviewed lockfile', () => {
  const config = JSON.parse(readFileSync(new URL('../../apps/shell/vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.installCommand, 'cd ../.. && pnpm install --frozen-lockfile');
});

test('source-copy and deployment runners agree on the tested Node version', () => {
  assert.equal(readFileSync(new URL('../../.node-version', import.meta.url), 'utf8').trim(), '24');
  const deploy = yaml.load(readFileSync(new URL('../../.github/workflows/deploy-vercel.yml', import.meta.url), 'utf8'));
  assert.equal(deploy.jobs.deploy.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'], '24');
  assert.equal(workflow().jobs.prepare.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'], '24');
});

test('shared UI Node-based tests declare their own types for a clean checkout', () => {
  const ui = JSON.parse(readFileSync(new URL('../../packages/ui/package.json', import.meta.url), 'utf8'));
  const core = JSON.parse(readFileSync(new URL('../../packages/core-data/package.json', import.meta.url), 'utf8'));
  assert.equal(ui.devDependencies['@types/node'], core.devDependencies['@types/node']);
  assert(ui.devDependencies['@types/node'], 'UI tests must not borrow Node types from an ancestor checkout');
});

function assertEarlyDocumentationGate(document) {
  const steps = document.jobs.prepare.steps;
  const matches = steps.filter(step => step.name === 'Verify release documentation is synchronized');
  assert.equal(matches.length, 1);
  const [gate] = matches;
  assert.equal(gate.run.trim(), 'node scripts/qa/verify-release-documentation.mjs --manifest test-results/documentation-sync-source.json\npnpm verify:app-documentation-html');
  assert.equal(gate.if, undefined);
  assert.equal(gate['continue-on-error'], undefined);
  assert(steps.indexOf(gate) > steps.findIndex(step => step.name === 'Install locked dependencies'));
  for (const name of ['Lint all workspaces', 'Run unit and contract tests', 'Build all workspaces', 'Reconcile guarded UAT personas']) {
    assert(steps.indexOf(gate) < steps.findIndex(step => step.name === name), `Documentation must be checked before ${name}`);
  }
}

test('documentation drift fails before long tests, builds or live mutations', () => {
  assertEarlyDocumentationGate(workflow());
});

test('documentation gate cannot be skipped, weakened, removed or delayed', () => {
  for (const mutate of [
    steps => steps.filter(step => step.name !== 'Verify release documentation is synchronized'),
    steps => { steps.find(step => step.name === 'Verify release documentation is synchronized').if = 'false'; return steps; },
    steps => { steps.find(step => step.name === 'Verify release documentation is synchronized')['continue-on-error'] = true; return steps; },
    steps => { steps.find(step => step.name === 'Verify release documentation is synchronized').run = 'echo passed'; return steps; },
    steps => [...steps.filter(step => step.name !== 'Verify release documentation is synchronized'), steps.find(step => step.name === 'Verify release documentation is synchronized')],
  ]) {
    const document = workflow();
    document.jobs.prepare.steps = mutate(document.jobs.prepare.steps);
    assert.throws(() => assertEarlyDocumentationGate(document));
  }
});
