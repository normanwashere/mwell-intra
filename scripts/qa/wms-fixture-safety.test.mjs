import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createRepresentativeFixturePlan } from './wms-fixture-postgres-adapter.mjs';

const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const yaml = createRequire(require.resolve('eslint'))('js-yaml');
const workflowPath = new URL('../../.github/workflows/wms-fixture-safety.yml', import.meta.url);
const sha = 'b'.repeat(40);
function workflow() {
  assert.ok(existsSync(workflowPath), 'Dedicated non-provisioning safety workflow must exist');
  return yaml.load(readFileSync(workflowPath, 'utf8'));
}
const steps = document => document.jobs.safety.steps;
const step = (document, id) => steps(document).find(item => item.id === id);

function assertIsolation(document) {
  assert.deepEqual(Object.keys(document.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(document.on.workflow_dispatch, {});
  assert.deepEqual(document.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(document.jobs), ['safety']);
  const job = document.jobs.safety;
  assert.equal(job.permissions, undefined);
  assert.equal(job.environment, undefined);
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(document.concurrency['cancel-in-progress'], false);
  for (const item of steps(document)) assert.equal(item['continue-on-error'], undefined);
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /secrets\s*\.|vars\s*\.|inputs\s*\.|SUPABASE_SERVICE_ROLE|AUDIT_PASSWORD|POLICY_ALLOW_TEST_MUTATIONS/i);
  assert.doesNotMatch(text, /provision:test|certify:onboarding|test:intra-live|uat-live-certification|SMTP|auth\.admin|learning\.resolve_assignments/i);
  assert.doesNotMatch(text, /supabase (?:db push|link)|curl\s|wget\s|fetch\s*\(|https?\.request\s*\(|\|\| true/);
  assert.ok(steps(document).filter(item => item.uses?.startsWith('actions/checkout@')).every(item => item.with?.['persist-credentials'] === false));
}

test('dedicated workflow cannot provision, call live backends or inherit credentials', () => assertIsolation(workflow()));

test('safety workflow runs on the isolated publication branch under its advertised name', () => {
  const document = workflow();
  assert.equal(document.name, 'WMS Fixture Safety (disposable only)');
  assert.deepEqual(document.on.push.branches, ['main', 'codex/reporting-security-foundation', 'codex/warehouse-cleanup-20261107']);
});

function assertJobBudget(document) {
  const job = document.jobs.safety;
  const setupMarginMinutes = 5;
  const setupActions = ['actions/checkout@v5', 'pnpm/action-setup@v6', 'actions/setup-node@v5'];
  let boundedMinutes = 0;
  for (const item of steps(document)) {
    const minutes = item['timeout-minutes'];
    if (minutes === undefined && (item.id === 'provenance' || setupActions.includes(item.uses))) continue;
    assert.ok(Number.isInteger(minutes) && minutes > 0, `${item.id} needs a positive bounded timeout`);
    boundedMinutes += minutes;
  }
  assert.ok(Number.isInteger(job['timeout-minutes']));
  assert.ok(boundedMinutes + setupMarginMinutes <= job['timeout-minutes'],
    `Job must reserve ${boundedMinutes} bounded-step minutes plus ${setupMarginMinutes} setup minutes`);
}

test('job budget includes every bounded step, cleanup and five minutes of setup margin', () => assertJobBudget(workflow()));

for (const [name, mutate] of [
  ['old 65-minute job limit', d => { d.jobs.safety['timeout-minutes'] = 65; }],
  ['inner budget consuming setup margin', d => { step(d, 'replay')['timeout-minutes'] += 1; }],
  ['unbounded cleanup', d => { delete step(d, 'replay-cleanup')['timeout-minutes']; }],
]) test(`budget contract rejects ${name}`, () => {
  const document = workflow(); mutate(document); assert.throws(() => assertJobBudget(document));
});

for (const [name, mutate] of [
  ['secret injection', d => { d.jobs.safety.env = { PASSWORD: '${{ secrets.UAT_PASSWORD }}' }; }],
  ['job permission escalation', d => { d.jobs.safety.permissions = { contents: 'write' }; }],
  ['UAT environment', d => { d.jobs.safety.environment = 'uat'; }],
  ['live workflow dispatch', d => { steps(d).push({ run: 'gh workflow run uat-live-certification.yml' }); }],
  ['onboarding', d => { steps(d).push({ run: 'pnpm certify:onboarding-live' }); }],
  ['live HTTP request', d => { steps(d).push({ run: 'curl https://example.invalid/rest/v1/products' }); }],
  ['soft failure', d => { step(d, 'native')['continue-on-error'] = true; }],
  ['operator override input', d => { d.on.workflow_dispatch = { inputs: { database_url: { type: 'string' } } }; }],
]) test(`isolation contract rejects ${name}`, () => {
  const document = workflow(); mutate(document); assert.throws(() => assertIsolation(document));
});

test('required offline suites execute serially with propagated exit status', () => {
  const document = workflow(); const run = step(document, 'contracts');
  assert.equal(run.if, undefined);
  assert.equal(run['timeout-minutes'], 10);
  assert.match(run.run, /set -euo pipefail/);
  for (const file of ['wms-fixture-safety.test.mjs', 'wms-live-fixture-guard.test.mjs',
    'wms-fixture-lifecycle.test.mjs', 'wms-fixture-postgres-adapter.test.mjs', 'wms-fixture-postgres-adapter.cli.test.mjs',
    'wms-fixture-postgres-adapter.guard.test.mjs', 'wms-fixture-migration-replay.test.mjs', 'wms-fixture-migration-replay.native.test.mjs',
    'wms-fixture-reporting-audit.test.mjs']) {
    assert.ok(run.run.includes(`scripts/qa/${file}`), `${file} is mandatory`);
  }
  assert.match(run.run, /node --test --test-concurrency=1/);
  assert.ok(run.run.includes('scripts/verify-uat-archive-active-reads.pglite.test.mjs'), 'Archive predecessor compatibility must be tested');
  assert.doesNotMatch(run.run, /--test-name-pattern|--test-skip-pattern|test -[ef]|continue-on-error|exit 0/);
  assert.equal(step(document, 'install').run, 'pnpm install --frozen-lockfile');
});

test('native proof uses only an owned PostgreSQL 17 service and fails absent prerequisites', () => {
  const document = workflow(); const job = document.jobs.safety;
  assert.deepEqual(Object.keys(job.services), ['fixture-postgres']);
  const service = job.services['fixture-postgres'];
  assert.equal(service.image, 'postgres:17.6-alpine');
  assert.deepEqual(service.ports, ['127.0.0.1:54329:5432']);
  assert.equal(service.env.POSTGRES_INITDB_ARGS, '--set=cluster_name=wms_fixture_safety');
  const native = step(document, 'native');
  assert.equal(native.if, undefined); assert.equal(native['timeout-minutes'], 10);
  assert.match(native.run, /runNativeFixtureProof/);
  assert.match(native.run, /postgresql:\/\/postgres:wms-fixture-disposable-only@127\.0\.0\.1:54329\/postgres/);
  assert.match(native.run, /server_version_num/); assert.match(native.run, /cluster_name/);
  assert.match(native.run, /remainingFixtureDatabases/); assert.match(native.run, /assert\.equal\(remainingFixtureDatabases, 0\)/);
  assert.match(native.run, /result\.deaths\.length, 2/); assert.match(native.run, /result\.liveCalls, false/);
  assert.match(native.run, /process\.exitCode = 1/);
  assert.doesNotMatch(native.run, /process\.env\.(?:DATABASE|PG|SUPABASE)|\.cli\.mjs|skip|console\.error\((?:error|e)\)/);
});

test('full migration replay and post-schema proof are mandatory and bind a reviewed inventory', () => {
  const document = workflow(), replay = step(document, 'replay');
  assert.ok(replay, 'Full replay is required, not a future optional step');
  assert.equal(replay.if, undefined); assert.equal(replay['continue-on-error'], undefined);
  assert.match(replay.run, /const reviewedDigest = '[0-9a-f]{64}'/);
  assert.match(replay.run, /20261106173133_wms_fixture_postgres_lifecycle\.sql/);
  assert.match(replay.run, /20261107041749_wms_fixture_registered_writer_fence\.sql/);
  assert.match(replay.run, /expectedDigest: reviewedDigest/);
  assert.doesNotMatch(replay.run, /expectedDigest: (?:inventory|inspectReplay)|\.native\.mjs|TEST_DRIVER_PASS|execute:/);
  for (const condition of ["result.status, 'PASS'", "result.evidenceKind, 'supabase-cli-native'",
    'result.fullNativeChainPassed, true', 'result.schemaAssertionsPassed, true', 'result.closed, true']) assert.ok(replay.run.includes(condition), condition);
  assert.match(replay.run, /prepared\.candidateCommit, process\.env\.GITHUB_SHA/);
  const cleanup = step(document, 'replay-cleanup');
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /receipt\.workspace, workspace/);
  assert.match(cleanup.run, /receipt\.sourceCommit, process\.env\.GITHUB_SHA/);
  assert.match(cleanup.run, /configSha256/);
  assert.match(cleanup.run, /stop', '--no-backup', '--workdir', workspace/);
  assert.match(cleanup.run, /safeEnvironment/);
  assert.doesNotMatch(cleanup.run, /--linked|--all|\|\| true/);
});

test('artifacts are explicit audited copies; failure evidence does not turn failure into success', () => {
  const document = workflow(); const audit = step(document, 'evidence-audit'); const upload = step(document, 'upload');
  assert.equal(audit.if, 'always()');
  assert.equal(audit.env.NATIVE_OUTCOME, '${{ steps.native.outcome }}');
  assert.equal(audit.env.CONTRACTS_OUTCOME, '${{ steps.contracts.outcome }}');
  assert.equal(upload.if, "${{ always() && steps.evidence-audit.outcome == 'success' }}");
  assert.equal(upload.with.path, 'test-results/wms-fixture-safety/publish');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['include-hidden-files'], false);
  assert.equal(upload.with['retention-days'], 7);
  assert.match(upload.with.name, /github\.sha.*github\.run_id.*github\.run_attempt/);
  assert.equal(step(document, 'stop').if, 'always()');
  assert.match(step(document, 'stop').run, /docker stop --time 10/);
  assert.equal(step(document, 'stop').env.FIXTURE_CONTAINER, '${{ job.services.fixture-postgres.id }}');
});

function inlineNode(id) {
  const run = step(workflow(), id).run;
  const match = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE\s*$/.exec(run);
  assert.ok(match, `${id} must be an executable inline Node script`);
  return match[1];
}

async function runNativeStep({ version = 170006, cluster = 'wms_fixture_safety', unavailable = false, residue = 0, proofFails = false } = {}) {
  const writes = [], calls = [], stderr = [];
  const process = { env: { GITHUB_SHA: sha }, stderr: { write: value => stderr.push(value) }, exitCode: undefined };
  class Client {
    constructor(options) { assert.equal(options.connectionString, 'postgresql://postgres:wms-fixture-disposable-only@127.0.0.1:54329/postgres'); }
    async connect() { if (unavailable) throw Error('connection failed'); }
    async query(sql) {
      calls.push(sql);
      if (sql === 'show server_version_num') return { rows: [{ server_version_num: String(version) }] };
      if (sql === 'show cluster_name') return { rows: [{ cluster_name: cluster }] };
      if (sql.includes('from pg_database')) return { rows: [{ n: residue }] };
      return { rows: [{ n: 0 }] };
    }
    async end() { calls.push('closed'); }
  }
  const runNativeFixtureProof = async input => {
    assert.equal(input.outputDir, 'test-results/wms-fixture-safety/native');
    if (proofFails) throw Error('native assertion failed');
    return { kind: 'native-disposable-postgresql', liveCalls: false, passed: 11,
      checks: Array.from({ length: 11 }, (_, i) => `check-${i}`), deaths: [{ residue: 0, recoveryAttempts: 2 }, { residue: 0, recoveryAttempts: 2 }] };
  };
  const body = inlineNode('native').replace(/^import .*;\n/gm, '');
  assert.doesNotMatch(body, /\bimport\b/);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('assert', 'Client', 'runNativeFixtureProof', 'writeFileSync', 'process', body)(
    assert, Client, runNativeFixtureProof, (file, data) => writes.push({ file, data: JSON.parse(data) }), process);
  return { code: process.exitCode, writes, calls, stderr };
}

test('native workflow body records checked candidate only after owned cleanup proof', async () => {
  const result = await runNativeStep();
  assert.equal(result.code, undefined); assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].data.sourceCommit, sha);
  assert.equal(result.writes[0].data.remainingFixtureDatabases, 0);
  assert.equal(result.calls.at(-1), 'closed');
});

