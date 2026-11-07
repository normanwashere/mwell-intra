import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { marked } from 'marked';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const workflow = name => yaml.load(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

// GitHub's context-availability table excludes runner/steps/env/job here,
// even though these expressions are syntactically valid YAML.
function assertJobEnvContexts(document) {
  const allowed = new Set(['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs']);
  for (const [id, job] of Object.entries(document.jobs)) {
    for (const [key, value] of Object.entries(job.env ?? {})) {
      for (const [, expression] of String(value).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const tokens = expression.replace(/'(?:''|[^'])*'/g, "''")
          .match(/[A-Za-z_][A-Za-z0-9_-]*|[^\s]/g) ?? [];
        for (let index = 0; index < tokens.length; index++) {
          const token = tokens[index];
          if (!/^[A-Za-z_]/.test(token) || tokens[index - 1] === '.' || tokens[index + 1] === '(' ||
              ['true', 'false', 'null'].includes(token)) continue;
          assert.ok(allowed.has(token), `jobs.${id}.env.${key}: unavailable context ${token}`);
        }
      }
    }
  }
}
const sha = 'a'.repeat(40);
const repository = 'example/intra';
const requiredJobs = [
  'Learning source checks (fast, non-authoritative)', 'Learning applied PostgreSQL release authority',
  'Knowledge Base contract', 'Typecheck (node 22)', 'Lint (node 22)', 'Test + coverage (node 22)',
  'Build shell (node 22)', 'Accessibility (axe + playwright)',
  ...[1, 2, 3].map(n => `E2E (playwright shard ${n}/3)`),
];
const successfulRun = () => ({ id: 10, run_number: 10, run_attempt: 1, head_sha: sha, head_branch: 'main',
  path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success',
  head_repository: { full_name: repository } });

