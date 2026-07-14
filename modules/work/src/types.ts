export type WorkSource = 'warehouse' | 'procurement' | 'legal' | 'events' | 'finance';
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
}

export interface WorkData { items: WorkItem[]; warnings: string[] }
