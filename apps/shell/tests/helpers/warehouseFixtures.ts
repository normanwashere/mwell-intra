import type { Page } from '@playwright/test';

export const WAREHOUSE_ROLES = [
  'warehouse_operator',
  'logistics_supervisor',
  'finance',
  'bi_analyst',
  'business_unit',
  'marketing',
  'procurement',
  'warehouse_admin',
] as const;

export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number];
export type AuditTheme = 'light' | 'dark';

const MEMORY_SESSION_KEY = 'intra.memory-session.v1';
const THEME_KEY = 'intra-theme';

const ROLE_PROFILE_IDS: Record<WarehouseRole, string> = {
  warehouse_operator: 'demo-warehouse-operator',
  logistics_supervisor: 'demo-logistics',
  finance: 'demo-finance',
  bi_analyst: 'demo-bi',
  business_unit: 'demo-business-unit',
  marketing: 'demo-marketing',
  procurement: 'demo-procurement',
  warehouse_admin: 'demo-warehouse-admin',
};

export const ROLE_ROUTES: Record<WarehouseRole, readonly string[]> = {
  warehouse_operator: ['/warehouse', '/warehouse/inventory', '/warehouse/receiving', '/warehouse/storage', '/warehouse/allocations', '/warehouse/cycle-counts', '/warehouse/returns', '/warehouse/quality', '/warehouse/exceptions', '/warehouse/scan'],
  logistics_supervisor: ['/warehouse', '/warehouse/receiving', '/warehouse/storage', '/warehouse/cycle-counts', '/warehouse/quality', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/imports', '/warehouse/operation-routes', '/warehouse/scan'],
  finance: ['/warehouse', '/warehouse/inventory', '/finance', '/warehouse/approvals', '/warehouse/exceptions'],
  bi_analyst: ['/warehouse', '/warehouse/inventory', '/warehouse/exceptions'],
  business_unit: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations'],
  marketing: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations'],
  procurement: ['/warehouse', '/warehouse/inventory', '/warehouse/procurement', '/warehouse/purchase-orders', '/warehouse/suppliers'],
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
      },
    },
  );
}

export function routeSlug(route: string): string {
  return route.replace(/^\/warehouse(?:\/|$)/, '').replace(/^\/+/, '').replaceAll('/', '-') || 'dashboard';
}
