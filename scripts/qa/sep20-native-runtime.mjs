// Native, loopback-only scratch runtime. No DATABASE_URL, .env, UAT or production connection is accepted.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { functionDefinition } from '../quality-inspection-verifier-fixture.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'modules/events/package.json'));
const ts = require('typescript');
const pgDirectory = readdirSync(path.join(root, 'node_modules/.pnpm')).find(name => /^pg@8\./.test(name));
assert.ok(pgDirectory, 'Existing workspace pg driver required; do not install into the checkout');
const { Client } = createRequire(path.join(root, 'package.json'))(path.join(root, 'node_modules/.pnpm', pgDirectory, 'node_modules/pg'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const sourceHashes = new Map();
function track(file, source) {
  const name = file instanceof URL ? fileURLToPath(file) : String(file);
  sourceHashes.set(path.relative(root, name).replaceAll('\\', '/'), sha256(source));
  return source;
}

// Reuse trusted repository fixtures without importing their node:test registrations or PGlite runtime.
// TypeScript's parser removes imports and anchors import.meta.url to the original fixture file.
export async function fixtureFrom(file, names, client, bindings = {}) {
  const filename = path.join(root, file), source = track(filename, await readFile(filename, 'utf8'));
  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), edits = [];
  function visit(node) {
    if (ts.isImportDeclaration(node)) { edits.push([node.getStart(syntax), node.end, '']); return; }
    if (node.kind === ts.SyntaxKind.ExportKeyword) { edits.push([node.getStart(syntax), node.end, '']); return; }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'url' && ts.isMetaProperty(node.expression)) {
      edits.push([node.getStart(syntax), node.end, JSON.stringify(pathToFileURL(filename).href)]); return;
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  let body = source;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) body = body.slice(0, start) + replacement + body.slice(end);
  const hooks = { before: [], beforeEach: [] };
  // Roles are cluster-global, unlike schemas. They were created once by this scratch runtime.
  const exec = sql => client.query(sql.replace(/create role (anon|authenticated|service_role)( bypassrls)?;/gi, ''));
  const adapter = { exec, query: (sql, args) => client.query(sql, args), close: async () => {} };
  const noop = () => {};
  const dependencies = {
    assert, URL, hooks, functionDefinition,
    readFile: async (f, encoding) => track(f, await readFile(f, encoding)),
    readFileSync: (f, encoding) => track(f, readFileSync(f, encoding)),
    PGlite: function ScratchAdapter() { return adapter; },
    test: noop, after: noop, before: fn => hooks.before.push(fn), beforeEach: fn => hooks.beforeEach.push(fn),
    ...bindings,
  };
  for (const name of names) assert.match(name, /^[a-zA-Z_][a-zA-Z_0-9]*$/);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction(...Object.keys(dependencies), `${body}\nreturn {${names.join(',')},hooks};`)(...Object.values(dependencies));
}

export async function startScratch() {
  const bin = process.env.SEP20_PG_BIN, output = process.env.SEP20_NATIVE_OUTPUT;
  assert.ok(bin && path.isAbsolute(bin), 'Set SEP20_PG_BIN to native PostgreSQL 17 binaries');
  assert.ok(output && path.isAbsolute(output), 'Set SEP20_NATIVE_OUTPUT outside the repository');
  assert.ok(!path.resolve(output).toLowerCase().startsWith(path.resolve(root).toLowerCase()), 'Evidence must stay outside the checkout');
  await mkdir(output, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binary = name => path.join(bin, name + suffix);
  // pg_ctl's background Windows server inherits pipe handles; ignore stdio and use its dedicated log.
  const invoke = (name, args) => execFileSync(binary(name), args, { encoding: 'utf8', windowsHide: true, timeout: 60_000,
    ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) });
  const version = invoke('postgres', ['--version']).trim();
  assert.match(version, /PostgreSQL\) 17\./, 'Match the repository PostgreSQL major version');
  const scratch = await mkdtemp(path.join(tmpdir(), 'sep20-native-'));
  const data = path.join(scratch, 'data'), passwordFile = path.join(scratch, 'init-password');
  const password = randomBytes(32).toString('hex');
  await writeFile(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
  try { invoke('initdb', ['-D', data, '-U', 'sep20_local', '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { await unlink(passwordFile); }
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const log = path.join(output, `postgres-${path.basename(scratch)}.log`);
  try { invoke('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '30', '-o', `-h 127.0.0.1 -p ${port} -c max_connections=20 -c deadlock_timeout=200ms -c log_lock_waits=on`, 'start']); }
  catch (error) { try { invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); } catch {} throw error; }
  const connections = new Set();
  async function connect(database = 'postgres') {
    assert.match(database, /^(postgres|sep20_[a-z0-9_]+)$/);
    const client = new Client({ host: '127.0.0.1', port, user: 'sep20_local', password, database, ssl: false,
      application_name: 'sep20-isolated-native-proof', connectionTimeoutMillis: 5_000 });
    await client.connect(); connections.add(client);
    await client.query("set statement_timeout='15s';set lock_timeout='10s';set idle_in_transaction_session_timeout='30s';set timezone='Asia/Manila'");
    return client;
  }
  let admin;
  try {
    admin = await connect();
    const identity = (await admin.query("select version(),current_setting('data_directory') data,current_setting('listen_addresses') listen,inet_server_port() port")).rows[0];
    assert.equal(path.resolve(identity.data).toLowerCase(), path.resolve(data).toLowerCase());
    assert.equal(identity.listen, '127.0.0.1'); assert.equal(identity.port, port);
    await admin.query('create role anon;create role authenticated;create role service_role bypassrls');
  } catch (error) {
    for (const client of connections) await client.end().catch(() => {});
    invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); throw error;
  }
  let counter = 0;
  return { version, output, scratch, data, port, connect,
    async database(label) {
      assert.match(label, /^[a-z0-9_]+$/);
      const name = `sep20_${++counter}_${label}`;
      await admin.query(`create database "${name}" template template0`);
      const client = await connect(name);
      const local = [client];
      return { name, client, newClient: async () => { const next = await connect(name); local.push(next); return next; },
        close: async () => { for (const next of local) { await next.query('rollback').catch(() => {}); await next.end().catch(() => {}); connections.delete(next); } } };
    },
    async close() {
      for (const client of connections) { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}); }
      invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']);
      // Retain only this synthetic cluster's files for diagnosis; never recursively delete a computed Windows path.
    },
  };
}

export async function installedFunctions(client, signatures) {
  const result = [];
  for (const signature of signatures) {
    const row = (await client.query('select pg_get_functiondef($1::regprocedure) body', [signature])).rows[0];
    assert.ok(row.body, `Function missing: ${signature}`);
    result.push({ signature, sha256: sha256(row.body) });
  }
  return result;
}

// A completes its RPC but keeps its transaction open. B MUST demonstrably block on A.
export async function contend(observer, first, second, actionA, actionB) {
  const pidA = (await first.query('select pg_backend_pid() pid')).rows[0].pid;
  const pidB = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  assert.notEqual(pidA, pidB);
  await first.query('begin isolation level read committed');
  await second.query('begin isolation level read committed');
  let pending;
  try {
    const winner = await actionA(first);
    let settled = false;
    pending = actionB(second).then(value => ({ ok: true, value }), error => ({ ok: false, code: error.code, message: error.message }))
      .finally(() => { settled = true; });
    const deadline = Date.now() + 7000;
    let evidence;
    while (Date.now() < deadline && !settled) {
      const row = (await observer.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1', [pidB])).rows[0];
      if (row?.wait_event_type === 'Lock' && row.blockers.includes(pidA)) { evidence = row; break; }
      await delay(20);
    }
    assert.ok(evidence, 'Second independent backend must be observed waiting on first; timing alone is not proof');
    await first.query('commit');
    const loser = await pending;
    await second.query(loser.ok ? 'commit' : 'rollback');
    assert.ok(!['40P01', '55P03', '57014'].includes(loser.code), `Deadlock/timeout is not a business denial: ${JSON.stringify(loser)}`);
    return { winner, loser, blocking: { winner_pid: pidA, waiter_pid: pidB, ...evidence } };
  } finally {
    await first.query('rollback').catch(() => {}); await second.query('rollback').catch(() => {});
    if (pending) await pending;
  }
}
