import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260722121500_product_readiness_and_pricing_governance.sql",
  ),
  "utf8",
).toLowerCase();
const certificationMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260723020000_product_certification_cleanup.sql",
  ),
  "utf8",
).toLowerCase();

test("creates governed Product readiness and pricing records", () => {
  for (const fragment of [
    "create schema if not exists product",
    "create table if not exists product.readiness_packages",
    "create table if not exists product.readiness_events",
    "create table if not exists product.price_proposals",
    "create table if not exists product.price_events",
    "unique (product_id, version)",
  ]) {
    assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("exposes the Product schema through the authenticated Data API", () => {
  assert.match(
    migration,
    /alter role authenticator set "pgrst\.db_schemas"\s*=\s*[^;]*product/,
  );
  assert.match(migration, /notify pgrst, 'reload config'/);
});

test("enforces evidence, final decision, and Operations handoff gates", () => {
  assert.match(migration, /create or replace function product\.submit_readiness_package/);
  assert.match(migration, /create or replace function product\.decide_readiness_package/);
  assert.match(migration, /create or replace function product\.acknowledge_operations_handoff/);
  assert.match(migration, /not core\.has_cap\('product',\s*'prepare_readiness'\)/);
  assert.match(migration, /not core\.has_cap\('product',\s*'decide_go_live'\)/);
  assert.match(migration, /not core\.has_cap\('product',\s*'acknowledge_operations_handoff'\)/);
  assert.match(migration, /jsonb_array_length\(v_evidence\) = 0/);
  assert.match(migration, /insert into core\.notifications/);
  assert.match(
    migration,
    /core\.notifications\(user_id, kind, entity_type, entity_id\)[\s\S]*?'product_go_live_approved'/,
  );
  assert.match(migration, /create or replace function product\.can_launch/);
});

test("requires independent, effective-dated price approval and immutable history", () => {
  assert.match(migration, /create or replace function product\.submit_price_proposal/);
  assert.match(migration, /create or replace function product\.decide_price_proposal/);
  assert.match(migration, /v_proposal\.proposed_by = auth\.uid\(\)/);
  assert.match(migration, /effective_at timestamptz not null/);
  assert.match(migration, /cost_basis numeric[^\n]*not null/);
  assert.match(migration, /reason text not null/);
  assert.match(migration, /create or replace function product\.apply_due_price_revisions/);
  assert.match(migration, /update warehouse\.products/);
  assert.match(migration, /revoke all on function warehouse\.set_product_price\(jsonb\) from authenticated/);
});

test("keeps Product tables RPC-only and history append-only", () => {
  assert.match(migration, /alter table product\.readiness_packages enable row level security/);
  assert.match(migration, /alter table product\.price_proposals enable row level security/);
  assert.match(migration, /revoke (?:all|insert, update, delete) on product\.readiness_packages from authenticated/);
  assert.match(migration, /revoke (?:all|insert, update, delete) on product\.price_proposals from authenticated/);
  assert.match(migration, /create or replace function product\.reject_history_mutation/);
  assert.match(migration, /before update or delete on product\.readiness_events/);
  assert.match(migration, /before update or delete on product\.price_events/);
});

test("allows vaulted certification readback and exact marker cleanup only", () => {
  assert.match(
    certificationMigration,
    /grant select on[\s\S]*product\.readiness_packages[\s\S]*to service_role/,
  );
  assert.match(
    certificationMigration,
    /create or replace function product\.cleanup_certification_records\(p_marker text\)/,
  );
  assert.match(certificationMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(
    certificationMigration,
    /\^qa-\[0-9\]\{8\}-\[a-f0-9\]\{8\}-\(desktop-1440\|mobile-390\)\$/,
  );
  assert.match(
    certificationMigration,
    /revoke all on function product\.cleanup_certification_records\(text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    certificationMigration,
    /grant execute on function product\.cleanup_certification_records\(text\)[\s\S]*to service_role/,
  );
  assert.doesNotMatch(
    certificationMigration,
    /grant (?:insert|update|delete|all) on[\s\S]*product\.readiness_packages[\s\S]*to service_role/,
  );
});
