import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813070234_learning_policy_acknowledgment_chronology.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("records policy acceptance on the transaction timeline", () => {
  assert.match(
    migration,
    /create or replace function learning\.acknowledge_policy\(payload jsonb\)/i,
  );
  const insert = migration.match(
    /insert into learning\.policy_acknowledgments\([\s\S]*?returning \* into v_acknowledgment;/i,
  )?.[0];
  assert.ok(insert, "The governed acknowledgment insert must remain present.");
  assert.match(insert, /pg_catalog\.now\(\)/i);
  assert.doesNotMatch(insert, /pg_catalog\.clock_timestamp\(\)/i);
  assert.match(
    migration,
    /alter function learning\.acknowledge_policy\(jsonb\) owner to postgres/i,
  );
  assert.match(
    migration,
    /grant execute on function learning\.acknowledge_policy\(jsonb\)\s+to authenticated, service_role/i,
  );
});
