import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationDir = resolve('supabase', 'migrations');
const sql = readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(resolve(migrationDir, name), 'utf8'))
  .join('\n');

const commands = [
  ['update_operation_route', 'manage_operation_routes'],
  ['inspect_quality', 'inspect_quality'],
  ['release_quality_hold', 'release_quality_hold'],
  ['create_vendor_return', 'release_quality_hold'],
  ['submit_cycle_count', 'cycle_count'],
  ['decide_stock_change', 'approve_stock_adjustment'],
  ['resolve_exception', 'resolve_exceptions'],
];

const failures = [];
function requireMatch(pattern, message) {
  try {
    assert.match(sql, pattern);
  } catch {
    failures.push(message);
  }
}

for (const [command, capability] of commands) {
  requireMatch(
    new RegExp(
      `create or replace function warehouse\\.${command}\\(payload jsonb\\)[\\s\\S]*?language sql[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
      'i',
    ),
    `warehouse.${command} is not a safe invoker wrapper`,
  );
  requireMatch(
    new RegExp(
      `create or replace function private\\.warehouse_${command}\\(payload jsonb\\)[\\s\\S]*?language plpgsql[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
      'i',
    ),
    `private.warehouse_${command} is not a safe definer implementation`,
  );
  requireMatch(
    new RegExp(
      `private\\.warehouse_${command}\\(payload jsonb\\)[\\s\\S]*?core\\.has_cap\\('warehouse', '${capability}'\\)`,
      'i',
    ),
    `private.warehouse_${command} lacks ${capability} authorization`,
  );
  requireMatch(
    new RegExp(
      `revoke all on function warehouse\\.${command}\\(jsonb\\) from public, anon`,
      'i',
    ),
    `warehouse.${command} does not revoke public/anon execution`,
  );
  requireMatch(
    new RegExp(
      `revoke all on function private\\.warehouse_${command}\\(jsonb\\) from public, anon`,
      'i',
    ),
    `private.warehouse_${command} does not revoke public/anon execution`,
  );
}

for (const helper of ['begin_idempotent_command', 'finish_idempotent_command']) {
  requireMatch(
    new RegExp(
      `create or replace function private\\.${helper}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
      'i',
    ),
    `private.${helper} is missing or unsafe`,
  );
}

requireMatch(/for update/i, 'W1 commands do not lock source rows');
requireMatch(/insert into warehouse\.command_log/i, 'W1 commands do not record idempotency');
requireMatch(
  /on conflict\s*\(actor_id\s*,\s*command_name\s*,\s*idempotency_key\s*\)\s*do nothing/i,
  'idempotency insertion is not concurrency-safe',
);
requireMatch(/update warehouse\.command_log/i, 'W1 commands do not complete idempotency records');
requireMatch(/insert into core\.activity_log/i, 'W1 commands do not append activity evidence');
requireMatch(
  /created_by\s*=\s*auth\.uid\(\)|created_by\s*<>\s*auth\.uid\(\)/i,
  'hold release does not enforce creator/actor separation',
);
requireMatch(
  /status\s*=\s*'active'/i,
  'hold and vendor-return commands do not require active custody state',
);
requireMatch(
  /alter table warehouse\.quality_inspections\s+add column if not exists bin_id text/i,
  'quality inspection does not preserve bin scope',
);
requireMatch(
  /alter table warehouse\.inventory_holds\s+add column if not exists bin_id text/i,
  'inventory hold does not preserve bin scope',
);
requireMatch(
  /private\.warehouse_release_quality_hold\(payload jsonb\)[\s\S]*?update warehouse\.receipts/i,
  'hold release does not recalculate receipt quality status',
);
requireMatch(
  /private\.warehouse_create_vendor_return\(payload jsonb\)[\s\S]*?v_hold\.bin_id/i,
  'vendor return does not use the held bin scope',
);
requireMatch(
  /v_serial is not null and v_quantity <> 1/i,
  'serialized quality inspections do not enforce a one-unit quantity',
);
requireMatch(
  /private\.warehouse_inspect_quality\(payload jsonb\)[\s\S]*?v_serial is not null[\s\S]*?from warehouse\.inventory_units/i,
  'serialized quality inspection does not validate the persisted unit scope',
);
requireMatch(
  /private\.warehouse_inspect_quality\(payload jsonb\)[\s\S]*?v_lot_id is not null[\s\S]*?from warehouse\.stock_levels/i,
  'bulk quality inspection does not validate the persisted lot scope',
);
requireMatch(
  /v_inspection\.source_type = 'receipt'[\s\S]*?supplier_id is distinct from payload->>'supplier_id'/i,
  'vendor return does not enforce the receipt supplier',
);
requireMatch(
  /private\.warehouse_release_quality_hold\(payload jsonb\)[\s\S]*?jsonb_array_length\(v_evidence\) = 0/i,
  'hold release does not require evidence',
);
requireMatch(
  /'before', to_jsonb\(v_route\)[\s\S]*?'after', to_jsonb\(v_next_route\)/i,
  'operation route audit does not record before and after policy',
);
requireMatch(
  /private\.warehouse_submit_cycle_count\(payload jsonb\)[\s\S]*?order by product_id\s*,\s*location_id\s*,\s*bin_id[\s\S]*?for update/i,
  'cycle-count submission does not lock inventory in deterministic order',
);
requireMatch(
  /private\.warehouse_submit_cycle_count\(payload jsonb\)[\s\S]*?duplicate serial[\s\S]*?unknown serial/i,
  'cycle-count submission does not reject duplicate and unknown serial scans',
);
requireMatch(
  /private\.warehouse_decide_stock_change\(payload jsonb\)[\s\S]*?decision = 'pending'[\s\S]*?order by step[\s\S]*?for update/i,
  'stock-change decision does not lock the ordered current approval step',
);
requireMatch(
  /private\.warehouse_decide_stock_change\(payload jsonb\)[\s\S]*?if exists[\s\S]*?decision = 'pending'[\s\S]*?pending_finance[\s\S]*?else[\s\S]*?insert into warehouse\.movements/i,
  'stock movement is not isolated to the final-approval branch',
);
requireMatch(
  /private\.warehouse_resolve_exception\(payload jsonb\)[\s\S]*?severity = 'P1'[\s\S]*?cannot be waived/i,
  'P1 exceptions are not protected from waiver',
);

for (const [command] of commands) {
  const exposedDefinition = new RegExp(
    `create or replace function warehouse\\.${command}\\(payload jsonb\\)([\\s\\S]*?)\\$\\$;`,
    'i',
  ).exec(sql)?.[1];
  if (exposedDefinition && /security definer/i.test(exposedDefinition)) {
    failures.push(`warehouse.${command} is SECURITY DEFINER in an exposed schema`);
  }
}

if (failures.length > 0) {
  console.error(`Warehouse W1 contract verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Warehouse W1 contract verification passed (${commands.length} invoker RPCs with private guarded implementations).`,
);

const liveKeys = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'WAREHOUSE_QA_EMAIL',
  'WAREHOUSE_QA_PASSWORD',
  'WAREHOUSE_SUPERVISOR_EMAIL',
  'WAREHOUSE_SUPERVISOR_PASSWORD',
];
const missingLiveKeys = liveKeys.filter((key) => !process.env[key]);
if (missingLiveKeys.length > 0) {
  console.log(`LIVE SKIPPED: missing ${missingLiveKeys.join(', ')}`);
}
