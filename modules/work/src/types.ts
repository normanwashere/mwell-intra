export type WorkSource = 'warehouse' | 'procurement' | 'legal' | 'events' | 'finance' | 'product' | 'insights';
export type WorkPriority = 'critical' | 'high' | 'normal';
export type WorkFilter = 'all' | WorkSource;

export interface WorkItem {
  id: string;
  source: WorkSource;
  title: string;
  description: string;
  status: string;
  priority: WorkPriority;
  dueAt?: string;
  href: string;
  requiredCapabilities?: readonly WorkCapability[];
  sourceRecordExists?: boolean;
}

export interface WorkCapability {
  module: "core" | "warehouse" | "procurement" | "legal" | "events" | "insights" | "product";
  capability: string;
}

export interface WorkData { items: WorkItem[]; warnings: string[] }