async function cleanupFixture({ alter = () => {}, stopStatus = 0 } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wms-safety-cleanup-')));
  const workspace = join(root, 'wms-replay-12345-2'), file = `${workspace}.receipt.json`;
  mkdirSync(join(workspace, 'supabase'), { recursive: true }); mkdirSync(join(workspace, 'home'));
  const project = `wms-replay-${'f'.repeat(32)}`, config = `project_id = "${project}"\n`;
  writeFileSync(join(workspace, 'supabase/config.toml'), config);
  const receipt = { workspace, project, sourceCommit: sha, configSha256: createHash('sha256').update(config).digest('hex') };
  const calls = [], stderr = [];
  const isolatedProcess = { env: { GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2', RUNNER_TEMP: root, GITHUB_SHA: sha, REPLAY_OUTCOME: 'success' },
    execPath: process.execPath, stderr: { write: text => stderr.push(text) }, exitCode: undefined };
  try {
    alter({ receipt, workspace }); writeFileSync(file, JSON.stringify(receipt));
    const body = inlineNode('replay-cleanup').replace(/^import .*;\n/gm, '');
    const names = ['assert', 'createHash', 'spawnSync', 'copyFileSync', 'existsSync', 'lstatSync', 'mkdirSync', 'readFileSync', 'realpathSync', 'writeFileSync', 'join', 'resolve', 'safeEnvironment', 'process'];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(...names, body)(assert, createHash,
      (executable, args, options) => { calls.push({ executable, args, options }); return { status: stopStatus }; },
      copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, join,
      (...parts) => resolve(root, ...parts), home => ({ HOME: home, CI: 'true' }), isolatedProcess);
    return { code: isolatedProcess.exitCode, calls, stderr, workspace,
      summary: existsSync(join(root, 'test-results/wms-fixture-safety/replay/replay-cleanup.json')) };
  } finally {
    assert.ok(root.startsWith(realpathSync(tmpdir()) + '\\') || root.startsWith(realpathSync(tmpdir()) + '/'));
    rmSync(root, { recursive: true, force: true });
  }
}

test('always cleanup invokes only the receipted owned project with an isolated environment', async () => {
  const result = await cleanupFixture();
  assert.equal(result.code, undefined); assert.equal(result.summary, true); assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].args.slice(1), ['stop', '--no-backup', '--workdir', result.workspace]);
  assert.deepEqual(Object.keys(result.calls[0].options.env), ['HOME', 'CI']);
});

