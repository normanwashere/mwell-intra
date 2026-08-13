import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813065507_learning_pgcrypto_digest_compatibility.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("delegates pinned learning digests to the managed pgcrypto schema", () => {
  assert.match(
    migration,
    /create or replace function public\.digest\(data bytea, algorithm text\)[\s\S]*?select extensions\.digest\(data, algorithm\)/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.digest\(bytea, text\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(migration, /grant execute/i);
});
