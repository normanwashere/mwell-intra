import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260722124731_insights_correctness_and_provenance.sql",
);
const sourceRouteMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260723031500_insights_warehouse_source_route.sql",
);
const launchBlockerMigrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260815183000_leadership_insights_launch_blockers.sql",
);

describe("Insights snapshot migration contract", () => {
  it("projects target semantics, completeness, reporting, and freshness provenance", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const field of [
      "target_direction text",
      "target_min numeric",
      "target_max numeric",
      "data_status text",
      "sample_count bigint",
      "reporting_period_start timestamptz",
      "reporting_period_end timestamptz",
      "source_updated_at timestamptz",
      "extracted_at timestamptz",
    ]) {
      expect(sql).toContain(field);
    }
  });

  it("keeps missing populations nullable and separates source freshness from extraction", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/when count\(\*\) = 0 then null/i);
    expect(sql).toMatch(
      /max\([^)]*(created_at|updated_at|prepared_at|decided_at)[^)]*\)/i,
    );
    expect(sql).toContain("current_timestamp as extracted_at");
    expect(sql).not.toMatch(/source_updated_at\s*,?\s*current_timestamp/i);
  });

  it("forwards the Warehouse metric source to the canonical data route", () => {
    const sql = readFileSync(sourceRouteMigrationPath, "utf8");

    expect(sql).toContain("core.insights_snapshot()");
    expect(sql).toContain("'/warehouse/analytics'");
    expect(sql).toContain("'/warehouse/data'");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it("ships the Leadership launch blockers as a separate forward-only migration", () => {
    const sql = readFileSync(launchBlockerMigrationPath, "utf8");

    expect(sql).toMatch(/min\(po\.issued_at\)/i);
    expect(sql).toMatch(/r\.submitted_at/i);
    expect(sql).toMatch(/po\.request_id\s*=\s*r\.id/i);
    expect(sql).not.toMatch(/r\.updated_at\s*-\s*r\.created_at/i);
    expect(sql).toMatch(
      /source_updated_at\s*<\s*current_timestamp\s*-\s*interval '24 hours'/i,
    );
  });

  it("makes export creation certification-aware at the RPC and storage boundary", () => {
    const sql = readFileSync(launchBlockerMigrationPath, "utf8");

    expect(sql).toMatch(
      /core\.has_live_cap\('insights',\s*'prepare_exports'\)/i,
    );
    expect(sql).toMatch(
      /core\.has_live_cap\('warehouse',\s*'register_exports'\)/i,
    );
    expect(sql).toMatch(/create policy warehouse_exports_insert/i);
    expect(sql).toMatch(/prepare_export_download_pre_insights_certification/i);
    expect(sql).toMatch(
      /warehouse_exports_read[\s\S]{0,1200}core\.has_live_cap\('insights',\s*'prepare_exports'\)/i,
    );
    expect(sql).not.toMatch(
      /warehouse_exports_insert[\s\S]{0,700}view_analytics/i,
    );
  });

  it("preserves the read-only projection and creates privacy-minimal accountable handoffs", () => {
    const sql = readFileSync(launchBlockerMigrationPath, "utf8");

    expect(sql).toMatch(
      /revoke all privileges on table core\.v_insights_snapshot/i,
    );
    expect(sql).toMatch(
      /grant select on table core\.v_insights_snapshot to authenticated/i,
    );
    expect(sql).toMatch(/reject_insights_snapshot_write/i);
    expect(sql).toMatch(/create table core\.insight_followups/i);
    expect(sql).toMatch(
      /create or replace function core\.request_insight_followup/i,
    );
    expect(sql).toMatch(/from core\.insights_snapshot\(\)/i);
    expect(sql).not.toMatch(/payload\s*->>\s*'detail'/i);
    expect(sql).not.toMatch(/payload\s*->>\s*'source_href'/i);
    expect(sql).not.toMatch(/payload\s*->>\s*'value'/i);
  });
});
