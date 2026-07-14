import type { Page } from '@playwright/test';

export const WAREHOUSE_ROLES = [
  'logistics_supervisor',
  'operations',
  'finance',
  'bi_analyst',
  'business_unit',
  'marketing',
  'procurement',
  'pricing',
  'warehouse_admin',
] as const;

export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number];
export type AuditTheme = 'light' | 'dark';

const MEMORY_SESSION_KEY = 'intra.memory-session.v1';
const THEME_KEY = 'intra-theme';

const ROLE_PROFILE_IDS: Record<WarehouseRole, string> = {
  logistics_supervisor: 'demo-logistics',
  operations: 'demo-operations',
  finance: 'demo-finance',
  bi_analyst: 'demo-bi',
  business_unit: 'demo-business-unit',
  marketing: 'demo-marketing',
  procurement: 'demo-logistics',
  pricing: 'demo-pricing',
  warehouse_admin: 'demo-warehouse-admin',
};

const CROSS_WORKSPACE_GRANTS: Partial<
  Record<WarehouseRole, Record<string, readonly string[]>>
> = {
  bi_analyst: { insights: ['analyst'] },
  business_unit: { events: ['requester'] },
  marketing: { events: ['coordinator'] },
  warehouse_admin: { events: ['admin'], insights: ['admin'] },
};

export const ROLE_ROUTES: Record<WarehouseRole, readonly string[]> = {
  logistics_supervisor: ['/warehouse', '/warehouse/receiving', '/warehouse/storage', '/warehouse/cycle-counts', '/warehouse/quality', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/imports', '/warehouse/operation-routes', '/warehouse/scan'],
  operations: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations', '/warehouse/returns', '/warehouse/quality', '/warehouse/exceptions', '/warehouse/scan'],
  finance: ['/warehouse', '/warehouse/inventory', '/warehouse/cycle-counts', '/finance', '/warehouse/approvals', '/warehouse/exceptions'],
  bi_analyst: ['/warehouse', '/warehouse/inventory', '/warehouse/exceptions'],
  business_unit: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations'],
  marketing: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations', '/warehouse/returns'],
  procurement: ['/warehouse', '/warehouse/inventory', '/warehouse/procurement', '/warehouse/purchase-orders', '/warehouse/suppliers'],
  pricing: ['/warehouse', '/warehouse/inventory', '/warehouse/pricing', '/finance'],
  warehouse_admin: ['/warehouse', '/warehouse/inventory', '/warehouse/receiving', '/warehouse/storage', '/warehouse/allocations', '/warehouse/cycle-counts', '/warehouse/returns', '/warehouse/quality', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/imports', '/warehouse/operation-routes', '/warehouse/scan'],
};

export const CANONICAL_WORKSPACE_ROUTES = [
  { role: 'marketing', route: '/events' },
  { role: 'bi_analyst', route: '/insights/warehouse' },
] as const satisfies readonly { role: WarehouseRole; route: string }[];

export async function installWarehouseSession(
  page: Page,
  role: WarehouseRole,
  theme: AuditTheme = 'light',
): Promise<void> {
  await page.addInitScript(
    ({ sessionKey, themeKey, session, selectedTheme }) => {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
      window.localStorage.setItem(themeKey, selectedTheme);
    },
    {
      sessionKey: MEMORY_SESSION_KEY,
      themeKey: THEME_KEY,
      selectedTheme: theme,
      session: {
        profileId: ROLE_PROFILE_IDS[role],
        roles: {
          core: ['staff'],
          warehouse: [role],
          ...CROSS_WORKSPACE_GRANTS[role],
        },
      },
    },
  );
}

export function routeSlug(route: string): string {
  return route.replace(/^\/warehouse(?:\/|$)/, '').replace(/^\/+/, '').replaceAll('/', '-') || 'dashboard';
}
