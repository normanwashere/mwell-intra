import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scalarMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813074855_fix_certification_requirement_scalar_aliases.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const qualifiedMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260813075513_qualify_certification_requirement_evidence.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("compares certification requirement UUIDs as scalar values", () => {
  const scalarAliases = qualifiedMigration.match(
    /pg_catalog\.unnest\(new\.requirement_version_ids\)\s+as evidence\(requirement_id\)/gi,
  );

  assert.equal(scalarAliases?.length, 3);
  assert.doesNotMatch(
    qualifiedMigration,
    /from\s+(?:pg_catalog\.)?unnest\(new\.requirement_version_ids\)\s+requirement_id/i,
  );
  assert.match(
    qualifiedMigration,
    /curriculum_requirement\.requirement_version_id\s*=\s*evidence\.requirement_id/i,
  );
  assert.match(
    qualifiedMigration,
    /assignment_requirement\.requirement_version_id\s*=\s*evidence\.requirement_id/i,
  );
  assert.match(scalarMigration, /as evidence\(requirement_id\)/i);
});
