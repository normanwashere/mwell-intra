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
