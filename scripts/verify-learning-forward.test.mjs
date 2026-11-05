import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { INDEPENDENTLY_VERIFIED_CROSS_MODULE_MIGRATIONS, readRepositoryMigrations, verifyLearningSchema } from './verify-learning-schema.mjs';

const migrations = readRepositoryMigrations();
const assigned = '20260816203000_scope_certification_pathways_to_assigned_roles.sql';
const vendor = '20260912131000_vendor_certification_scope_authority.sql';
const plans = '20260911171901_learning_authority_plan_reuse.sql';
const checkpoints = '20260912045335_align_assigned_training_checkpoints.sql';
const seller = '20260920030900_event_seller_learning_readiness.sql';
const exportsAuthority = '20261105134446_warehouse_export_command_authority.sql';
const returnBalance = '20261105135318_warehouse_allocation_return_balance.sql';
const transferAuthority = '20261105141930_serialized_transfer_quantity_identity.sql';
const messages = input => verifyLearningSchema(input).join('\n');
const childEnvironment = { ...process.env };
delete childEnvironment.NODE_TEST_CONTEXT;
function mutate(name, change) {
  let changed = false;
  const result = migrations.map(entry => {
    if (entry.name !== name) return entry;
    const sql = change(entry.sql);
    assert.notEqual(sql, entry.sql, `mutation must alter ${name}`);
    changed = true;
    return { ...entry, sql };
  });
  assert.ok(changed, name);
  return result;
}

test('the complete current migration history passes both historical and forward contracts', () => {
  assert.deepEqual(verifyLearningSchema(migrations), []);
  assert.deepEqual(verifyLearningSchema(migrations.map(entry => ({ ...entry, sql: entry.sql.replace(/\r?\n/g, '\r\n') }))), []);
});

test('the formerly unpinned assigned-role exception rejects role escalation', () => {
  assert.match(messages(mutate(assigned, sql => `${sql}\ngrant service_role to authenticated;`)),
    /pinned learning migration checksum drifted.*20260816203000/i);
});

