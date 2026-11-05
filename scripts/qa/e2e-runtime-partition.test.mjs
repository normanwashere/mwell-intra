import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const shell = fileURLToPath(new URL('../../apps/shell/', import.meta.url));
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const ts = require('typescript');
function evaluateConfig(runtime, version = 'v22.17.0') {
  const code = ts.transpileModule(readFileSync(new URL('../../apps/shell/playwright.ci.config.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const environment = { PLAYWRIGHT_CI_RUNTIME: runtime, PLAYWRIGHT_REUSE_SERVER: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://must-not-be-used.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'must-not-be-used' };
  const exports = {};
  runInNewContext(code, { exports, process: { version, env: environment }, require: name => {
    if (name === '@playwright/test') return { defineConfig: value => value };
    assert.equal(name, './playwright.config');
    return { default: { use: {}, projects: [], testIgnore: ['**/*-live.spec.ts'] } };
  } });
  return { config: exports.default, environment };
}

test('runtime config rejects missing modes and unsupported Node rather than falling back', () => {
  for (const runtime of [undefined, '', 'live', 'other']) assert.throws(() => evaluateConfig(runtime), /explicitly select/);
  assert.throws(() => evaluateConfig('controlled', 'v24.0.0'), /require Node 22/);
});

test('both runtimes override inherited live endpoints and refuse existing servers before a build', () => {
  for (const runtime of ['memory', 'controlled']) {
    const { config, environment } = evaluateConfig(runtime);
    const shell = config.webServer.at(-1);
    assert.ok(config.webServer.every(server => server.reuseExistingServer === false));
    assert.equal(shell.command, 'pnpm build && pnpm start --port 3000');
    assert.equal(shell.env.NEXT_PUBLIC_DATA_SOURCE, runtime === 'memory' ? 'memory' : 'controlled_rpc');
    assert.equal(shell.env.MWELL_MEMORY_SIMULATION_TEST, runtime === 'memory' ? '1' : '0');
    assert.equal(shell.env.MWELL_CONTROLLED_RPC_TEST, runtime === 'controlled' ? '1' : '0');
    assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, shell.env.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY, shell.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(shell.env.NEXT_PUBLIC_SUPABASE_URL, runtime === 'controlled' ? 'http://127.0.0.1:54321' : '');
    assert.equal(shell.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, runtime === 'controlled' ? 'controlled-rpc-anon-key' : '');
    assert.equal(config.webServer.length, runtime === 'controlled' ? 2 : 1);
    assert.equal(config.outputDir, `test-results/${runtime}`);
    assert.ok(config.reporter.some(([name, options]) => name === 'json' && options.outputFile === `playwright-report/${runtime}/results.json`));
    assert.doesNotMatch(JSON.stringify(config), /must-not-be-used|node-runtimes|C:\\\\/);
  }
});

function collect(runtime) {
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
    'tests/smoke', 'tests/e2e', '--list', '--reporter=json',
    '--config', runtime ? 'playwright.ci.config.ts' : 'playwright.config.ts'], {
    cwd: shell, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, CI: '1', PLAYWRIGHT_REUSE_SERVER: '1', PLAYWRIGHT_CI_RUNTIME: runtime ?? '',
      NEXT_PUBLIC_DATA_SOURCE: 'memory', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  const rows = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) for (const item of spec.tests) rows.push({
        key: `${item.projectName}:${spec.file}:${spec.line}:${spec.column}:${spec.title}`, file: spec.file,
      });
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  return rows;
}

test('CI runtime partitions execute every default E2E case exactly once with all six viewports', () => {
  const baseline = collect();
  const memory = collect('memory');
  const controlled = collect('controlled');
  assert.ok(baseline.length >= 1902, `Original E2E inventory must remain: ${baseline.length}`);
  const combined = [...memory, ...controlled].map(row => row.key);
  assert.equal(new Set(combined).size, combined.length, 'runtime partitions must not overlap');
  assert.deepEqual(combined.sort(), baseline.map(row => row.key).sort(), 'no excluded definition may disappear');
  const directory = new URL('../../apps/shell/tests/e2e/', import.meta.url);
  const controlledFiles = readdirSync(directory).filter(file => file.endsWith('.spec.ts') &&
    /from ['"]\.\.\/helpers\/controlled-procurement-rpc['"]/.test(readFileSync(new URL(file, directory), 'utf8')));
  assert.equal(controlledFiles.length, 5, 'review any added controlled runtime dependency');
  assert.deepEqual([...new Set(controlled.map(row => row.file.split(/[\\/]/).at(-1)))].sort(), controlledFiles.sort());
  assert.ok(memory.every(row => !controlledFiles.includes(row.file.split(/[\\/]/).at(-1))));
  assert.ok(memory.some(row => row.file.endsWith('standalone-handbook.spec.ts')));
  assert.ok(memory.some(row => row.file.endsWith('policy-procurement-governed-db.spec.ts')));
  console.log(JSON.stringify({ all: baseline.length, memory: memory.length, controlled: controlled.length }));
});
