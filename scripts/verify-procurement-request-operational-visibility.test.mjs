import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');
const SUFFIX = '_procurement_request_operational_visibility.sql';

function migration() {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(SUFFIX));
  assert.equal(files.length, 1, 'add exactly one forward operational-visibility migration');
  assert.ok(
    files[0] > '20260826160000_harden_serial_custody_concurrency.sql',
    'the migration must run after the serial-custody launch gate',
  );
  return {
    file: files[0],
    sql: readFileSync(resolve(MIGRATIONS, files[0]), 'utf8'),
  };
}

function functionBody(sql, qualifiedName) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

test('extends request visibility only to certified Procurement and Finance operators', () => {
  const { sql } = migration();
  const helper = functionBody(sql, 'private.can_read_procurement_request');

  assert.match(helper, /requester_id\s*=\s*auth\.uid\(\)/i);
  assert.match(helper, /from procurement\.request_collaborators/i);
  assert.match(helper, /revoked_at is null/i);
  assert.match(helper, /core\.has_live_cap\('procurement',\s*'author_po'\)/i);
  assert.match(helper, /core\.has_live_cap\('procurement',\s*'manage_rfp'\)/i);
  assert.match(helper, /core\.has_live_cap\('procurement',\s*'view_finance'\)/i);
  assert.match(helper, /core\.has_live_cap\('procurement',\s*'admin'\)/i);

  assert.doesNotMatch(helper, /core\.has_(?:live_)?cap\('procurement',\s*'view_dashboard'\)/i);
  assert.doesNotMatch(helper, /has_module_role|raw_user_meta_data|user_metadata/i);
});

test('keeps all request-dependent read models behind the shared row-scope helper', () => {
  const prior = readFileSync(
    resolve(MIGRATIONS, '20260815154702_procurement_finance_requester_privacy.sql'),
    'utf8',
  );

  for (const policy of [
    'procurement_requests_read',
    'procurement_steps_read',
    'request_attachments_read',
    'procurement_requests_auth_read',
  ]) {
    const start = prior.indexOf(`create policy ${policy}`);
    assert.notEqual(start, -1, `missing ${policy}`);
    const end = prior.indexOf(';', start);
    assert.match(prior.slice(start, end + 1), /private\.can_read_procurement_request/i);
  }
});
