import type { ModuleDefinition } from '../contracts';

export type InsightsCapability =
  | 'view_warehouse'
  | 'view_procurement'
  | 'view_legal'
  | 'view_finance'
  | 'view_executive'
  | 'prepare_exports'
  | 'admin';

export type InsightsRole = 'analyst' | 'manager' | 'executive' | 'admin';

const INSIGHTS_CAPABILITIES = [
  'view_warehouse',
  'view_procurement',
  'view_legal',
  'view_finance',
  'view_executive',
  'prepare_exports',
  'admin',
] as const satisfies readonly InsightsCapability[];

export const insightsModule: ModuleDefinition<
  'insights',
  InsightsRole,
  InsightsCapability
> = {
  module: 'insights',
  label: 'Insights',
  capabilities: INSIGHTS_CAPABILITIES,
  roles: {
    analyst: {
      label: 'Data Analyst',
      description: 'Reviews source-level operational data and prepares exports.',
      capabilities: [
        'view_warehouse',
        'view_procurement',
        'view_legal',
        'view_finance',
        'prepare_exports',
      ],
    },
    manager: {
      label: 'Department Manager',
      description: 'Reviews department summaries and executive indicators.',
      capabilities: [
        'view_warehouse',
        'view_procurement',
        'view_legal',
        'view_finance',
        'view_executive',
      ],
    },
    executive: {
      label: 'Executive',
      description: 'Reviews the cross-department executive summary.',
      capabilities: ['view_executive'],
    },
    admin: {
      label: 'Insights Administrator',
      description: 'Full insights workspace administration.',
      capabilities: [...INSIGHTS_CAPABILITIES],
    },
  },
};
