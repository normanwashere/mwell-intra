import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260722114000_govern_admin_role_changes_and_seed_doa.sql",
  import.meta.url,
);

test("role changes require retained approval evidence", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists core\.role_change_evidence/i);
  assert.match(sql, /Approval reference is required/i);
  assert.match(sql, /Business reason is required/i);
  assert.match(sql, /Self-assignment is not allowed/i);
  assert.match(sql, /insert into core\.role_change_evidence/i);
});

test("temporary editable department DOA matrices are seeded idempotently", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const department of [
    "Operations",
    "Procurement",
    "Marketing",
    "Product",
    "Finance",
    "Legal",
    "Technology",
    "Sales",
    "Project Management Office",
  ]) {
    assert.match(sql, new RegExp(department, "i"));
  }
  assert.match(sql, /on conflict \(version\) do nothing/i);
});

test("administrators have an audit viewer and mobile DOA controls remain in flow", async () => {
  const [auditPage, adminPage, doaPage] = await Promise.all([
    readFile(new URL("../apps/shell/app/admin/audit/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/shell/app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../apps/shell/app/admin/doa/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(auditPage, /activity_log/);
  assert.match(auditPage, /view_audit/);
  assert.match(adminPage, /\/admin\/audit/);
  assert.doesNotMatch(doaPage, /data-mobile-action-bar="true"[\s\S]{0,300}className="fixed/);
  assert.match(doaPage, /input-base min-h-11 w-full/);
});
