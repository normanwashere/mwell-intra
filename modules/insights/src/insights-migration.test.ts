import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260722124731_insights_correctness_and_provenance.sql",
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
});