for (const [name, alter] of [
  ['wrong candidate', ({ receipt }) => { receipt.sourceCommit = 'c'.repeat(40); }],
  ['wrong workspace', ({ receipt }) => { receipt.workspace += '-foreign'; }],
  ['changed config', ({ workspace }) => writeFileSync(join(workspace, 'supabase/config.toml'), 'project_id = "other"')],
  ['linked project', ({ workspace }) => { mkdirSync(join(workspace, 'supabase/.temp')); writeFileSync(join(workspace, 'supabase/.temp/project-ref'), 'not-local'); }],
]) test(`always cleanup rejects ${name} before invoking the CLI`, async () => {
  const result = await cleanupFixture({ alter });
  assert.equal(result.code, 1); assert.deepEqual(result.calls, []); assert.equal(result.summary, false);
});

test('failed owned cleanup never writes a successful cleanup summary', async () => {
  const result = await cleanupFixture({ stopStatus: 1 });
  assert.equal(result.code, 1); assert.equal(result.summary, false);
});

for (const [name, options] of [
  ['database unavailable', { unavailable: true }], ['wrong PostgreSQL major', { version: 160006 }],
  ['wrong cluster', { cluster: 'not-our-service' }], ['native assertion failure', { proofFails: true }],
  ['residual owned database', { residue: 1 }],
]) test(`native workflow body fails closed on ${name}`, async () => {
  const result = await runNativeStep(options);
  assert.equal(result.code, 1); assert.deepEqual(result.writes, []);
  assert.equal(result.calls.at(-1), 'closed');
  assert.doesNotMatch(result.stderr.join(''), /postgresql:\/\/|wms-fixture-disposable-only/);
});

