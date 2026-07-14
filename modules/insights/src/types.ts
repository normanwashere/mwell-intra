export type InsightArea = 'warehouse' | 'procurement' | 'legal' | 'finance' | 'executive';
export interface InsightMetric { id: string; area: InsightArea; label: string; value: number; unit?: string; target?: number; detail: string; sourceHref: string }
export interface InsightsData { metrics: InsightMetric[]; updatedAt: string; warnings: string[] }
