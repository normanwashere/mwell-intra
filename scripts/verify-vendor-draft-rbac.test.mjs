import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');
const FORWARD_MIGRATION = resolve(
  MIGRATIONS,
  '20260812120000_vendor_accreditation_draft_rbac.sql',
);

function effectiveFunction(qualifiedName) {
  const signature = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${qualifiedName.replace('.', '\\.')}\\s*\\(\\s*payload\\s+jsonb\\s*\\)`,
    'gi',
  );
  let effective = null;

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const source = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    for (const match of source.matchAll(signature)) {
      const start = match.index ?? 0;
      const end = source.indexOf('$$;', start);
      assert.notEqual(end, -1, `${file}: unterminated ${qualifiedName} definition`);
      effective = { file, sql: source.slice(start, end + 3) };
    }
  }

  assert.ok(effective, `No effective definition found for ${qualifiedName}`);
  return effective;
}

function effectiveNoArgFunction(qualifiedName) {
  const signature = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${qualifiedName.replace('.', '\\.')}\\s*\\(\\s*\\)`,
    'gi',
  );
  let effective = null;

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const source = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    for (const match of source.matchAll(signature)) {
      const start = match.index ?? 0;
      const end = source.indexOf('$$;', start);
      assert.notEqual(end, -1, `${file}: unterminated ${qualifiedName} definition`);
      effective = { file, sql: source.slice(start, end + 3) };
    }
  }

  assert.ok(effective, `No effective definition found for ${qualifiedName}`);
  return effective;
}

function expectPattern(definition, pattern, message) {
  assert.match(definition.sql, pattern, `${definition.file}: ${message}`);
}

function allMigrationSql() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(resolve(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

test('the forward migration projects draft authority only to core.vendor_portal', () => {
  const migration = readFileSync(FORWARD_MIGRATION, 'utf8');
  const grants = [...allMigrationSql().matchAll(
    /\(\s*'core'\s*,\s*'([^']+)'\s*,\s*'manage_own_accreditation_draft'\s*\)/gi,
  )].map((match) => match[1]);

  assert.match(
    migration,
    /insert\s+into\s+core\.capabilities\s*\(\s*module\s*,\s*cap\s*\)\s*values\s*\(\s*'core'\s*,\s*'manage_own_accreditation_draft'\s*\)/i,
  );
  assert.deepEqual(grants, ['vendor_portal']);
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+core\.(?:capabilities|role_capabilities)/i,
    'the RBAC change must be additive',
  );

  const projection = effectiveNoArgFunction('core.my_capabilities');
  expectPattern(
    projection,
    /join\s+core\.roles\s+r[\s\S]*r\.is_active[\s\S]*join\s+core\.role_capabilities\s+rc/i,
    'must project active live role grants',
  );
  expectPattern(
    projection,
    /where\s+ur\.user_id\s*=\s*auth\.uid\(\)/i,
    'must project only the signed-in user',
  );
});

test('effective vendor draft commands require draft authority and retain ownership scope', () => {
  for (const command of ['save_vendor_application_draft', 'discard_vendor_application_draft']) {
    const exposed = effectiveFunction(`legal.${command}`);
    const guarded = effectiveFunction(`private.${command}`);

    expectPattern(
      exposed,
      /core\.has_cap\(\s*'core'\s*,\s*'manage_own_accreditation_draft'\s*\)/i,
      'must require the vendor draft capability',
    );
    expectPattern(
      exposed,
      new RegExp(`private\\.${command}\\(payload\\)`, 'i'),
      'must delegate to the vendor-scoped implementation',
    );
    expectPattern(
      guarded,
      /v_case\.vendor_id\s+is\s+distinct\s+from\s+core\.current_vendor_id\(\)/i,
      'must retain vendor-id ownership enforcement',
    );
  }

  const save = effectiveFunction('private.save_vendor_application_draft');
  expectPattern(save, /v_case\.status\s*<>\s*'draft'/i, 'must retain draft-state enforcement');
  expectPattern(save, /expected_version/i, 'must retain optimistic concurrency');
});

test('final submission remains a separate submit_accreditation transition', () => {
  const submission = effectiveFunction('legal.submit_vendor_application');
  const guarded = effectiveFunction('private.policy_submit_vendor_application');

  expectPattern(
    submission,
    /core\.has_cap\(\s*'core'\s*,\s*'submit_accreditation'\s*\)/i,
    'must require final-submission authority',
  );
  assert.doesNotMatch(
    submission.sql,
    /manage_own_accreditation_draft/i,
    `${submission.file}: final submission must not reuse draft authority`,
  );
  expectPattern(
    guarded,
    /v_case\.vendor_id\s+is\s+distinct\s+from\s+core\.current_vendor_id\(\)/i,
    'must retain vendor-id ownership enforcement',
  );
  expectPattern(
    guarded,
    /v_case\.status\s*<>\s*'draft'/i,
    'must retain the controlled draft-to-submitted transition',
  );
});
