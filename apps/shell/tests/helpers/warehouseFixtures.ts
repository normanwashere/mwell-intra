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

export const ROLE_ROUTES: Record<WarehouseRole, readonly string[]> = {
  logistics_supervisor: ['/warehouse', '/warehouse/receiving', '/warehouse/storage', '/warehouse/cycle-counts', '/warehouse/quality', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/imports', '/warehouse/reports', '/warehouse/operation-routes', '/warehouse/scan'],
  operations: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations', '/warehouse/events', '/warehouse/returns', '/warehouse/quality', '/warehouse/exceptions', '/warehouse/scan'],
  finance: ['/warehouse', '/warehouse/inventory', '/warehouse/events', '/warehouse/cycle-counts', '/warehouse/finance', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/reports'],
  bi_analyst: ['/warehouse', '/warehouse/inventory', '/warehouse/data', '/warehouse/reports', '/warehouse/exceptions'],
  business_unit: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations'],
  marketing: ['/warehouse', '/warehouse/inventory', '/warehouse/allocations', '/warehouse/returns'],
  procurement: ['/warehouse', '/warehouse/inventory', '/warehouse/procurement', '/warehouse/purchase-orders', '/warehouse/suppliers', '/warehouse/reports'],
  pricing: ['/warehouse', '/warehouse/inventory', '/warehouse/pricing', '/warehouse/finance'],
  warehouse_admin: ['/warehouse', '/warehouse/inventory', '/warehouse/receiving', '/warehouse/storage', '/warehouse/allocations', '/warehouse/events', '/warehouse/cycle-counts', '/warehouse/returns', '/warehouse/quality', '/warehouse/approvals', '/warehouse/exceptions', '/warehouse/imports', '/warehouse/reports', '/warehouse/operation-routes', '/warehouse/scan'],
};

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
        profileId: role === 'warehouse_admin' ? 'demo-warehouse-admin' : 'demo-operations',
        roles: { core: ['staff'], warehouse: [role] },
      },
    },
  );
}

export function routeSlug(route: string): string {
  return route.replace(/^\/warehouse\/?/, '').replaceAll('/', '-') || 'dashboard';
}