function auditFixture({ native = 'failure', contracts = 'failure', replay = 'failure', cleanup = 'failure', populate = () => {} } = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'wms-safety-artifact-'));
  const root = join(temporaryRoot, 'test-results/wms-fixture-safety');
  mkdirSync(join(root, 'native'), { recursive: true });
  writeFileSync(join(root, 'source.json'), JSON.stringify({ commit: sha, scope: 'disposable-only', liveAuthorization: false }));
  writeFileSync(join(root, 'contracts.tap'), 'TAP version 13\nnot ok 1 - deliberate failure\n');
  try {
    mkdirSync(join(temporaryRoot, 'scripts/qa'), { recursive: true });
    writeFileSync(join(temporaryRoot, 'scripts/qa/wms-fixture-lifecycle.mjs'), readFileSync(new URL('./wms-fixture-lifecycle.mjs', import.meta.url)));
    populate(root);
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      input: inlineNode('evidence-audit'), cwd: temporaryRoot, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, GITHUB_WORKSPACE: temporaryRoot, GITHUB_SHA: sha, NATIVE_OUTCOME: native, CONTRACTS_OUTCOME: contracts,
        REPLAY_OUTCOME: replay, REPLAY_CLEANUP_OUTCOME: cleanup },
    });
    const publication = join(root, 'publish');
    const published = existsSync(publication) ? readdirSync(publication, { recursive: true }) : [];
    return { ...result, published, journal: existsSync(join(publication, 'native/qa_wms_fixture_abc-death.jsonl'))
      ? readFileSync(join(publication, 'native/qa_wms_fixture_abc-death.jsonl'), 'utf8') : null };
  } finally {
    assert.ok(resolve(temporaryRoot).startsWith(resolve(tmpdir()) + '\\') || resolve(temporaryRoot).startsWith(resolve(tmpdir()) + '/'));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('failed native run retains safe incomplete journals byte-for-byte without a pass claim', () => {
  const journal = '{"type":"intent","operationId":"fixture-only"}\n{"partial":';
  const result = auditFixture({ populate: root => writeFileSync(join(root, 'native/qa_wms_fixture_abc-death.jsonl'), journal) });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.journal, journal);
  assert.ok(result.published.includes('source.json')); assert.ok(result.published.includes('contracts.tap'));
});

