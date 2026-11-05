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
