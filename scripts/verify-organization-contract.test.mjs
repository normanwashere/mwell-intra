import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyOrganizationSql } from './verify-organization-contract.mjs';

const verifier = fileURLToPath(
  new URL('./verify-organization-contract.mjs', import.meta.url),
);
const migration = fileURLToPath(
  new URL(
    '../supabase/migrations/20260714175057_core_organization_extensibility.sql',
    import.meta.url,
  ),
);
const sql = readFileSync(migration, 'utf8');

function replaceInFunction(source, functionName, pattern, replacement) {
  const start = source.search(
    new RegExp(`create or replace function core\\.${functionName}\\s*\\(`, 'i'),
  );
  assert.notEqual(start, -1, `Missing function ${functionName}`);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, `Unterminated function ${functionName}`);
  return (
    source.slice(0, start) +
    source.slice(start, end + 3).replace(pattern, replacement) +
    source.slice(end + 3)
  );
}

function functionSql(source, functionName) {
  const start = source.search(
    new RegExp(`create or replace function core\\.${functionName}\\s*\\(`, 'i'),
  );
  assert.notEqual(start, -1, `Missing function ${functionName}`);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, `Unterminated function ${functionName}`);
  return source.slice(start, end + 3);
}

test('organization migration satisfies the extensibility and authorization contract', () => {
  const result = spawnSync(process.execPath, [verifier], {
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
  assert.match(result.stdout, /organization contract passed/i);
});

test('authoritative capability checks require active roles', () => {
  const errors = verifyOrganizationSql(sql);

  assert.equal(
    errors.some((error) => /active roles/i.test(error)),
    false,
    errors.join('\n'),
  );

  const withoutActiveRoleFilter = sql.replace(
    /join core\.roles r[\s\S]*?r\.is_active(?:\s*=\s*true)?/i,
    'join core.roles r on r.module = ur.module and r.role = ur.role',
  );
  assert.match(
    verifyOrganizationSql(withoutActiveRoleFilter).join('\n'),
    /active roles/i,
  );
});

test('hierarchy and effective-scope writes are serialized and overlap-safe', () => {
  const errors = verifyOrganizationSql(sql);

  assert.equal(
    errors.some((error) => /serial|overlap|stale editor/i.test(error)),
    false,
    errors.join('\n'),
  );

  assert.match(
    verifyOrganizationSql(
      sql.replace(/exclude using gist/i, 'constraint without exclusion'),
    ).join('\n'),
    /overlap/i,
  );
  assert.match(
    verifyOrganizationSql(
      sql.replaceAll(/pg_advisory_xact_lock/gi, 'missing_hierarchy_lock'),
    ).join('\n'),
    /serial/i,
  );
});

test('scope history, catalogue authorization, and claim refresh fail closed', () => {
  const errors = verifyOrganizationSql(sql);

  assert.equal(errors.length, 0, errors.join('\n'));

  assert.match(
    verifyOrganizationSql(
      sql.replace(
        /from auth\.users u[\s\S]*?for update;/i,
        'from auth.users u where false;',
      ),
    ).join('\n'),
    /auth user.*lock|lock.*auth user/i,
  );
  assert.match(
    verifyOrganizationSql(
      sql.replace(/cannot reopen an effective scope/i, 'scope may reopen'),
    ).join('\n'),
    /append-only/i,
  );
  assert.match(
    verifyOrganizationSql(
      replaceInFunction(
        sql,
        'list_rbac_catalog',
        /core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i,
        'true',
      ),
    ).join('\n'),
    /catalogue.*manage_rbac/i,
  );
});

test('security definer functions use an empty search path', () => {
  assert.equal(
    verifyOrganizationSql(sql).some((error) => /search_path/i.test(error)),
    false,
  );

  assert.match(
    verifyOrganizationSql(
      sql.replace("set search_path = ''", 'set search_path = core, public'),
    ).join('\n'),
    /search_path/i,
  );
});

test('compatible locks and real-change audit guards are mandatory', () => {
  assert.equal(verifyOrganizationSql(sql).length, 0);

  assert.match(
    verifyOrganizationSql(
      replaceInFunction(
        sql,
        'assign_profile_department',
        /from core\.departments d[\s\S]*?for update;/i,
        'from core.departments d where false;',
      ),
    ).join('\n'),
    /compatible department lock/i,
  );
  assert.match(
    verifyOrganizationSql(
      replaceInFunction(
        sql,
        'assign_user_role',
        /get diagnostics v_changed = row_count;/i,
        'v_changed := 1;',
      ),
    ).join('\n'),
    /real assignment changes/i,
  );
});

test('role bundle and assignment writes share deterministic versioned locks', () => {
  const bundle = functionSql(sql, 'upsert_role_bundle');
  const assignment = functionSql(sql, 'assign_user_role');
  const revocation = functionSql(sql, 'revoke_user_role');
  const catalog = functionSql(sql, 'list_rbac_catalog');

  assert.match(sql, /create or replace function core\.lock_role_bundle_keys/i);
  assert.match(
    bundle,
    /lock_role_bundle_keys\s*\(\s*v_module\s*,\s*v_original_role\s*,\s*v_role/i,
  );
  assert.match(assignment, /lock_role_bundle_keys\s*\(\s*v_module\s*,\s*v_role/i);
  assert.match(revocation, /lock_role_bundle_keys\s*\(\s*v_module\s*,\s*v_role/i);
  assert.match(bundle, /expected_updated_at[\s\S]*stale editor version/i);
  assert.match(catalog, /updated_at timestamptz/i);
  assert.match(
    sql,
    /foreign key \(module, role\)[\s\S]*references core\.roles\(module, role\)[\s\S]*deferrable/i,
  );
});

test('scope no-ops, migration reruns, and department aggregates are safe', () => {
  const scope = functionSql(sql, 'assign_profile_department');
  const noOp = scope.search(/return pg_catalog\.to_jsonb\(v_existing\)/i);
  const historyGuard = scope.search(/effective scope history is append-only/i);
  assert.ok(noOp >= 0 && noOp < historyGuard, 'scope no-op must precede history rejection');

  assert.match(
    sql,
    /pg_constraint[\s\S]*profile_department_scopes_no_overlap[\s\S]*exclude using gist/i,
  );
  assert.match(
    functionSql(sql, 'list_departments'),
    /core\.has_cap\s*\(\s*'core'\s*,\s*'manage_rbac'\s*\)/i,
  );
});

test('department helper access and role assignment integrity are finalized', () => {
  assert.equal(verifyOrganizationSql(sql).length, 0);
  assert.doesNotMatch(
    sql,
    /grant execute on function core\.department_has_unresolved_work\(uuid\) to authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on function core\.department_has_unresolved_work\(uuid\) from public, anon, authenticated/i,
  );

  const aliasSeed = sql.search(/insert into core\.roles[\s\S]*?operations[\s\S]*?logistics_supervisor/i);
  const orphanCheck = sql.search(/orphan[\s_-]*user[\s_-]*role/i);
  const validation = sql.search(/validate constraint user_roles_role_integrity_fk/i);
  assert.ok(aliasSeed >= 0 && aliasSeed < orphanCheck, 'known aliases must be seeded before orphan rejection');
  assert.ok(orphanCheck >= 0 && orphanCheck < validation, 'orphans must be rejected before FK validation');

  assert.match(
    verifyOrganizationSql(
      sql.replace(
        /revoke all on function core\.department_has_unresolved_work\(uuid\) from public, anon, authenticated/i,
        'grant execute on function core.department_has_unresolved_work(uuid) to authenticated',
      ),
    ).join('\n'),
    /department helper.*authenticated/i,
  );
  assert.match(
    verifyOrganizationSql(
      sql.replace(/validate constraint user_roles_role_integrity_fk/i, 'constraint remains not valid'),
    ).join('\n'),
    /role assignment.*validated/i,
  );
});

test('warehouse stock approvals use governed capability groups and server eligibility', () => {
  assert.match(sql, /create table if not exists core\.approval_groups/i);
  assert.match(sql, /approve_stock_adjustment_finance/i);
  assert.match(sql, /create or replace function warehouse\.list_stock_change_requests\s*\(payload jsonb\)/i);
  assert.match(sql, /can_decide/i);
  assert.match(sql, /requested_by\s*<>\s*auth\.uid\(\)/i);
  assert.match(sql, /order by step[\s\S]*?limit 1/i);
  assert.doesNotMatch(
    sql,
    /role\s*=\s*v_step\.approver_role/i,
    'approval decisions must not require a literal role-code assignment',
  );
});