test('successful prerequisites without native result or journals fail publication', () => {
  const result = auditFixture({ native: 'success', contracts: 'success' });
  assert.notEqual(result.status, 0); assert.deepEqual(result.published, []);
});

test('successful local evidence publishes original hash-validated journals and source identity', () => {
  const result = auditFixture({ native: 'success', contracts: 'success', populate: root => {
    const plan = createRepresentativeFixturePlan({ sourceCommit: sha });
    const entry = { sequence: 0, previousHash: null, type: 'manifest', data: plan };
    const journal = JSON.stringify({ ...entry, hash: createHash('sha256').update(JSON.stringify(entry)).digest('hex') }) + '\n';
    for (const suffix of ['before-commit', 'after-commit']) writeFileSync(join(root, `native/qa_wms_fixture_abc-${suffix}.jsonl`), journal);
    writeFileSync(join(root, 'native-results.json'), JSON.stringify({ sourceCommit: sha, kind: 'native-disposable-postgresql', liveCalls: false,
      remainingFixtureDatabases: 0, passed: 11, checks: Array.from({ length: 11 }, (_, i) => `check-${i}`), deaths: [{}, {}] }));
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.published.includes('native-results.json')); assert.ok(result.published.includes('artifact-index.json'));
});

function replayEvidence(root, change = () => {}) {
  const result = { status: 'PASS', evidenceKind: 'supabase-cli-native', candidateCommit: sha,
    inventoryDigest: 'd'.repeat(64), fullNativeChainPassed: true, schemaAssertionsPassed: true, closed: true };
  change(result); mkdirSync(join(root, 'replay'));
  for (const [file, value] of [
    ['replay-result.json', result], ['replay-inventory.json', { candidateCommit: sha, inventory: { digest: 'd'.repeat(64) } }],
    ['replay-cleanup.json', { sourceCommit: sha, ownedProjectStopped: true }],
  ]) writeFileSync(join(root, 'replay', file), JSON.stringify(value));
}

test('replay publication requires real native status, schema assertions, owned cleanup and same candidate', () => {
  const ok = auditFixture({ replay: 'success', cleanup: 'success', populate: root => replayEvidence(root) });
  assert.equal(ok.status, 0, ok.stderr);
  for (const change of [r => { r.evidenceKind = 'test-double'; }, r => { r.fullNativeChainPassed = false; },
    r => { r.schemaAssertionsPassed = false; }, r => { r.closed = false; }, r => { r.candidateCommit = 'c'.repeat(40); }]) {
    const rejected = auditFixture({ replay: 'success', cleanup: 'success', populate: root => replayEvidence(root, change) });
    assert.notEqual(rejected.status, 0); assert.deepEqual(rejected.published, []);
  }
});

test('missing replay evidence and failed final cleanup cannot publish a success', () => {
  assert.notEqual(auditFixture({ replay: 'success', cleanup: 'success' }).status, 0);
  assert.notEqual(auditFixture({ replay: 'success', cleanup: 'failure', populate: root => replayEvidence(root) }).status, 0);
});

test('private replay command logs and SQL never enter artifacts, including on failure', () => {
  for (const name of ['step-0-start.log', 'schema-assertions.sql']) {
    const result = auditFixture({ populate: root => {
      mkdirSync(join(root, 'replay')); writeFileSync(join(root, 'replay', name), 'private command output');
    } });
    assert.notEqual(result.status, 0); assert.deepEqual(result.published, []);
  }
});

for (const [name, file, content] of [
  ['connection URL', 'native/qa_wms_fixture_abc-death.jsonl', '{"url":"postgresql://postgres:never-publish@127.0.0.1/postgres"}'],
  ['authorization token', 'contracts.tap', 'authorization: Bearer do-not-publish'],
  ['password field', 'native-results.json', '{"password":"do-not-publish"}'],
  ['client secret field', 'native-results.json', '{"client_secret":"do-not-publish"}'],
  ['camel-case service key', 'native-results.json', '{"serviceRoleKey":"do-not-publish"}'],
  ['camel-case access token', 'native-results.json', '{"accessToken":"do-not-publish"}'],
  ['private key', 'contracts.tap', '-----BEGIN PRIVATE KEY-----'],
  ['unknown file', '.env', 'local-only'],
]) test(`artifact audit blocks ${name} without echoing its content`, () => {
  const result = auditFixture({ populate: root => writeFileSync(join(root, file), content) });
  assert.notEqual(result.status, 0); assert.deepEqual(result.published, []);
  assert.doesNotMatch(result.stdout + result.stderr, /never-publish|do-not-publish/);
});

test('artifact audit rejects wrong source identity', () => {
  const result = auditFixture({ populate: root => writeFileSync(join(root, 'source.json'), JSON.stringify({ commit: 'c'.repeat(40) })) });
  assert.notEqual(result.status, 0); assert.deepEqual(result.published, []);
});
