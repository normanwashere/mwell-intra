import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813071129_learning_assessment_answer_count_compatibility.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("counts submitted assessment answers with supported PostgreSQL JSON functions", () => {
  assert.match(
    migration,
    /select count\(\*\)::integer\s+into v_submitted_answer_count\s+from pg_catalog\.jsonb_object_keys\(v_answers\)/i,
  );
  assert.match(migration, /if v_submitted_answer_count <> v_question_count/i);
  assert.doesNotMatch(migration, /jsonb_object_length/i);
  assert.match(
    migration,
    /alter function learning\.submit_assessment\(jsonb\) owner to postgres/i,
  );
  assert.match(
    migration,
    /grant execute on function learning\.submit_assessment\(jsonb\)\s+to authenticated, service_role/i,
  );
});
