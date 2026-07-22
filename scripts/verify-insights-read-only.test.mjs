import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/20260723010000_insights_projection_read_only.sql",
  import.meta.url,
);

test("Insights projection grants browser roles read access only", async () => {
  const sql = (await readFile(migration, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();

  assert.match(
    sql,
    /revoke all privileges on table core\.v_insights_snapshot from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant select on table core\.v_insights_snapshot to authenticated, service_role/,
  );
  assert.doesNotMatch(
    sql,
    /grant (insert|update|delete|all).*core\.v_insights_snapshot.*authenticated/,
  );
  assert.match(
    sql,
    /create trigger reject_insights_snapshot_write instead of insert or update or delete on core\.v_insights_snapshot/,
  );
  assert.match(sql, /raise insufficient_privilege/);
});
