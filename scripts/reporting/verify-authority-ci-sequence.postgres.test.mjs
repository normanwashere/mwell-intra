// Optional local proof of the exact CI sequence, using a NEW native PG17 cluster.
// SEP22_DOA_PG_BIN=<bin> node --test scripts/reporting/verify-authority-ci-sequence.postgres.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

test('prior DOA harness -> authority harness -> authority rerun on guarded shared CI PG17', {
  skip: process.env.SEP22_DOA_PG_BIN ? false : 'Local native binaries required for the CI-sequence proof', timeout: 240000,
}, async t => {
  const bin = process.env.SEP22_DOA_PG_BIN;
  assert.ok(path.isAbsolute(bin));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const invoke = (name, args) => execFileSync(path.join(bin, name + suffix), args, {
    encoding: 'utf8', windowsHide: true, timeout: 60000, ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}),
  });
  assert.match(invoke('postgres', ['--version']), /PostgreSQL\) 17\./);
  const scratch = await mkdtemp(path.join(tmpdir(), 'reporting-authority-ci-proof-'));
  const data = path.join(scratch, 'data'), passwordFile = path.join(scratch, 'password');
  const password = randomBytes(32).toString('hex');
  await writeFile(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
  try { invoke('initdb', ['-D', data, '-U', 'postgres', '--pwfile', passwordFile,
    '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { await unlink(passwordFile); }
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  // Own exactly this generated cluster; retain synthetic files rather than delete
  // a computed Windows path. Always stop it, including child test failures.
  t.after(() => invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']));
  invoke('pg_ctl', ['-D', data, '-l', path.join(scratch, 'postgres.log'), '-w', '-t', '30',
    '-o', `-h 127.0.0.1 -p ${port} -c cluster_name=sep22_doa_ci`, 'start']);
  const observer = new Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', ssl: false });
  await observer.connect();
  try {
    const identity = (await observer.query("select current_setting('data_directory') data,current_setting('listen_addresses') listen,inet_server_port() port")).rows[0];
    assert.equal(path.resolve(identity.data).toLowerCase(), path.resolve(data).toLowerCase());
    assert.equal(identity.listen, '127.0.0.1'); assert.equal(identity.port, port);
    const env = { ...process.env, CI: 'true', SEP22_DOA_EPHEMERAL_CI: '1',
      SEP22_DOA_CI_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres` };
    delete env.SEP22_DOA_PG_BIN;
    delete env.NODE_TEST_CONTEXT;
    const scripts = ['scripts/verify-sep22-doa-final-authority.postgres.test.mjs',
      'scripts/reporting/verify-authority.postgres.test.mjs', 'scripts/reporting/verify-authority.postgres.test.mjs'];
    for (const script of scripts) {
      const result = execFileSync(process.execPath, ['--test', '--test-reporter=tap', script], {
        env, cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true, encoding: 'utf8', timeout: 180000,
      });
      assert.match(result, /# fail 0/); assert.match(result, /# skipped 0/);
      t.diagnostic(`${script}: ${result.match(/# tests \d+/)?.[0]}, fail 0, skipped 0`);
      assert.equal((await observer.query("select count(*)::int n from pg_database where not datistemplate and datname <> 'postgres'")).rows[0].n, 0);
      const roles = (await observer.query("select rolname from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres' order by rolname")).rows.map(row => row.rolname);
      assert.deepEqual(roles, ['anon','authenticated','service_role']);
    }
    t.diagnostic(`Retained synthetic cluster/log: ${scratch}`);
  } finally { await observer.end(); }
});
