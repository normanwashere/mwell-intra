export type InsightArea =
  "warehouse" | "procurement" | "legal" | "finance" | "executive";
export type InsightTargetDirection =
  "minimum" | "maximum" | "range" | "informational";
export type InsightDataStatus = "current" | "no_data" | "incomplete";
export type InsightMetricStatus =
  | "critical"
  | "review"
  | "on_target"
  | "informational"
  | "no_data"
  | "incomplete";

export interface InsightMetric {
  id: string;
  area: InsightArea;
  label: string;
  value: number | null;
  unit?: string;
  targetDirection: InsightTargetDirection;
  targetMin?: number;
  targetMax?: number;
  dataStatus: InsightDataStatus;
  sampleCount: number;
  detail: string;
  sourceHref: string;
  reportingPeriodStart: string | null;
  reportingPeriodEnd: string | null;
  sourceUpdatedAt: string | null;
  extractedAt: string;
  status: InsightMetricStatus;
}

export interface InsightsData {
  metrics: InsightMetric[];
  extractedAt: string;
  warnings: string[];
}
