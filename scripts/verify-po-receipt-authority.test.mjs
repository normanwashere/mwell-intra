import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { verifyPoReceiptAuthority } from './verify-po-receipt-authority.mjs';

const migrationPath = new URL(
  '../supabase/migrations/20260714175318_single_po_receipt_authority.sql',
  import.meta.url,
);
const directory = new URL('./', migrationPath);
const names = (await readdir(directory)).filter(name => name.endsWith('.sql') && name >= '20260714175318_single_po_receipt_authority.sql').sort();
const sources = await Promise.all(names.map(async name => ({ name, sql: (await readFile(new URL(name, directory), 'utf8')).replaceAll('\r\n', '\n') })));
const putaway = sources.find(source => source.name.endsWith('_lot_aware_atomic_putaway.sql'));
assert.ok(putaway, 'Missing lot-aware putaway migration fixture');
const baseline = sources.filter(source => source.name < putaway.name && !source.name.endsWith('_warehouse_closed_po_history.sql'));
const chainFinding = 'Latest Warehouse issue wrapper does not preserve the verified issue authority chain';
const authorityMigration = '20260717143000_task3_receipt_authority_forward_convergence.sql';
const holdMigration = '20260718202000_block_issue_from_held_stock_identity.sql';
const certificationMigration = '20260813203240_task_1_database_authority_remediation.sql';
const replayMigration = '20260905094000_offline_replay_identity.sql';

async function verifyFixture(t, migrations, suffix = '') {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'po-receipt-authority-'));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const path = join(temporaryDirectory, '20260714175318_single_po_receipt_authority.sql');
  await writeFile(path, migrations.map(source => source.sql).join('\n') + '\n' + suffix);
  return verifyPoReceiptAuthority(pathToFileURL(path));
}

function changeMigration(name, before, after) {
  assert.ok(sources.find(source => source.name === name)?.sql.includes(before), `Missing fixture anchor in ${name}: ${before}`);
  return sources.map(source => source.name === name ? { ...source, sql: source.sql.replace(before, after) } : source);
}

test('single receipt authority migration removes Procurement mutation and preserves Warehouse authority', async () => {
  const findings = await verifyPoReceiptAuthority(migrationPath);
  assert.deepEqual(findings, []);
});

test('the pre-putaway baseline preserves the certification, hold and offline issue chain', async t => {
  assert.deepEqual(await verifyFixture(t, baseline), []);
});

test('adding the transfer-only putaway migration does not change issue authority', async t => {
  assert.deepEqual(await verifyFixture(t, [...baseline, putaway]), []);
});

test('accepts the actual replay wrapper with CREATE OR REPLACE and tagged inline dollar quoting', async t => {
  const migrations = changeMigration(replayMigration,
    "create function warehouse.issue(payload jsonb) returns jsonb\nlanguage sql security definer set search_path = '' as $$\n  select private.warehouse_offline_action('issue', payload);\n$$;",
    "create or replace function warehouse.issue(payload jsonb) returns jsonb language sql security definer set search_path = '' as $issue$ select private.warehouse_offline_action('issue', payload); $issue$;");
  assert.deepEqual(await verifyFixture(t, migrations), []);
});

for (const create of ['create function', 'create or replace function']) {
  test(`rejects a later bypass using ${create}, even with delegation text in a separate function`, async t => {
    const suffix = `${create} warehouse.issue(payload jsonb) returns jsonb language sql as $$ select payload; $$;
create function private.unrelated(payload jsonb) returns jsonb language plpgsql as $$
begin return private.warehouse_issue_v1(payload); end;
$$;`;
    assert.ok((await verifyFixture(t, sources, suffix)).includes(chainFinding));
  });

  test(`rejects an inline later bypass using ${create}`, async t => {
    const suffix = `select 1; ${create} warehouse.issue(payload jsonb) returns jsonb language sql as $$ select payload; $$;`;
    assert.ok((await verifyFixture(t, sources, suffix)).includes(chainFinding));
  });
}

for (const [name, rename] of [
  [holdMigration, 'alter function warehouse.issue(jsonb) set schema private;'],
  [holdMigration, 'alter function private.issue(jsonb) rename to warehouse_issue_v1;'],
  [certificationMigration, 'alter function warehouse.issue(jsonb) rename to issue_uncertified_impl;'],
  [replayMigration, 'alter function warehouse.issue(jsonb) rename to issue_pre_offline_identity;'],
]) {
  test(`rejects a missing chain-preserving rename: ${rename}`, async t => {
    assert.ok((await verifyFixture(t, changeMigration(name, rename, ''))).includes(chainFinding));
  });
}

for (const [label, name, before, after] of [
  ['certification check', certificationMigration, "not core.has_live_cap('warehouse', 'issue_items')", 'false'],
  ['replay capability check', replayMigration, "not coalesce(core.has_live_cap('warehouse', capability), false)", 'false'],
  ['replay payload binding', replayMigration, "saved.command_input is distinct from payload->'command_input'", 'false'],
  ['replay delegation', replayMigration, 'result := warehouse.issue_pre_offline_identity(payload);', 'result := private.warehouse_issue_v1(payload);'],
  ['hold delegation', holdMigration, 'return private.warehouse_issue_v1(payload);', 'return payload;'],
]) {
  test(`rejects a broken ${label}`, async t => {
    assert.ok((await verifyFixture(t, changeMigration(name, before, after))).includes(chainFinding));
  });
}

for (const [label, before, after, finding] of [
  ['lot holds', 'v_stock.quantity-v_exact_held<abs(v_delta)', 'v_stock.quantity<abs(v_delta)', 'Latest Warehouse issue mutation does not exclude exact active serial and lot holds'],
  ['serial holds', 'active_hold.serial_number=unit.serial_number', 'true', 'Latest Warehouse issue mutation does not exclude exact active serial and lot holds'],
  ['movement identity', "'reference',v_alloc.id", "'reference',payload->>'reference'", 'Latest Warehouse issue leaves authoritative movement identity caller-controlled'],
  ['stock clamping', 'quantity=quantity+v_delta', 'quantity=greatest(0,quantity+v_delta)', 'Latest Warehouse issue mutation silently clamps an insufficient stock drawdown'],
  ['allocation order', 'update warehouse.stock_levels set quantity=quantity+v_delta', "update warehouse.allocations set status='issued' where id=v_alloc.id; update warehouse.stock_levels set quantity=quantity+v_delta", 'Latest Warehouse issue marks the allocation issued before exact stock mutation succeeds'],
]) {
  test(`still rejects weakened ${label} in the actual delegated issue implementation`, async t => {
    assert.ok((await verifyFixture(t, changeMigration(authorityMigration, before, after))).includes(finding));
  });
}

test('does not trust a historical implementation after its private delegate is replaced', async t => {
  const suffix = 'create or replace function private.warehouse_issue_v1(payload jsonb) returns jsonb language sql as $$ select payload; $$;';
  const findings = await verifyFixture(t, sources, suffix);
  assert.ok(findings.includes(chainFinding));
  assert.ok(findings.includes('Latest Warehouse issue mutation does not exclude exact active serial and lot holds'));
});

for (const signature of ['warehouse.issue(jsonb)', 'warehouse.issue_pre_offline_identity(jsonb)', 'warehouse.issue_uncertified_impl(jsonb)', 'private.warehouse_issue_v1(jsonb)', 'private.warehouse_offline_action(text,jsonb)']) {
  test(`rejects a dropped issue-chain function: ${signature}`, async t => {
    assert.ok((await verifyFixture(t, sources, `drop function ${signature};`)).includes(chainFinding));
  });
}
