import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { seedUatWmsScenarios } from './seed-uat-wms-scenarios.mjs';

const ts = createRequire(import.meta.url)('typescript');
const guardName = 'assertWmsLiveFixtureCleanupReady';
const guardUrl = new URL('./wms-live-fixture-guard.mjs', import.meta.url);
const paused = { code: 'WMS_LIVE_FIXTURES_PAUSED' };
function source(ref) {
  const text = readFileSync(new URL(ref, import.meta.url), 'utf8');
  return ts.createSourceFile(ref, text, ts.ScriptTarget.Latest, true);
}
function nodes(tree, predicate) {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  return found;
}
function guardCall(tree) {
  const imports = nodes(tree, n => ts.isImportDeclaration(n)
    && n.moduleSpecifier.text.endsWith('/wms-live-fixture-guard.mjs'));
  assert.equal(imports.length, 1, 'Runner must import the shared pause, not a local override');
  const calls = nodes(tree, n => ts.isCallExpression(n) && n.expression.getText(tree) === guardName);
  assert.equal(calls.length, 1, 'Exactly one explicit entrypoint pause is required');
  assert(ts.isExpressionStatement(calls[0].parent), 'Pause cannot be swallowed in a boolean expression');
  return calls[0];
}

test('shared pause rejects live mutations, missing/invalid intent and caller readiness claims', async () => {
  assert(existsSync(guardUrl), 'Shared fail-closed WMS fixture guard is missing');
  const { assertWmsLiveFixtureCleanupReady: guard } = await import(guardUrl.href);
  assert.throws(() => guard(), paused);
  for (const input of [true, undefined, null, 0, '', 'false', 'local', {},
    { cleanupReady: true, archived: true, residuals: 0 },
    { APP_ENV: 'local', AUDIT_MUTATIONS: 'true', WMS_ALLOW_UNCLEAN_FIXTURES: 'true' }]) {
    assert.throws(() => guard(input), paused);
  }
  assert.doesNotThrow(() => guard(false), 'Explicit read-only callers remain available');
  assert.doesNotMatch(readFileSync(guardUrl, 'utf8'), /process\.env|process\.argv|fetch\(|import /,
    'Pause must be pure, with no environment/CLI bypass or side effects');
});

for (const [file, fn, prior] of [
  ['wms-ecommerce-signoff-live.mjs', 'run', 3],
  ['wms-returns-signoff-live.mjs', 'run', 3],
  ['wms-replenishment-signoff-live.mjs', 'run', 3],
  ['seed-uat-wms-scenarios.mjs', 'seedUatWmsScenarios', 0],
]) test(`${file}: unconditional pause before any live work or execution lock`, () => {
  const tree = source(`./${file}`);
  const call = guardCall(tree);
  const body = nodes(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === fn)[0].body;
  assert.equal(body.statements.indexOf(call.parent), prior);
  assert.equal(call.arguments.length, 0, 'Mutating runner cannot pass read-only intent');
  if (prior) {
    assert.equal(body.statements[prior - 1].expression.expression.getText(tree), 'assertRunPermission');
    assert.doesNotMatch(body.statements.slice(0, prior).map(n => n.getText(tree)).join('\n'),
      /fetch\(|health\(|mkdir\(|open\(|createClient\(|launch\(/);
  }
});

for (const [file, branch] of [
  ['wms-department-signoff-live.mjs', "command === 'run'"],
  ['sep20-event-live.mjs', 'else'],
  ['sep21-event-products.mjs', 'entrypoint'],
]) test(`${file}: live branch begins with pause; offline preparation stays outside`, () => {
  const tree = source(`./${file}`);
  const call = guardCall(tree);
  assert.equal(call.arguments.length, 0);
  const block = call.parent.parent;
  assert(ts.isBlock(block));
  assert.equal(block.statements[0], call.parent);
  const condition = block.parent;
  assert(ts.isIfStatement(condition));
  if (branch === 'else') assert.equal(condition.elseStatement, block);
  else if (branch === 'entrypoint') assert.match(condition.expression.getText(tree), /import\.meta\.url===pathToFileURL/);
  else assert.equal(condition.expression.getText(tree), branch);
});

test('recipient evidence continuation pauses before loading runtime, credentials or artifacts', () => {
  const tree = source('./wms-recipient-evidence-live.mjs');
  const call = guardCall(tree);
  assert.equal(call.arguments.length, 0);
  assert.equal(tree.statements.filter(n => !ts.isImportDeclaration(n))[0], call.parent);
});

test('governed transactions pause before clients/network; routes and read-only phases remain available', async () => {
  const tree = source('./full-intra-live-e2e.mjs');
  const call = guardCall(tree);
  assert.equal(call.arguments.length, 1);
  assert.equal(call.arguments[0].getText(tree), 'mutatingPhase');
  const position = tree.statements.indexOf(call.parent);
  assert(position > 0);
  assert.equal(tree.statements[position - 1].getText(tree), 'const mutatingPhase = allowMutations && runTransactionAudit;');
  assert.equal(nodes(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'runTransactionAudit')[0]
    .initializer.getText(tree), "['all', 'transactions'].includes(auditPhase)");
  const { assertWmsLiveFixtureCleanupReady: guard } = await import(guardUrl.href);
  const check = new Function(guardName, 'allowMutations', 'auditPhase',
    `const runTransactionAudit = ['all', 'transactions'].includes(auditPhase);\n${tree.statements[position - 1].getText(tree)}\n${call.parent.getText(tree)}`);
  for (const phase of ['all', 'transactions', 'routes', 'critical']) {
    assert.doesNotThrow(() => check(guard, false, phase));
    if (['all', 'transactions'].includes(phase)) assert.throws(() => check(guard, true, phase), paused);
    else assert.doesNotThrow(() => check(guard, true, phase));
  }
});

test('legacy receiving draft write pauses at test start without disabling its read-only sibling cases', () => {
  const tree = source('../../apps/shell/tests/e2e/aug27-wms-feedback-live.spec.ts');
  const call = guardCall(tree);
  assert.equal(call.arguments.length, 0);
  const body = call.parent.parent;
  assert(ts.isBlock(body) && ts.isArrowFunction(body.parent));
  assert.equal(body.statements[0], call.parent);
  const registration = body.parent.parent;
  assert.equal(registration.expression.getText(tree), 'test');
  assert.match(registration.arguments[0].text, /^Operations receiving:/);
});

test('scenario seed refuses before even injected actor lookup or writes', async () => {
  const calls = [];
  await assert.rejects(seedUatWmsScenarios({
    url: 'https://uatref.supabase.co', serviceKey: 'offline-fixture-only', appEnv: 'uat',
    expectedProjectRef: 'uatref', productionProjectRef: 'prodref', mutationsApproved: true,
    fetchImpl: async (...args) => { calls.push(args); throw new Error('Offline tripwire: no requests permitted'); },
    log: () => { throw new Error('Must not report seeded fixtures'); },
  }), paused);
  assert.deepEqual(calls, []);
});

for (const [file, runKey] of [
  ['wms-ecommerce-signoff-live.mjs', 'WMS_ECOMMERCE_RUN_ID'],
  ['wms-returns-signoff-live.mjs', 'WMS_RETURNS_RUN_ID'],
]) test(`${file}: fully permitted prepared fixture still stops before fetch and lock creation`, async t => {
  const api = await import(new URL(`./${file}`, import.meta.url).href);
  const root = await mkdtemp(path.join(tmpdir(), 'wms-pause-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'prepared');
  const manifest = await api.prepare(folder, { commit: 'a'.repeat(40), orderDate: '2026-11-06' });
  const before = await readdir(folder);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Offline tripwire: no requests permitted'); };
  try {
    await assert.rejects(api.run(folder, { APP_ENV: 'uat', AUDIT_MUTATIONS: 'true',
      AUDIT_PASSWORD: 'offline-fixture-only', [runKey]: manifest.runId }), paused);
  } finally { globalThis.fetch = previous; }
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(folder), before, 'No attempt/lock/evidence claiming execution may be created');
});

test('referenced standalone inbound runner remains absent, not silently counted as guarded coverage', () => {
  assert.equal(existsSync(new URL('./wms-inbound-signoff-live.mjs', import.meta.url)), false,
    'New inbound runner requires entrypoint pause wiring and a dedicated regression before use');
});

for (const [file, builder, options] of [
  ['wms-ecommerce-signoff-live.mjs', 'prepareSql', 'manifest'],
  ['wms-returns-signoff-live.mjs', 'prepareSql', 'manifest'],
  ['render-uat-wms-scenarios-sql.mjs', 'renderUatWmsScenarioSql', undefined],
  ['render-uat-sep07-merch-sql.mjs', 'renderSep07MerchSql', { projectRef: 'kkoitlvydytdhlpxhuah', mode: 'apply' }],
  ['render-uat-sep08-merch-sql.mjs', 'renderSep08MerchSql', { projectRef: 'kkoitlvydytdhlpxhuah', mode: 'apply' }],
]) test(`${file}: offline SQL carries a no-live-apply notice without disabling local rendering`, async () => {
  const api = await import(new URL(`./${file}`, import.meta.url).href);
  const input = options === 'manifest' ? api.createManifest({ commit: 'a'.repeat(40), orderDate: '2026-11-06' }) : options;
  const sql = api[builder](input);
  assert.match(sql.slice(0, 500), /LIVE MUTATIONS PAUSED: DO NOT APPLY/);
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
});

test('department/replenishment preparation notices never direct an operator to apply the seed', () => {
  for (const file of ['wms-department-signoff-live.mjs', 'wms-replenishment-signoff-live.mjs']) {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.match(text, /LIVE MUTATIONS PAUSED: DO NOT APPLY/);
    assert.doesNotMatch(text, /next: 'Review and apply prepare\.sql/);
    assert.match(text, /liveMutationsPaused: true/);
  }
});

test('shell TypeScript resolves the shared MJS guard with a strict declaration', () => {
  const entry = fileURLToPath(new URL('../../apps/shell/tests/e2e/__wms_guard_typecheck__.mts', import.meta.url));
  const text = `import { assertWmsLiveFixtureCleanupReady } from '../../../../scripts/qa/wms-live-fixture-guard.mjs';
assertWmsLiveFixtureCleanupReady();
assertWmsLiveFixtureCleanupReady(false);
// @ts-expect-error A truthy string must not become read-only intent.
assertWmsLiveFixtureCleanupReady('false');`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...args) => path.resolve(file) === entry
    ? ts.createSourceFile(file, text, languageVersion, true) : original(file, languageVersion, ...args);
  const program = ts.createProgram([entry], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
