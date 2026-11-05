import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableLocalDatabaseUrl } from './verify-learning-catalog.mjs';
import { scanSql } from './verify-learning-schema.mjs';

const migrationUrl = new URL('../supabase/migrations/20261105195433_stock_conversion_qc_putaway_bridge.sql', import.meta.url);

export function putawayTimeoutProbeSql(source, schema) {
  assert.match(schema, /^qa_g02_timeout_[a-f0-9]{32}$/);
  const statements = scanSql(source);
  assert.equal(statements[0].toLowerCase(), 'begin');
  for (const [index, name] of ['lock_timeout','statement_timeout'].entries()) {
    assert.match(statements[index + 1], new RegExp(`^select pg_catalog\\.set_config\\(\\s*'${name}'`, 'i'));
    assert.match(statements[index + 1], /true\s*\)\s*from pg_catalog\.pg_settings/i);
  }
  assert.match(statements[3], /^do\b/i);
  const triggers = statements.filter(sql => /^create trigger stock_conversion_00_qc_watch\b/i.test(sql));
  assert.equal(triggers.length, 1);
  assert.match(triggers[0], / on warehouse\.quality_inspections for each row /);
  return {
    prefix: `${statements.slice(0,3).join(';\n')};`,
    // Same source trigger DDL, only its relation is an owned empty scratch table.
    trigger: triggers[0].replace(' on warehouse.quality_inspections ', ` on ${schema}.quality_inspections `),
  };
}

export async function verifyPutawayMigrationTimeouts(connectionString) {
  assertDisposableLocalDatabaseUrl(connectionString);
  assert.equal(new URL(connectionString).search, '', 'Connection overrides are not allowed');
  const { Client } = await import('pg');
  const clients = Array.from({ length:3 }, () => new Client({ connectionString, connectionTimeoutMillis:5000 }));
  const connected = [];
  const [owner, blocker, migration] = clients;
  const schema = `qa_g02_timeout_${randomUUID().replaceAll('-','')}`;
  const sql = putawayTimeoutProbeSql(await readFile(migrationUrl,'utf8'), schema);
  const settings = async () => (await migration.query("select name,setting::int value from pg_settings where name in ('lock_timeout','statement_timeout') order by name")).rows.map(row => row.value);
  let created = false;
  try {
    for (const client of clients) {
      await client.connect();
      connected.push(client);
      await client.query("set statement_timeout='15s'; set lock_timeout='2s'");
    }
    await owner.query(`create schema ${schema}`);
    created = true;
    await owner.query(`create table ${schema}.quality_inspections(id integer)`);
    const blockerPid = (await blocker.query('select pg_backend_pid() pid')).rows[0].pid;
    const migrationPid = (await migration.query('select pg_backend_pid() pid')).rows[0].pid;
    for (const entry of [
      { name:'unbounded caller capped', lock:'0', expected:5000 },
      { name:'stricter caller retained', lock:'800ms', expected:800 },
    ]) {
      await migration.query("select set_config('lock_timeout',$1,false),set_config('statement_timeout','0',false)", [entry.lock]);
      const before = await settings();
      await blocker.query(`begin; lock table ${schema}.quality_inspections in row exclusive mode`);
      await migration.query(sql.prefix);
      assert.deepEqual(await settings(), [entry.expected,60000]);
      let outcome;
      const started = Date.now();
      const pending = migration.query(sql.trigger).then(
        () => { outcome = { ok:true }; }, error => { outcome = { error }; },
      );
      let observed = false;
      try {
        while (!outcome && Date.now()-started < 10000) {
          const waiting = await owner.query('select $1::int=any(pg_blocking_pids($2::int)) blocked', [blockerPid,migrationPid]);
          observed ||= waiting.rows[0].blocked;
          await delay(20);
        }
      } finally {
        // Release only our own blocker, including on watchdog or assertion failure.
        await blocker.query('rollback');
        await pending;
        await migration.query('rollback');
      }
      assert.equal(observed, true, `${entry.name}: native lock contention was observed`);
      assert.equal(outcome.error?.code, '55P03', `${entry.name}: must fail specifically on lock_timeout`);
      assert.ok(Date.now()-started < entry.expected+4000, `${entry.name}: bounded lock wait`);
      assert.deepEqual(await settings(), before, 'rollback restores caller limits');
      assert.equal((await owner.query('select count(*)::int n from pg_trigger where tgrelid=$1::regclass and not tgisinternal', [`${schema}.quality_inspections`])).rows[0].n, 0);
    }
    // A stricter statement timeout remains effective, independently of lock timeout.
    await migration.query("set lock_timeout=0; set statement_timeout='100ms'");
    await migration.query(sql.prefix);
    assert.deepEqual(await settings(), [5000,100]);
    try { await assert.rejects(migration.query('select pg_sleep(1)'), error => error.code === '57014'); }
    finally { await migration.query('rollback'); }
    assert.deepEqual(await settings(), [0,100]);
    await migration.query('set statement_timeout=0');
    await migration.query(sql.prefix);
    await migration.query(sql.trigger);
    await migration.query('commit');
    assert.deepEqual(await settings(), [0,0], 'commit restores unbounded caller settings');
    assert.equal((await owner.query('select count(*)::int n from pg_trigger where tgrelid=$1::regclass and not tgisinternal', [`${schema}.quality_inspections`])).rows[0].n, 1);
  } finally {
    try {
      await Promise.allSettled(connected.map(client => client.query('rollback')));
      if (created) {
        assert.match(schema, /^qa_g02_timeout_[a-f0-9]{32}$/);
        await owner.query(`drop schema ${schema} cascade`);
        assert.equal((await owner.query('select count(*)::int n from pg_namespace where nspname=$1', [schema])).rows[0].n, 0);
      }
    } finally { await Promise.allSettled(clients.map(client => client.end())); }
  }
  console.log('Applied PostgreSQL G02 timeout probe passed (2 actual trigger lock waits, stricter statement cancellation, commit/rollback restoration and owned-schema cleanup).');
}