async function gate({ event = 'workflow_dispatch', ref = 'refs/heads/main', runs = [successfulRun()],
  jobs = requiredJobs.map(name => ({ name, conclusion: 'success', status: 'completed', head_sha: sha })), apiError = false } = {}) {
  const step = workflow('deploy-vercel').jobs['verify-ci']?.steps.find(item => item.id === 'gate');
  assert.ok(step?.with?.script, 'deployment must have an executable same-commit gate');
  const outputs = {};
  const context = { eventName: event, ref, sha: event === 'workflow_run' ? 'b'.repeat(40) : sha, repo: { owner: 'example', repo: 'intra' },
    payload: event === 'workflow_run' ? { workflow_run: successfulRun() } : {} };
  const github = { rest: { actions: { listWorkflowRuns: Symbol('runs'), listJobsForWorkflowRun: Symbol('jobs') } },
    paginate: async (method, args) => {
      if (apiError) throw new Error('GitHub unavailable');
      assert.equal(args.owner, 'example'); assert.equal(args.repo, 'intra');
      if (method === github.rest.actions.listWorkflowRuns) {
        assert.equal(args.workflow_id, 'ci.yml'); assert.equal(args.head_sha, sha);
        assert.equal(args.branch, 'main');
        return runs;
      }
      assert.equal(method, github.rest.actions.listJobsForWorkflowRun);
      assert.equal(args.run_id, 10); assert.equal(args.filter, 'latest');
      return jobs;
    } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('github', 'context', 'core', step.with.script)(github, context, {
    setOutput: (name, value) => { outputs[name] = value; }, info: () => {},
  });
  return outputs;
}

test('CI covers current checkout branch without invoking live business certification', () => {
  const ci = workflow('ci');
  assert.ok(ci.on.push.branches.includes('codex/reporting-security-foundation'));
  assert.ok(ci.on.push.branches.includes('main'));
  assert.ok(Object.hasOwn(ci.on, 'workflow_dispatch'));
  assert.doesNotMatch(JSON.stringify(ci), /provision:test:uat|certify:onboarding-live|cleanup-uat-live-run|test:intra-live/);
  assert.doesNotMatch(JSON.stringify(ci), /secrets\.|SUPABASE_SERVICE_ROLE_KEY|UAT_AUDIT|SMTP/);
});

test('coverage browser installation is bounded without skipping tests or weakening release gates', () => {
  const ci = workflow('ci');
  assert.equal(ci.jobs.test['timeout-minutes'], 30);
  const install = ci.jobs.test.steps.find(step => step.name === 'Install Chromium for coverage browser contracts');
  assert.equal(install['timeout-minutes'], 10);
  assert.equal(install['continue-on-error'], undefined);
  assert.equal(install.run, 'pnpm --filter @intra/shell exec playwright install --with-deps chromium');
  assert.ok(ci.jobs.test.steps.some(step => step.name === 'Run tests with coverage'));
  assert.ok(ci.jobs.e2e.needs.includes('test'));
});

test('all three E2E shards retain coverage and reserve report upload time before the job deadline', () => {
  const e2e = workflow('ci').jobs.e2e;
  assert.deepEqual(e2e.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(e2e.strategy['fail-fast'], false);
  const run = e2e.steps.find(step => step.name === 'E2E memory');
  const controlled = e2e.steps.find(step => step.name === 'E2E controlled RPC');
  assert.ok(run && controlled, 'both runtimes must execute within each required shard gate');
  const upload = e2e.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.match(run.run, /set -o pipefail/);
  assert.match(run.run, /playwright test tests\/smoke tests\/e2e --config=playwright.ci.config.ts --shard=\$\{\{ matrix\.shard \}\}\/3 --global-timeout=2400000/);
  assert.doesNotMatch(run.run, /--grep|--max-failures|--retries=0|\|\| true/);
  assert.equal(run['continue-on-error'], undefined);
  assert.equal(run['timeout-minutes'], 43);
  assert.equal(run.env.PLAYWRIGHT_CI_RUNTIME, 'memory');
  assert.equal(controlled.env.PLAYWRIGHT_CI_RUNTIME, 'controlled');
  assert.equal(controlled.if, "${{ !cancelled() && steps.browser-ready.outcome == 'success' }}");
  assert.equal(controlled['continue-on-error'], undefined);
  assert.match(controlled.run, /--config=playwright.ci.config.ts --shard=\$\{\{ matrix\.shard \}\}\/3 --global-timeout=900000/);
  assert.doesNotMatch(controlled.run, /--grep|--max-failures|--retries=0|\|\| true/);
  assert.equal(controlled['timeout-minutes'], 18);
  assert.ok(e2e['timeout-minutes'] >= run['timeout-minutes'] + controlled['timeout-minutes'] + 20);
  assert.equal(upload.if, 'always()');
  assert.equal(upload['timeout-minutes'], 3);
  assert.match(upload.with.path, /playwright-report/);
  assert.match(run.run, /tee apps\/shell\/playwright-report\/memory-runner\.log/);
  assert.match(controlled.run, /tee apps\/shell\/playwright-report\/controlled-runner\.log/);
  const config = readFileSync(new URL('../../apps/shell/playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /\["json", \{ outputFile: "playwright-report\/results.json" \}\]/);
  assert.match(config, /\["html", \{ outputFolder: "playwright-report\/html", open: "never" \}\]/);
  assert.match(config, /retries: IS_CI \? 1 : 0/);
  assert.match(config, /workers: IS_CI \? 2 : undefined/);
});

test('E2E installs only its configured Chromium engine and proves launch before either runtime', () => {
  const steps = workflow('ci').jobs.e2e.steps;
  const install = steps.findIndex(step => step.name === 'Install Playwright browsers');
  const ready = steps.findIndex(step => step.id === 'browser-ready');
  const memory = steps.findIndex(step => step.name === 'E2E memory');
  assert.equal(steps[install].run, 'pnpm --filter @intra/shell exec playwright install --with-deps chromium');
  assert.ok(ready > install && memory > ready);
  assert.equal(steps[ready]['timeout-minutes'], 2);
  assert.equal(steps[ready]['continue-on-error'], undefined);
  assert.equal(steps[ready].if, undefined, 'failed installation must not proceed to launch');
  assert.match(steps[ready].run, /chromium\.launch\(\{ headless: true, timeout: 30000 \}\)/);
  assert.match(steps[ready].run, /finally \{ await browser\.close\(\); \}/);
  assert.match(steps[ready].run, /process\.exitCode = 1/);
  assert.doesNotMatch(steps[ready].run, /\|\| true/);
  const config = readFileSync(new URL('../../apps/shell/playwright.config.ts', import.meta.url), 'utf8');
  assert.equal((config.match(/devices\["Desktop Chrome"\]/g) ?? []).length, 3);
  assert.equal((config.match(/devices\["Pixel 7"\]/g) ?? []).length, 3);
  assert.doesNotMatch(config, /Desktop Firefox|Desktop Safari|browserName: ["'](?:firefox|webkit)/);
});

test('installed Playwright fails a suite budget and still emits its final JSON report', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mwell-playwright-budget-'));
  let primaryError;
  try {
    const reportPath = path.join(directory, 'results.json');
    writeFileSync(path.join(directory, 'budget.spec.cjs'), `
      const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
      test('held synthetic case', async () => { await new Promise(() => {}); });
    `);
    writeFileSync(path.join(directory, 'playwright.config.cjs'), `module.exports = ${JSON.stringify({
      testDir: directory, testMatch: 'budget.spec.cjs', workers: 1, retries: 0,
      outputDir: path.join(directory, 'test-results'),
      reporter: [['json', { outputFile: reportPath }]],
    })};`);
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
      '--config', path.join(directory, 'playwright.config.cjs'), '--global-timeout=3000'], {
      // A child/worker must not retain the directory we remove on Windows.
      // Absolute config, test and report paths keep the fixture isolated.
      cwd: fileURLToPath(new URL('../../apps/shell/', import.meta.url)), encoding: 'utf8', timeout: 20000,
      env: { ...process.env, CI: '1' }, windowsHide: true,
    });
    assert.equal(result.error, undefined, 'Playwright must exit itself, not need a runner kill');
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.ok(report.errors.some(error => /Timed out waiting.*test suite/i.test(error.message)), JSON.stringify(report.errors));
    assert.equal(report.stats.expected, 0, 'an interrupted run cannot report a passing case');
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error(`Budget fixture cleanup also failed; original assertion retained. Evidence: ${directory}`, cleanupError.message);
    }
  }
});

test('job env contexts reject valid-YAML runner expressions before runner allocation', () => {
  for (const name of ['ci', 'deploy-vercel', 'uat-live-certification']) assertJobEnvContexts(workflow(name));
  for (const expression of ['runner.temp', "runner['temp']", 'toJSON(runner)', 'steps.init.outputs.path', 'env.PATH', 'job.status']) {
    const mutated = workflow('ci');
    mutated.jobs['learning-applied-postgres'].env.SUPABASE_WORKDIR = '${{ ' + expression + ' }}';
    assert.throws(() => assertJobEnvContexts(mutated), /unavailable context/);
  }
  assertJobEnvContexts({ jobs: { example: { env: { VALUE:
    "${{ format('{0}/{1}', github.run_id, needs.prepare.outputs.path) }}-${{ matrix.node }}-${{ vars.PATH }}-${{ inputs.path }}-${{ secrets.KEY }}-${{ strategy.job-index }}" } } } });
});

test('deploy required names cover every actual CI job and matrix expansion', () => {
  const names = Object.values(workflow('ci').jobs).flatMap(job => {
    const matrix = job.strategy?.matrix;
    if (!matrix) return [job.name];
    const entries = Object.entries(matrix);
    assert.equal(entries.length, 1, 'extend this regression when adding another matrix axis');
    const [axis, values] = entries[0];
    return values.map(value => job.name.replace(new RegExp(`\\$\\{\\{\\s*matrix\\.${axis}\\s*\\}\\}`, 'g'), value));
  });
  assert.deepEqual(names.sort(), [...requiredJobs].sort());
  const sourceCi = workflow('ci');
  assert.deepEqual(sourceCi.permissions, { contents: 'read' });
  assert.ok(!JSON.stringify(sourceCi).includes('github/codeql-action'));
  const live = workflow('uat-live-certification');
  assert.equal(live.permissions['security-events'], 'write');
  assert.equal(live.permissions.actions, 'read');
  assert.equal(live.permissions.contents, 'read');
  assert.ok(live.jobs.prepare.steps.some(step => step.uses?.startsWith('github/codeql-action/init@')));
});

test('coverage provider is frozen with the same version as every Vitest workspace', () => {
  const version = require('vitest/package.json').version;
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.devDependencies['@vitest/coverage-v8'], version);
  const lock = yaml.load(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  assert.equal(lock.importers['.'].devDependencies['@vitest/coverage-v8'].specifier, version);
  assert.equal(lock.importers['.'].devDependencies['@vitest/coverage-v8'].version.split('(')[0], version);
  assert.equal(lock.importers['apps/shell'].devDependencies.vitest.version.split('(')[0], version);
  for (const [name, importer] of Object.entries(lock.importers)) {
    const vitest = importer.devDependencies?.vitest;
    if (vitest) assert.equal(vitest.version.split('(')[0], version, `${name} must match the shared coverage provider`);
  }
  const steps = workflow('ci').jobs.test.steps;
  assert.ok(steps.some(step => step.run === 'pnpm install --frozen-lockfile'));
  assert.ok(!steps.some(step => /pnpm add|COVERAGE_PKG/.test(step.run ?? '')), 'coverage job must not mutate the manifest or lockfile');
});

test('service-worker privacy acceptance is mandatory after Chromium installation in safe CI', () => {
  const steps = workflow('ci').jobs.axe.steps;
  const install = steps.findIndex(step => step.name === 'Install Playwright browsers');
  const privacy = steps.findIndex(step => step.run === 'node --test scripts/qa/service-worker-privacy.mjs');
  assert.ok(install >= 0 && privacy > install);
  assert.match(steps[install].run, /pnpm --filter @intra\/shell exec playwright install --with-deps chromium/);
  assert.equal(steps[privacy].if, undefined);
  assert.equal(steps[privacy]['continue-on-error'], undefined);
});

test('authenticated export SQL authority is mandatory in required CI', () => {
  const steps = workflow('ci').jobs.lint.steps;
  const step = steps.find(item => item.run === 'node --test scripts/verify-warehouse-export-authority.pglite.test.mjs');
  assert.ok(step, 'execute the actual authenticated SQL and Storage RLS regressions');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
});

test('serialized transfer and lot-aware putaway SQL regressions are mandatory in required CI', () => {
  const job = workflow('ci').jobs.lint;
  const step = job.steps.find(item => item.run === 'node --test --test-concurrency=1 scripts/verify-serialized-transfer-authority.pglite.test.mjs scripts/verify-lot-aware-putaway.pglite.test.mjs');
  assert.ok(step, 'run both actual SQL suites, including production repository payloads');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.env.QA_TRANSFER_BASELINE, '0');
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
});

test('QC-to-putaway conversion provenance is mandatory in required CI', () => {
  const job = workflow('ci').jobs.lint;
  const step = job.steps.find(item => item.run === 'node --test scripts/verify-stock-conversion-putaway.pglite.test.mjs');
  assert.ok(step, 'run the real SQL and production repository payload regressions');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
});

test('applied PostgreSQL executes verified canonical baseline and complete forward source without bypass', () => {
  const job = workflow('ci').jobs['learning-applied-postgres'];
  const steps = job.steps;
  const initialize = steps.findIndex(step => step.name === 'Initialize isolated PostgreSQL workdir');
  const prepare = steps.findIndex(step => step.name === 'Verify and prepare canonical empty baseline');
  const start = steps.findIndex(step => step.name === 'Start disposable local PostgreSQL');
  const reset = steps.findIndex(step => step.name === 'Execute canonical baseline and complete forward source');
  const authority = steps.findIndex(step => step.name === 'Verify applied learning authority');
  assert.ok(initialize >= 0 && initialize < prepare && prepare < start && start < reset && reset < authority);
  assert.equal(job.env.SUPABASE_WORKDIR, undefined);
  assert.match(steps[initialize].run, /\$RUNNER_TEMP\/mwell-learning-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT/);
  assert.match(steps[initialize].run, />> "\$GITHUB_ENV"/);
  assert.equal(job.env.MWELL_LOCAL_DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  assert.match(steps[prepare].run, /node --test scripts\/qa\/prepare-learning-postgres.test.mjs/);
  assert.match(steps[prepare].run, /node scripts\/qa\/prepare-learning-postgres.mjs --output "\$SUPABASE_WORKDIR"/);
  assert.match(steps[reset].run, /db reset --local --no-seed --workdir "\$SUPABASE_WORKDIR"/);
  for (const index of [initialize, prepare, start, reset, authority]) {
    assert.equal(steps[index].if, undefined);
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  for (const step of steps.filter(step => /pnpm exec supabase (?:start|stop|db reset)/.test(step.run ?? ''))) {
    assert.match(step.run, /--workdir "\$SUPABASE_WORKDIR"/);
    assert.doesNotMatch(step.run, /--linked|--db-url|--ignore-health-check|\|\|\s*true|--version/);
  }
  assert.equal(steps.find(step => step.name === 'Remove disposable local PostgreSQL').if, 'always()');
  assert.ok(workflow('ci').jobs.e2e.needs.includes('learning-applied-postgres'));
});

test('PostgreSQL cleanup is inert before initialization or config creation and stops only its owned project', () => {
  const job = workflow('ci').jobs['learning-applied-postgres'];
  const cleanup = job.steps.find(step => step.name === 'Remove disposable local PostgreSQL');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const run = prefix => {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-u', '-c',
      `pnpm() { printf 'CALLED'; printf '<%s>' "$@"; }\n${prefix}\n${cleanup.run}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  assert.equal(run('unset SUPABASE_WORKDIR'), '');
  assert.equal(run('SUPABASE_WORKDIR=""'), '');
  assert.equal(run('SUPABASE_WORKDIR="/nonexistent-qa4-workdir"'), '');
  const output = run('owned=$(mktemp -d)\ntrap \'rm -- "$owned/supabase/config.toml"; rmdir -- "$owned/supabase" "$owned"\' EXIT\nmkdir "$owned/supabase"\ntouch "$owned/supabase/config.toml"\nSUPABASE_WORKDIR="$owned"');
  assert.match(output, /^CALLED<exec><supabase><stop><--no-backup><--workdir><\/.*>$/);
});

test('coverage bounds workspace and Vitest concurrency without weakening tests or coverage', () => {
  const ci = workflow('ci');
  const step = ci.jobs.test.steps.find(item => item.name === 'Run tests with coverage');
  const args = step.run.replace(/\\\r?\n/g, ' ').trim().split(/\s+/);
  const separator = args.indexOf('--');
  assert.ok(separator > 0);
  assert.ok(args.slice(0, separator).includes('--concurrency=2'), 'Turbo must bound concurrent workspace tasks');
  assert.ok(args.slice(separator + 1).includes('--maxWorkers=1'), 'Vitest must bound workers inside each workspace');
  assert.ok(args.includes('--coverage'));
  assert.ok(args.includes('--coverage.provider=v8'));
  assert.doesNotMatch(step.run, /testTimeout|--retry|--exclude|--testNamePattern|--passWithNoTests/);
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(ci.env.COVERAGE_MIN, '50');
  assert.ok(ci.jobs.test.steps.some(item => item.run === 'node .github/workflows/scripts/verify_coverage.mjs'));
});

test('coverage installs the shell-pinned Chromium before mandatory browser contracts', () => {
  const steps = workflow('ci').jobs.test.steps;
  const dependencies = steps.findIndex(item => item.run === 'pnpm install --frozen-lockfile');
  const install = steps.findIndex(item => item.run === 'pnpm --filter @intra/shell exec playwright install --with-deps chromium');
  const coverage = steps.findIndex(item => item.name === 'Run tests with coverage');
  assert.ok(install > dependencies && install < coverage, 'the isolated coverage runner needs its own matching Chromium');
  assert.equal(steps[install].if, undefined);
  assert.equal(steps[install]['continue-on-error'], undefined);
  const source = readFileSync(new URL('../../modules/legal/src/localStore.upload.test.ts', import.meta.url), 'utf8');
  assert.match(source, /createRequire\(new URL\('\.\.\/\.\.\/\.\.\/apps\/shell\/package\.json'/);
  assert.match(source, /require\('@playwright\/test'\)/);
});

test('deploy waits for CI and checks out the verified source SHA, never workflow_run default-branch SHA', () => {
  const deploy = workflow('deploy-vercel');
  assert.equal(deploy.on.push, undefined);
  assert.deepEqual(deploy.on.workflow_run, { workflows: ['CI'], types: ['completed'], branches: ['main'] });
  assert.equal(deploy.permissions.actions, 'read');
  assert.equal(deploy.jobs.deploy.needs, 'verify-ci');
  assert.equal(deploy.jobs.deploy.steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref, '${{ needs.verify-ci.outputs.source_sha }}');
  assert.equal(deploy.jobs['verify-ci']['continue-on-error'], undefined);
  assert.equal(deploy.jobs.deploy.if, undefined, 'failed CI gate must not be bypassed with always()');
});

for (const event of ['workflow_dispatch', 'workflow_run']) {
  test(`${event} accepts only a same-repository successful CI with all required jobs`, async () => {
    assert.equal((await gate({ event })).source_sha, sha);
  });
}

for (const [label, change] of [
  ['different SHA', run => { run.head_sha = 'b'.repeat(40); }],
  ['different repository', run => { run.head_repository.full_name = 'fork/intra'; }],
  ['wrong workflow', run => { run.path = '.github/workflows/other.yml'; }],
  ['PR merge checks', run => { run.event = 'pull_request'; }],
  ['different branch', run => { run.head_branch = 'feature'; }],
  ['failure', run => { run.conclusion = 'failure'; }],
  ['unfinished', run => { run.status = 'in_progress'; run.conclusion = null; }],
]) {
  test(`manual deployment rejects ${label}`, async () => {
    const run = successfulRun(); change(run);
    await assert.rejects(gate({ runs: [run] }));
  });
}

test('manual deployment rejects missing CI, a newer failure, and GitHub API failure', async () => {
  await assert.rejects(gate({ runs: [] }));
  await assert.rejects(gate({ runs: [{ ...successfulRun(), id: 11, run_number: 11, conclusion: 'failure' }, successfulRun()] }));
  await assert.rejects(gate({ apiError: true }));
  await assert.rejects(gate({ ref: 'refs/heads/codex/reporting-security-foundation' }));
});

test('missing, skipped, failed or wrong-SHA required jobs cannot be replaced by overall success', async () => {
  for (const name of requiredJobs) {
    const jobs = requiredJobs.filter(item => item !== name).map(name => ({ name, status: 'completed', conclusion: 'success', head_sha: sha }));
    await assert.rejects(gate({ jobs }));
    for (const patch of [{ conclusion: 'skipped' }, { conclusion: 'failure' }, { head_sha: 'b'.repeat(40) }]) {
      await assert.rejects(gate({ jobs: [...jobs, { name, status: 'completed', conclusion: 'success', head_sha: sha, ...patch }] }));
    }
  }
});

test('live mutations require manual consent while preserving the original separate SMTP opt-in', () => {
  const live = workflow('uat-live-certification');
  assert.equal(live.on.push, undefined, 'push must not provision or change training');
  assert.equal(live.on.workflow_dispatch.inputs.run_mutating_certification.default, false);
  for (const id of ['prepare', 'bundle']) {
    assert.match(live.jobs[id].if, /github.event_name == 'workflow_dispatch'/);
    assert.match(live.jobs[id].if, /inputs.run_mutating_certification/);
    assert.doesNotMatch(live.jobs[id].if, /certify_vendor_email_delivery/);
  }
  assert.equal(live.on.workflow_dispatch.inputs.certify_vendor_email_delivery.default, false);
  assert.equal(live.jobs.transactions.env.AUDIT_REQUIRE_VENDOR_DELIVERY,
    "${{ github.event_name == 'workflow_dispatch' && inputs.certify_vendor_email_delivery && matrix.viewport == 'desktop-1440' }}");
  assert.equal(live.jobs.routes.needs, 'prepare');
  assert.match(live.jobs.transactions.if, /needs.prepare.result == 'success'/);
  assert.match(live.jobs.cleanup.if, /needs.prepare.result == 'success'/);
});

test('legacy certification stays paused before user provisioning, even with manual consent', () => {
  const live = workflow('uat-live-certification');
  for (const id of ['prepare', 'bundle']) {
    assert.match(live.jobs[id].if, /^\$\{\{ false && /,
      `${id} must remain disabled until the whole legacy suite has safe cleanup`);
  }
  const notice = live.jobs['mutation-pause'];
  assert.ok(notice, 'A paused run must explain the block, not appear certified');
  assert.deepEqual(notice.permissions, {});
  assert.equal(notice.environment, undefined);
  assert.equal(notice.env, undefined);
  assert.equal(notice.needs, undefined);
  assert.equal(notice.steps.length, 1);
  assert.match(notice.steps[0].run, /exit 1/);
  assert.match(notice.steps[0].run, /WMS Fixture Safety/);
  assert.doesNotMatch(notice.steps[0].run, /secrets\.|pnpm|node|curl|fetch|checkout/);
});

test('both release bundles preserve the documentation tree and current linked handoff sources', async () => {
  const { bundleReleaseDocumentation } = await import('./bundle-release-documentation.mjs');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const destination = mkdtempSync(path.join(tmpdir(), 'qa4-documentation-bundle-'));
  try {
    bundleReleaseDocumentation({ root, destination });
    for (const name of ['deploy-vercel', 'uat-live-certification']) {
      const job = workflow(name).jobs[name === 'deploy-vercel' ? 'deploy' : 'bundle'];
      assert.ok(job.steps.some(step => /node scripts\/qa\/bundle-release-documentation\.mjs --output /.test(step.run ?? '')));
      assert.ok(!job.steps.some(step => /cp docs\/manual\/index\.html/.test(step.run ?? '')));
    }
    const entries = [
      'manual/MWELL_INTRA_USER_MANUAL.md', 'handoffs/current/README.md', 'handoffs/current/data.md',
      'handoffs/current/technical.md', 'handoffs/current/testers.md',
      'integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md',
    ];
    const targets = new Set();
    const visited = new Set();
    for (const entry of entries) {
      if (visited.has(entry)) continue;
      visited.add(entry);
      marked.walkTokens(marked.lexer(readFileSync(path.join(destination, entry), 'utf8')), token => {
        if (token.type !== 'link' || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(token.href)) return;
        const target = path.resolve(destination, path.dirname(entry), decodeURIComponent(token.href.split(/[?#]/)[0]));
        // Repository source-code links are not documentation payloads. Keep
        // checking every linked document, including transitive historical ones.
        if (!target.startsWith(destination + path.sep) && /\.(?:[cm]?[jt]sx?|sql|ya?ml)$/.test(target)) return;
        assert.ok(target.startsWith(destination + path.sep), `link escapes artifact: ${entry} -> ${token.href}`);
        assert.ok(existsSync(target), `missing packaged target: ${entry} -> ${token.href}`);
        const relative = path.relative(destination, target).replaceAll(path.sep, '/');
        targets.add(relative);
        if (relative.endsWith('.md') && !visited.has(relative)) entries.push(relative);
      });
    }
    for (const required of ['handoffs/current/release-status.json', 'handoffs/2026-09-22/release-status.json',
      'integrations/reporting-api/RELEASE-READINESS.md', 'superpowers/specs/2026-09-20-reporting-api-design.md',
      'superpowers/plans/2026-09-20-reporting-api-implementation.md']) assert.ok(targets.has(required), required);
    assert.deepEqual(readFileSync(path.join(destination, 'handoffs/current/release-status.json')),
      readFileSync(path.join(root, 'docs/handoffs/current/release-status.json')), 'bundling must not advance deployment or acceptance claims');
    const html = readFileSync(path.join(destination, 'manual/index.html'), 'utf8');
    const hrefs = [...html.matchAll(/href="([^"]*handoffs\/current\/release-status\.json)"/g)];
    assert.ok(hrefs.length >= 5);
    for (const [, href] of hrefs) assert.equal(path.resolve(destination, 'manual', href), path.join(destination, 'handoffs/current/release-status.json'));
    assert.match(readFileSync(path.join(destination, 'MWELL_INTRA_COMPLETE_DOCUMENTATION.html'), 'utf8'), /manual\/index\.html/);
    assert.match(readFileSync(path.join(destination, 'MWELL_INTRA_USER_MANUAL.md'), 'utf8'), /manual\/MWELL_INTRA_USER_MANUAL\.md/);
    assert.match(readFileSync(path.join(destination, 'manual/USER_TRAINING_AND_OPERATIONS_MANUAL.md'), 'utf8'), /\.\.\/USER_TRAINING_AND_OPERATIONS_MANUAL\.md/);
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});
