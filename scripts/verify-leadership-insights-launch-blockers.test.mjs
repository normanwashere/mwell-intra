import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canShowGovernedExport,
  getSnapshotTruth,
  resolveRequestedInsightArea,
  safeInsightFollowupPayload,
} from "../modules/insights/src/contracts.ts";

const root = new URL("../", import.meta.url);

test("snapshot truth is derived from source activity", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");
  const metrics = [
    {
      dataStatus: "current",
      sourceUpdatedAt: "2026-08-13T10:00:00.000Z",
    },
  ];

  assert.deepEqual(getSnapshotTruth(true, metrics, now), {
    label: "Stale source activity",
    tone: "amber",
    detail:
      "At least one visible indicator has source activity older than 24 hours. Validate the source before deciding.",
  });
});

test("deep-link area reconciles after accessible areas load", () => {
  assert.equal(
    resolveRequestedInsightArea("finance", ["executive", "finance"], "all"),
    "finance",
  );
  assert.equal(
    resolveRequestedInsightArea(
      "finance",
      ["warehouse", "executive", "finance"],
      "warehouse",
    ),
    "warehouse",
  );
  assert.equal(
    resolveRequestedInsightArea(
      "finance",
      ["executive", "finance"],
      "warehouse-disabled",
    ),
    "finance",
  );
});

test("governed export requires a certified analyst capability", () => {
  assert.equal(
    canShowGovernedExport("supabase", ["insights:analyst"], {
      insights: ["prepare_exports"],
    }),
    true,
  );
  assert.equal(
    canShowGovernedExport("supabase", ["insights:analyst"], { insights: [] }),
    false,
  );
  assert.equal(
    canShowGovernedExport("supabase", ["insights:admin"], {
      insights: ["prepare_exports"],
    }),
    false,
  );
});

test("follow-up payload excludes protected metric detail", () => {
  const payload = safeInsightFollowupPayload(
    {
      id: "fin-pr-cycle",
      detail: "Sensitive explanation",
      sourceHref: "/procurement/requests/secret",
      value: "PHP 10,000",
    },
    "validation",
    "stale_source",
    "insight-123",
  );

  assert.deepEqual(payload, {
    metric_id: "fin-pr-cycle",
    request_type: "validation",
    reason_code: "stale_source",
    idempotency_key: "insight-123",
  });
});

test("forward migration contains governed insights contracts", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260815183000_leadership_insights_launch_blockers.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /min\s*\(\s*po\.issued_at\s*\)/i);
  assert.match(sql, /po\.request_id\s*=\s*r\.id/i);
  assert.match(
    sql,
    /source_updated_at\s*<\s*current_timestamp\s*-\s*interval\s*'24 hours'/i,
  );
  assert.match(
    sql,
    /core\.has_live_cap\s*\(\s*'insights'\s*,\s*'prepare_exports'\s*\)/i,
  );
  assert.match(sql, /prepare_export_download_pre_insights_certification/i);
  assert.match(
    sql,
    /warehouse_exports_read[\s\S]{0,1200}core\.has_live_cap\s*\(\s*'insights'\s*,\s*'prepare_exports'\s*\)/i,
  );
  assert.match(sql, /create table(?: if not exists)? core\.insight_followups/i);
  assert.match(sql, /from core\.insights_snapshot\s*\(\s*\)/i);
  assert.doesNotMatch(sql, /payload\s*->>\s*'detail'/i);
  assert.doesNotMatch(sql, /payload\s*->>\s*'source_href'/i);
  assert.doesNotMatch(sql, /payload\s*->>\s*'value'/i);
});

test("knowledge role guidance names governed leadership actions", async () => {
  const roles = await readFile(
    new URL("../apps/shell/lib/knowledge/roles.ts", import.meta.url),
    "utf8",
  );

  assert.match(roles, /certified governed export/i);
  assert.match(roles, /protected detail/i);
  assert.match(roles, /request validation/i);
  assert.match(roles, /escalate (?:an )?indicator/i);
});

test("Insights UI exposes only governed commands with responsive hierarchy", async () => {
  const app = await readFile(
    new URL("../modules/insights/src/InsightsApp.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../apps/shell/app/api/insights/export/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(app, /Export governed snapshot/);
  assert.match(app, /Request validation|Escalate indicator/);
  assert.match(app, /resolveRequestedInsightArea/);
  assert.match(app, /Decision summary/);
  assert.match(app, /lg:grid-cols-2/);
  assert.match(route, /v_insights_snapshot/);
  assert.doesNotMatch(route, /\.(?:insert|update|delete|upsert)\s*\(/);
});
