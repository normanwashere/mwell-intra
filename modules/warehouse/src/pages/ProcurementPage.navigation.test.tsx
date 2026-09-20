import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider, useSession, type UserCapabilities } from '@intra/auth';
import { can, roleCapabilities, type UserRoles } from '@intra/rbac';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WarehouseProvider } from '@/app/store';
import { modulesForWarehouseAccess, type WarehouseUiRole } from '@/app/modules';
import { isWarehouseCapability } from '@/auth/roles';
import { ToastProvider } from '@/components/ui';
import { makeRepo } from '@/test/renderWithProviders';
import { ProcurementPage } from './ProcurementPage';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';

// The separately tested live handoff panel does not participate in page-level link admission.
vi.mock('@/components/ReplenishmentControlPanel', () => ({ ReplenishmentControlPanel: () => null }));

const personas: [string, Partial<UserRoles>][] = [
  ['Platform Administrator', { core: ['staff', 'platform_admin'] }],
  ['General Employee', { core: ['staff'], warehouse: ['business_unit'], procurement: ['requester'], events: ['requester'], product: ['contributor'] }],
  ['Operations Associate', { core: ['staff'], warehouse: ['warehouse_operator', 'operations'] }],
  ['Operations Lead', { core: ['staff'], warehouse: ['warehouse_supervisor', 'logistics_supervisor'], procurement: ['approver'], product: ['operations_partner'] }],
  ['Procurement Lead', { core: ['staff'], warehouse: ['procurement'], procurement: ['procurement_officer', 'admin'] }],
  ['Finance Controller', { core: ['staff'], warehouse: ['finance'], procurement: ['finance'], events: ['finance_reviewer'] }],
  ['Legal & Compliance Lead', { core: ['staff'], legal: ['legal_reviewer', 'compliance', 'admin'] }],
  ['Marketing & Events Lead', { core: ['staff'], warehouse: ['marketing'], events: ['coordinator', 'admin'] }],
  ['Product Owner', { core: ['staff'], product: ['product_owner'], events: ['viewer'] }],
  ['Leadership / Insights', { core: ['staff'], warehouse: ['bi_analyst'], insights: ['analyst', 'manager', 'executive'] }],
  ['Vendor Representative', { core: ['vendor_portal'] }],
  ['Warehouse Operator', { warehouse: ['warehouse_operator'] }],
  ['Warehouse Supervisor', { warehouse: ['warehouse_supervisor'] }],
  ['Logistics Supervisor', { warehouse: ['logistics_supervisor'] }],
  ['eCommerce Operations', { warehouse: ['operations'] }],
  ['Pricing', { warehouse: ['pricing'] }],
  ['Warehouse Administrator', { warehouse: ['warehouse_admin'] }],
  ['Warehouse Operator + Supervisor', { warehouse: ['warehouse_operator', 'warehouse_supervisor'] }],
];

function projection(roles: Partial<UserRoles>): UserCapabilities {
  const result: UserCapabilities = {};
  for (const grant of roleCapabilities) {
    if (roles[grant.module]?.includes(grant.role)) {
      result[grant.module] = [...new Set([...(result[grant.module] ?? []), grant.cap])];
    }
  }
  return result;
}

function AccessReady() {
  const session = useSession();
  return session.profile && !session.loading && session.capabilityStatus === 'ready'
    ? <output aria-label="Current access">Ready</output> : null;
}

function renderPages(roles: Partial<UserRoles>, effective = projection(roles)) {
  const user = { id: 'navigation-actor', email: 'navigation@example.invalid', app_metadata: { roles }, user_metadata: {} };
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user, access_token: 'test' } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    schema: () => ({ rpc: vi.fn(async (name: string) => ({
      data: name === 'my_capability_snapshot' ? { roleCapabilities: projection(roles), userCapabilities: effective } : [], error: null,
    })) }),
  } as unknown as SupabaseClient;
  return render(<MemoryRouter><SessionProvider config={{ mode: 'supabase', client }}><ToastProvider>
    <AccessReady />
    <WarehouseProvider repo={makeRepo()} source="memory" initialRole="warehouse_admin">
      <ProcurementPage /><PurchaseOrdersPage />
    </WarehouseProvider>
  </ToastProvider></SessionProvider></MemoryRouter>);
}

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

describe('Sep20 destination contracts for the 18 reviewed personas', () => {
  it.each(personas)('%s renders only Procurement and Insights links its destination admits', async (_name, roles) => {
    const effective = projection(roles);
    const nav = modulesForWarehouseAccess('supabase', (roles.warehouse?.[0] ?? 'warehouse_admin') as WarehouseUiRole,
      capability => effective.warehouse?.includes(capability) === true,
      destination => destination === 'insights' ? can(roles, 'insights', 'view_warehouse') : can(roles, 'events', 'view_events'));
    for (const item of nav.filter(item => item.id === 'data' || item.id === 'reports')) {
      expect(can(roles, 'insights', 'view_warehouse'), item.id).toBe(true);
    }
    renderPages(roles, effective);
    await screen.findByLabelText('Current access');
    await screen.findByRole('heading', { name: 'Replenishment planning' });
    await screen.findByLabelText('Purchase orders');
    const canRead = can(roles, 'procurement', 'view_dashboard');
    if (canRead) expect(await screen.findByRole('link', { name: 'Open Procurement requests' })).toHaveAttribute('href', '/procurement/requests');
    else expect(screen.queryByRole('link', { name: 'Open Procurement requests' })).not.toBeInTheDocument();
    if (canRead && can(roles, 'procurement', 'create_request')) {
      expect(await screen.findByRole('link', { name: 'Create Procurement request' })).toHaveAttribute('href', '/procurement/requests/new');
    } else expect(screen.queryByRole('link', { name: 'Create Procurement request' })).not.toBeInTheDocument();
  });

  it.each([{ grants: [] }, { grants: ['create_request'] }, { grants: ['view_dashboard'] }])('requires current read AND create grants, despite mixed-role assignment ($grants)', async ({ grants }) => {
    const roles = { warehouse: ['warehouse_admin'], procurement: ['admin'] };
    const effective = { warehouse: projection(roles).warehouse?.filter(isWarehouseCapability), procurement: grants };
    renderPages(roles, effective);
    await screen.findByLabelText('Current access');
    await screen.findByRole('heading', { name: 'Replenishment planning' });
    await screen.findByLabelText('Purchase orders');
    expect(screen.queryByRole('link', { name: 'Create Procurement request' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole('link', { name: 'Open Procurement requests' })).toHaveLength(grants.includes('view_dashboard') ? 1 : 0));
  });
});
