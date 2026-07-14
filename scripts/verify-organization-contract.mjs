#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationDirectory = resolve(root, 'supabase/migrations');

const requirements = [
  [
    'hierarchical departments table',
    /create table if not exists core\.departments/i,
  ],
  ['stable department code', /code text not null unique/i],
  [
    'optional parent with restricted deletion',
    /parent_id uuid references core\.departments\s*\(id\) on delete restrict/i,
  ],
  ['soft-active department status', /is_active boolean not null default true/i],
  ['stable department ordering', /sort_order integer not null/i],
  [
    'cycle prevention',
    /with recursive descendants[\s\S]*department hierarchy cycle/i,
  ],
  [
    'scoped profile assignments',
    /create table if not exists core\.profile_department_scopes/i,
  ],
  [
    'historical assignment integrity',
    /department_id uuid not null references core\.departments\s*\(id\) on delete restrict/i,
  ],
  [
    'effective scope dates',
    /effective_from date not null[\s\S]*effective_to date/i,
  ],
  [
    'department read RPC',
    /create or replace function core\.list_departments\s*\(\s*\)/i,
  ],
  [
    'department write RPC',
    /create or replace function core\.upsert_department\s*\(payload jsonb\)/i,
  ],
  [
    'department assignment RPC',
    /create or replace function core\.assign_profile_department\s*\(payload jsonb\)/i,
  ],
  [
    'live RBAC catalogue RPC',
    /create or replace function core\.list_rbac_catalog\s*\(\s*\)/i,
  ],
  [
    'role bundle write RPC',
    /create or replace function core\.upsert_role_bundle\s*\(payload jsonb\)/i,
  ],
  [
    'effective capability RPC',
    /create or replace function core\.my_capabilities\s*\(\s*\)/i,
  ],
  [
    'authoritative administration gate',
    /core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i,
  ],
  [
    'capability catalogue validation',
    /join core\.capabilities|from core\.capabilities/i,
  ],
  ['protected bootstrap roles', /protected bootstrap role/i],
  [
    'self escalation prevention',
    /cannot grant core:manage_rbac|self-escalation/i,
  ],
  [
    'self assignment prevention',
    /cannot modify your own role assignment|self-assignment/i,
  ],
  ['unresolved-work deactivation guard', /unresolved work/i],
  [
    'before and after audit snapshots',
    /jsonb_build_object\s*\(\s*'before'[\s\S]*'after'/i,
  ],
  [
    'Warehouse Operator seed',
    /'warehouse'\s*,\s*'warehouse_operator'\s*,\s*'Warehouse Operator'/i,
  ],
  [
    'Warehouse Supervisor seed',
    /'warehouse'\s*,\s*'warehouse_supervisor'\s*,\s*'Warehouse Supervisor'/i,
  ],
  ['legacy Operations alias preserved', /'warehouse'\s*,\s*'operations'/i],
  [
    'legacy Logistics Supervisor alias preserved',
    /'warehouse'\s*,\s*'logistics_supervisor'/i,
  ],
  ['Product go-live authority', /product[\s\S]*go-live authority/i],
];

function functionSql(sql, name) {
  const start = sql.search(
    new RegExp(`create or replace function core\\.${name}\\s*\\(`, 'i'),
  );
  if (start < 0) return '';
  const end = sql.indexOf('$$;', start);
  return end < 0 ? sql.slice(start) : sql.slice(start, end + 3);
}

export function verifyOrganizationSql(sql) {
  const errors = [];
  for (const [label, pattern] of requirements) {
    if (!pattern.test(sql))
      errors.push(`Missing organization contract: ${label}`);
  }

  for (const name of [
    'has_cap',
    'has_any_cap',
    'has_module_role',
    'my_capabilities',
    'sync_user_role_claims',
  ]) {
    const source = functionSql(sql, name);
    if (
      !/join core\.roles\s+\w+[\s\S]*?\.is_active(?:\s*=\s*true)?/i.test(source)
    ) {
      errors.push(`${name} must derive authority from active roles.`);
    }
  }

  if (!/exclude using gist[\s\S]*?daterange/i.test(sql)) {
    errors.push(
      'Effective-scope overlap must be prevented by a GiST exclusion constraint.',
    );
  }
  if (
    !/pg_catalog\.pg_constraint[\s\S]*?profile_department_scopes_no_overlap[\s\S]*?exclude using gist/i.test(
      sql,
    )
  ) {
    errors.push('Effective-scope exclusion creation must be safe on migration rerun.');
  }
  if (
    !/pg_advisory_xact_lock/i.test(functionSql(sql, 'upsert_department')) ||
    !/pg_advisory_xact_lock/i.test(functionSql(sql, 'prevent_department_cycle'))
  ) {
    errors.push('Department hierarchy writes must be serialized.');
  }
  if (
    !/expected_updated_at[\s\S]*stale editor/i.test(
      functionSql(sql, 'upsert_department'),
    )
  ) {
    errors.push('Department writes must reject a stale editor version.');
  }
  const departmentWrite = functionSql(sql, 'upsert_department');
  const departmentLock = departmentWrite.search(
    /from core\.departments[\s\S]*?for update/i,
  );
  const deactivationRecheck = departmentWrite.search(
    /department_has_unresolved_work/i,
  );
  if (departmentLock < 0 || deactivationRecheck < departmentLock) {
    errors.push(
      'Department deactivation must lock the department before rechecking assignments.',
    );
  }

  const scopeWrite = functionSql(sql, 'assign_profile_department');
  if (
    !/from core\.departments[\s\S]*?for update[\s\S]*?not v_department\.is_active/i.test(
      scopeWrite,
    )
  ) {
    errors.push(
      'Department assignment must use a compatible department lock and active-state recheck.',
    );
  }
  const scopeNoOp = scopeWrite.search(
    /return pg_catalog\.to_jsonb\(v_existing\)/i,
  );
  const scopeHistoryGuard = scopeWrite.search(
    /effective scope history is append-only/i,
  );
  if (
    scopeNoOp < 0 ||
    scopeHistoryGuard < 0 ||
    scopeNoOp > scopeHistoryGuard
  ) {
    errors.push('Historical scope no-ops must return before history rejection.');
  }
  if (
    !/cannot reopen an effective scope[\s\S]*cannot extend an effective scope/i.test(
      functionSql(sql, 'assign_profile_department'),
    )
  ) {
    errors.push(
      'Effective scopes must be append-only after start and may only be closed.',
    );
  }
  if (
    !/effective_to is null or scope\.effective_to >= current_date/i.test(
      functionSql(sql, 'department_has_unresolved_work'),
    )
  ) {
    errors.push(
      'Future and nonexpired scopes must block department deactivation.',
    );
  }

  const catalogue = functionSql(sql, 'list_rbac_catalog');
  if (
    !/core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i.test(catalogue)
  ) {
    errors.push('RBAC catalogue must enforce core:manage_rbac internally.');
  }
  if (!/updated_at timestamptz/i.test(catalogue)) {
    errors.push('RBAC catalogue must expose an updated_at editor version.');
  }

  const departmentCatalogue = functionSql(sql, 'list_departments');
  if (
    !/core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i.test(
      departmentCatalogue,
    )
  ) {
    errors.push('Department administration aggregates must enforce core:manage_rbac.');
  }

  const claimSync = functionSql(sql, 'sync_user_role_claims');
  const lockPosition = claimSync.search(/from auth\.users[\s\S]*?for update/i);
  const snapshotPosition = claimSync.search(/from core\.user_roles/i);
  if (
    lockPosition < 0 ||
    snapshotPosition < 0 ||
    lockPosition > snapshotPosition
  ) {
    errors.push(
      'Claim refresh must lock the auth user before reading the complete role snapshot.',
    );
  }

  const bundle = functionSql(sql, 'upsert_role_bundle');
  const roleLock = functionSql(sql, 'lock_role_bundle_keys');
  if (
    !/order by requested\.role/i.test(roleLock) ||
    !/lock_role_bundle_keys\s*\(\s*v_module\s*,\s*v_original_role\s*,\s*v_role/i.test(
      bundle,
    )
  ) {
    errors.push('Role bundle writes must lock original and target keys deterministically.');
  }
  if (!/expected_updated_at[\s\S]*stale editor version/i.test(bundle)) {
    errors.push('Role bundle writes must require a fresh catalogue editor version.');
  }
  if (
    !/from core\.user_roles[\s\S]*?for update[\s\S]*?array_agg\(ur\.user_id/i.test(
      bundle,
    )
  ) {
    errors.push('Role bundle writes must recalculate affected users under lock.');
  }
  if (
    !/delete from core\.role_capabilities[\s\S]*?role = v_original_role/i.test(
      bundle,
    )
  ) {
    errors.push('Role rename must clean old grants.');
  }
  if (!/affected_user_ids/i.test(bundle)) {
    errors.push('Role bundle audit must identify affected assignments.');
  }
  if (
    !/v_original_role = v_role and v_before = v_after[\s\S]*?return v_before/i.test(
      bundle,
    )
  ) {
    errors.push('Role bundles must audit only real changes.');
  }

  for (const name of ['assign_user_role', 'revoke_user_role']) {
    const source = functionSql(sql, name);
    if (!/lock_role_bundle_keys\s*\(\s*v_module\s*,\s*v_role/i.test(source)) {
      errors.push(`${name} must share the role bundle advisory lock.`);
    }
    if (
      !/get diagnostics v_changed = row_count[\s\S]*?if v_changed = 0 then[\s\S]*?return/i.test(
        source,
      )
    ) {
      errors.push(`${name} must audit only real assignment changes.`);
    }
  }
  if (
    !/foreign key \(module, role\)[\s\S]*?references core\.roles\(module, role\)[\s\S]*?deferrable/i.test(
      sql,
    )
  ) {
    errors.push('User role assignments need deferrable composite role integrity.');
  }
  if (
    !/\('operations', 'warehouse_operator'\)[\s\S]*?\('logistics_supervisor', 'warehouse_supervisor'\)/i.test(
      sql,
    )
  ) {
    errors.push('Legacy Warehouse aliases must mirror canonical database grants.');
  }
  if (
    !/roles_module_format_check[\s\S]*roles_role_format_check[\s\S]*roles_label_nonempty_check/i.test(
      sql,
    )
  ) {
    errors.push(
      'Runtime roles must have safe module, role, and label integrity constraints.',
    );
  }

  const securityDefiners =
    sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
  for (const source of securityDefiners.filter((entry) =>
    /security definer/i.test(entry),
  )) {
    if (!/set search_path\s*=\s*''/i.test(source)) {
      const name =
        source.match(/function\s+([^\s(]+)/i)?.[1] ?? 'unknown function';
      errors.push(`${name} SECURITY DEFINER search_path must be empty.`);
    }
  }

  return errors;
}

function run() {
  const migrationNames = readdirSync(migrationDirectory).filter((name) =>
    name.endsWith('_core_organization_extensibility.sql'),
  );
  if (migrationNames.length !== 1) {
    throw new Error(
      `Expected exactly one core organization extensibility migration, found ${migrationNames.length}.`,
    );
  }

  const migrationName = migrationNames[0];
  if (migrationName !== '20260714175057_core_organization_extensibility.sql') {
    throw new Error(
      'Use the CLI-generated Task 2 migration without creating another.',
    );
  }

  const sql = readFileSync(resolve(migrationDirectory, migrationName), 'utf8');
  const errors = verifyOrganizationSql(sql);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  for (const code of [
    'marketing',
    'sales',
    'product',
    'technology',
    'pmo',
    'operations',
    'operations.warehouse_logistics',
    'operations.customer_service',
    'operations.client_product_implementation',
    'finance',
    'procurement',
    'legal_compliance',
    'people_culture',
    'administration',
  ]) {
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`'${escapedCode}'`, 'i').test(sql)) {
      throw new Error(`Missing department seed: ${code}`);
    }
  }

  console.log(`Organization contract passed: ${migrationName}`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  run();
}
