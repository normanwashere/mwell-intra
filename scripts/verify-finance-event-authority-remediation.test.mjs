import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260810160000_finance_event_authority_remediation.sql",
  import.meta.url,
);

async function source() {
  return readFile(migrationUrl, "utf8");
}

function functionBody(sql, qualifiedName) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end);
}

test("splits Finance read access from close and settlement authority", async () => {
  const sql = await source();
  assert.match(sql, /'warehouse'\s*,\s*'manage_finance_close'/);
  assert.match(sql, /'events'\s*,\s*'approve_settlement'/);
  assert.match(sql, /'events'\s*,\s*'finance_reviewer'/);
  assert.match(sql, /core\.has_cap\('warehouse',\s*'manage_finance_close'\)/);
  assert.match(sql, /core\.has_cap\('events',\s*'approve_settlement'\)/);
  assert.doesNotMatch(
    functionBody(sql, "core.manage_finance_close_entry"),
    /view_finance/,
  );
  assert.doesNotMatch(
    functionBody(sql, "warehouse.save_event_reconciliation"),
    /view_finance/,
  );
});

test("keeps terminal close entries immutable and rejects stale commands", async () => {
  const sql = await source();
  assert.match(sql, /status in \('posted',\s*'reconciled'\)/i);
  assert.match(sql, /expected_updated_at/i);
  assert.match(sql, /Finance close entry changed; refresh and try again/i);
  assert.doesNotMatch(
    sql,
    /on conflict\s*\([^)]*entry_type[^)]*\)\s*do update[\s\S]*posted_by\s*=\s*null/i,
  );
});

test("enforces independent and stale-safe event settlement approval", async () => {
  const sql = await source();
  assert.match(sql, /v_reconciliation\.prepared_by\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /A second Finance user must approve the event settlement/i);
  assert.match(sql, /Event reconciliation changed; refresh and try again/i);
});