test('G02 closed contract rejects removal, widening or leakage of migration timeouts', () => {
  const name='20261105233321_stock_conversion_qc_putaway_bridge.sql';
  for (const change of [
    sql=>sql.replace(/select pg_catalog\.set_config\('lock_timeout'[\s\S]*?name='lock_timeout';/,''),
    sql=>sql.replace("'ms',true)","'ms',false)"),
    sql=>sql.replace('least(setting::bigint,5000)','greatest(setting::bigint,5000)'),
    sql=>sql.replace('then 5000','then 0'),
    sql=>sql.replace('then 60000','then 0'),
    sql=>sql.replace('least(setting::bigint,60000)','60000'),
  ]) assert.match(messages(mutate(name,change)), /reviewed forward.*(?:authority|digest|count|order)/i);
});

test('every historical parser exception rejects appended privilege escalation', () => {
  for (const name of INDEPENDENTLY_VERIFIED_CROSS_MODULE_MIGRATIONS) {
    const errors = verifyLearningSchema(mutate(name, sql => `${sql}\ngrant service_role to authenticated;`));
    assert.ok(errors.some(error => error.includes('Pinned learning migration checksum drifted:') && error.includes(name)), name);
  }
});

test('forward contracts reject missing migrations, unknown additions and statement reordering', () => {
  assert.match(messages(migrations.filter(entry => entry.name !== vendor)), /reviewed forward migration missing.*vendor_certification/i);
  assert.match(messages([...migrations, { name: '20990101000000_foreign_schema_escalation.sql',
    sql: 'grant service_role to authenticated;' }]), /unreviewed forward migration/i);
  assert.match(messages(mutate(seller, sql => `grant execute on function private.event_seller_learning_ready() to authenticated;\n${sql}`)),
    /reviewed forward.*(?:statement|privilege|order)/i);
  assert.match(messages([...migrations, migrations.find(entry => entry.name === vendor)]), /duplicate migration/i);
  const renamed = migrations.map(entry => entry.name === vendor ? { ...entry, name: '20990102000000_renamed_vendor_authority.sql' } : entry);
  assert.match(messages(renamed), /reviewed forward migration missing.*vendor_certification/i);
  assert.match(messages(mutate(seller, sql => sql.replace(/revoke all on function private\.event_seller_learning_ready\(\)[\s\S]*?;/, ''))),
    /reviewed forward statement count\/order/i);
  const reorder = '20260816220000_restore_launch_read_contracts.sql';
  assert.match(messages(mutate(reorder, sql => {
    const notification = sql.match(/notify pgrst, 'reload schema';/)[0];
    return notification + '\n' + sql.replace(notification, '');
  })), /reviewed forward.*(?:authority|digest|order)/i);
});

test('later grants and wrapper changes cannot hide in non-Learning schemas', () => {
  const unrelated = '20261105071219_warehouse_location_dependencies.sql';
  for (const sql of [
    'grant service_role to authenticated;',
    'grant execute on all functions in schema private to authenticated;',
    'alter default privileges in schema learning grant all on tables to anon;',
    'alter table learning.certifications disable row level security;',
    "do $$ begin execute 'grant service_role to authenticated'; end $$;",
  ]) assert.match(messages(mutate(unrelated, source => `${source}\n${sql}`)), /reviewed forward.*statement/i, sql);
  assert.match(messages(mutate('20260905095000_return_intake_certified_boundary.sql', sql => sql.replaceAll('core.has_live_cap', 'core.has_cap'))),
    /reviewed forward.*function.*authority/i);
  assert.match(messages(mutate('20261019142956_warehouse_external_po_receiving.sql', sql => sql.replace('select private.external_po_command(payload)', "select '{}'::jsonb"))),
    /reviewed forward.*function.*authority/i);
});

test('vendor certification rejects removed live invitation and completion authority', () => {
  for (const [from, to, expected] of [
    ['invitation.accepted_generation = invitation.link_generation', 'true', /vendor certification.*invitation generation/i],
    ["assignment.status = 'completed'", 'true', /vendor certification.*completed assignment/i],
    ['completed.requirement_version_id = required.id', 'true', /vendor certification.*exact requirement/i],
    ["certification.status = 'active'", 'true', /vendor certification.*active certification/i],
  ]) assert.match(messages(mutate(vendor, sql => sql.replace(from, to))), expected);
});

test('dynamic Learning transformations preserve predicates and exact snapshot target', () => {
  assert.match(messages(mutate(plans, sql => sql.replace("v_expression := pg_catalog.regexp_replace(v_source, ';\\s*$', '');", "v_expression := 'select true';"))),
    /plan reuse.*original SELECT/i);
  assert.match(messages(mutate(checkpoints, sql => sql.replace('learning.my_learning_snapshot_base()', 'learning.my_learning_snapshot()'))),
    /checkpoint.*snapshot_base/i);
  assert.match(messages(mutate('20260816213000_converge_read_rpc_live_capabilities.sql', sql => sql.replace("'core.has_live_cap('", "'core.has_cap('"))),
    /read RPC convergence.*live capability/i);
});

test('seller readiness remains read-only, private and publication-bound', () => {
  assert.match(messages(mutate(seller, sql => sql.replace('security invoker', 'security definer'))), /seller readiness.*invoker/i);
  assert.match(messages(mutate(seller, sql => sql.replace('from public, anon, authenticated, service_role', 'from public, anon'))),
    /seller readiness.*execute/i);
  assert.match(messages(mutate(seller, sql => sql.replace('cv.owner_id <> cv.reviewer_id', 'true'))), /seller readiness.*independent/i);
  assert.match(messages(mutate('20260920025525_gated_event_seller_custody.sql', sql => sql.replace("learning.mutation_capability_rules(module,capability) values ('events','record_event_outcome')", "learning.mutation_capability_rules(module,capability) values ('events','approve_settlement')"))),
    /seller mutation capability/i);
});

test('export guard transformations retain certified, actor-bound authority independently of their digest', () => {
  for (const [from, to, expected] of [
    ["new_guard := $new$if auth.uid() is null or not (", "new_guard := $new$if not (", /export registration.*live capability/i],
    ["coalesce(core.has_live_cap('warehouse', 'register_exports'), false)", "core.has_cap('warehouse', 'register_exports')", /export registration.*live capability/i],
    ['source.created_by = auth.uid()', 'true', /export correction.*owner.*reviewer/i],
    ["v_job.created_by = auth.uid() and (", 'true and (', /export download.*owner.*type/i],
    ["v_job.export_type <> 'insights_snapshot'", "true", /export download.*owner.*type/i],
    ['<> length(old_guard)', '< 0', /export transformation.*exact.*marker/i],
    ['<> length(correction_guard)', '< 0', /export transformation.*exact.*marker/i],
  ]) assert.match(messages(mutate(exportsAuthority, sql => sql.replace(from, to))), expected);
});

test('export orphan authority rejects RLS-relative absence, other paths and expanded grants', () => {
  for (const [from, to, expected] of [
    ['stable security definer', 'stable security invoker', /export orphan.*definer/i],
    ["set search_path = ''", "set search_path = 'public'", /export orphan.*search_path/i],
    ["p_path like 'exports/' || auth.uid()::text || '/%'", 'true', /export orphan.*own path/i],
    ['where job.storage_path = p_path', 'where job.storage_path = p_path and job.created_by = auth.uid()', /export orphan.*global/i],
    ['from public, anon, authenticated, service_role', 'from public, authenticated, service_role', /export orphan.*execute/i],
    ['to authenticated;', 'to authenticated, anon;', /export orphan.*execute/i],
    ["and owner_id = auth.uid()::text", 'and true', /export temporary read.*owner/i],
    ['and private.warehouse_export_is_unregistered(name)', 'or private.warehouse_export_is_unregistered(name)', /export temporary read.*owner/i],
  ]) assert.match(messages(mutate(exportsAuthority, sql => sql.replace(from, to))), expected);
  assert.match(messages(mutate(exportsAuthority, sql => sql.replace(/(for delete to authenticated using \([\s\S]*?)  and \(coalesce\(core\.has_live_cap\('warehouse', 'register_exports'\), false\)\s+or coalesce\(core\.has_live_cap\('insights', 'prepare_exports'\), false\)\)\s+/, '$1'))),
    /export temporary delete.*directly.*live capability/i);
});

test('allocation return projection retains fail-closed authorization before lookup and client ACLs', () => {
  for (const [from, to, expected] of [
    ['auth.uid() is null or ', '', /allocation return.*authenticate.*before lookup/i],
    ["core.has_live_cap('warehouse','manage_returns')", "core.has_cap('warehouse','manage_returns')", /allocation return.*live capability/i],
    ['is distinct from true', '= false', /allocation return.*fail.closed/i],
    ['begin\n  if auth.uid()', 'begin\n  select * into allocation from warehouse.allocations where id=p_allocation_id;\n  if auth.uid()', /allocation return.*before lookup/i],
    ['stable security definer', 'volatile security definer', /allocation return.*stable.*definer/i],
    ["set search_path = ''", "set search_path = 'public'", /allocation return.*search_path/i],
    ['from public,anon', 'from public', /allocation return.*execute/i],
    ['to authenticated,service_role', 'to authenticated,service_role,anon', /allocation return.*execute/i],
  ]) assert.match(messages(mutate(returnBalance, sql => sql.replace(/\r\n?/g, '\n').replace(from, to))), expected);
});

test('allocation return projection preserves custody delegation, ordinary lineage and quantity-only read behavior', () => {
  for (const [from, to, expected] of [
    ['where event_id=allocation.event_id)', 'where event_id=allocation.event_id and enabled)', /allocation return.*all custody sessions/i],
    ['private.event_allocation_remaining(allocation.id)', 'private.event_allocation_remaining(p_allocation_id)', /allocation return.*exact resolved allocation/i],
    ["'remaining_units',balance->'remaining_units'", "'remaining_units',balance->'issued_units'", /allocation return.*quantity.only.*custody/i],
    ["'remaining_units',balance->'remaining_units'", "'remaining_units',balance->'remaining_units','seller_id',auth.uid()", /allocation return.*quantity.only.*custody/i],
    ['r.event_id=allocation.event_id and ', '', /allocation return.*ordinary.*event.*lineage/i],
    ["line->>'allocationId'=allocation.id", "line->>'productId'=allocation.product_id", /allocation return.*ordinary.*lineage/i],
    ['returned<0 or returned>allocation.quantity', 'false', /allocation return.*invalid.*balance/i],
    ["'remaining_units',allocation.quantity-returned", "'remaining_units',allocation.quantity", /allocation return.*ordinary.*remaining/i],
    ['begin\n  if auth.uid()', 'begin\n  delete from warehouse.returns;\n  if auth.uid()', /allocation return.*read.only/i],
  ]) {
    assert.match(messages(mutate(returnBalance, sql => sql.replace(/\r\n?/g, '\n').replace(from, to))), expected);
  }
});

test('transfer mutation retains predecessor, private implementation and authoritative identity boundaries', () => {
  for (const [from, to, expected] of [
    ["is distinct from '50973cd87f9aacaae2582b4480be732d'", "is distinct from '00000000000000000000000000000000'", /transfer.*reviewed predecessor/i],
    ["to_regprocedure('private.warehouse_transfer_pre_lot_putaway(jsonb)')", "to_regprocedure('warehouse.transfer(jsonb)')", /transfer.*reviewed predecessor/i],
    ['create or replace function private.warehouse_transfer_pre_lot_putaway', 'create or replace function warehouse.transfer', /transfer.*only.*private implementation/i],
    ['security definer', 'security invoker', /transfer.*definer.*search_path/i],
    ["set search_path = ''", "set search_path = 'public'", /transfer.*search_path/i],
    ["if not core.has_cap('warehouse', 'transfer_stock') then", 'if false then', /transfer.*base capability/i],
    ['v_actor := warehouse.authoritative_actor();', "v_actor := 'spoofed';", /transfer.*authoritative actor/i],
    ['warehouse.force_actor_on_object(v_movement, v_actor)', 'v_movement', /transfer.*authoritative actor/i],
    ['from public, anon, authenticated', 'from public, anon', /transfer.*execute/i],
    ['to service_role;', 'to service_role, authenticated;', /transfer.*execute/i],
  ]) assert.match(messages(mutate(transferAuthority, sql => sql.replace(from, to))), expected);
});

test('transfer quantity, unit identity, stock holds and lot guards cannot be removed', () => {
  for (const [from, to, expected] of [
    ["jsonb_typeof(v_movement->'quantity') is distinct from 'number'", 'false', /transfer.*positive integer/i],
    ['v_quantity <> v_expected', 'false', /transfer.*distinct unit count/i],
    ['v_expected <> (select count(distinct id) from unnest(v_unit_ids) id)', 'false', /transfer.*distinct unit count/i],
    ["v_command->'quantity' is distinct from v_movement->'quantity'", 'false', /transfer.*command.*quantity/i],
    ["v_unit.product_id is distinct from v_movement->>'product_id'", 'false', /transfer.*unit product/i],
    ['v_unit.bin_id is distinct from v_from_bin_id', 'false', /transfer.*exact source/i],
    ['active_hold.lot_id is not distinct from v_unit.lot_id', 'true', /transfer.*serialized hold/i],
    ['v_updated <> v_expected', 'false', /transfer.*all selected units/i],
    ['perform private.lock_warehouse_products(v_product_ids);', 'null;', /transfer.*product.*lock/i],
    ['where unit.id = any(v_unit_ids) order by unit.id for update', 'where unit.id = any(v_unit_ids) order by unit.id', /transfer.*unit.*lock/i],
    ['v_to_quantity <> v_from_quantity or v_quantity <> v_from_quantity', 'false', /transfer.*bulk.*quantity/i],
    ['v_source_quantity - v_held_quantity < v_from_quantity', 'false', /transfer.*bulk.*hold/i],
    ["v_to_delta ? 'lot_id' and nullif(v_to_delta->>'lot_id', '') is distinct from v_lot_id", 'false', /transfer.*lot identity/i],
    ["elsif exists (select 1 from warehouse.products p where p.id = v_movement->>'product_id' and p.serialized) then", 'elsif false then', /transfer.*serialized.*unit ids/i],
  ]) assert.match(messages(mutate(transferAuthority, sql => sql.replace(from, to))), expected);
});

test('reviewed dynamic Learning transformations retain their isolated PostgreSQL behavior', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-reporter=tap',
    'scripts/verify-authority-plan-performance.pglite.test.mjs',
    'scripts/verify-vendor-certification-scope.pglite.test.mjs',
    'scripts/verify-assigned-training-checkpoints.pglite.test.mjs',
    'scripts/sep20-seller-learning.test.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 120000, env: childEnvironment,
  });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /# tests [1-9]\d*/);
  assert.match(result.stdout, /# fail 0\b/);
  assert.match(result.stdout, /# skipped 0\b/);
});

test('the existing seller persona adapter preserves evidence and rejects unrelated null personas', () => {
  const require = createRequire(new URL('../modules/learning/package.json', import.meta.url));
  const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const result = spawnSync(process.execPath, [vitest, 'run', 'src/repository.test.ts', '--maxWorkers=1'], {
    cwd: fileURLToPath(new URL('../modules/learning/', import.meta.url)), encoding: 'utf8', timeout: 60000, env: childEnvironment,
  });
  assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
});
