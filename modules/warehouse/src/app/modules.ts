import type { Capability } from '@/auth/roles';
import type { Role } from '@/domain/types';
import { can } from '@/auth/roles';

export interface ModuleDef {
  id: string;
  label: string;
  path: string;
  /** Module is shown if the role has ANY of these capabilities. */
  capabilities: Capability[];
  /** Short description for cards/landing. */
  description: string;
  icon: string;
}

export const MODULES: ModuleDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    capabilities: ['view_dashboard'],
    description: 'KPIs, low-stock alerts and utilization at a glance.',
    icon: 'grid',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    capabilities: ['manage_inventory'],
    description:
      'Browse SKUs by category, size, serial, batch and location. Create & edit products with the manage-products tools.',
    icon: 'box',
  },
  {
    id: 'receiving',
    label: 'Receiving',
    path: '/receiving',
    capabilities: ['receive_stock'],
    description: 'Scan & tag incoming inventory with photo evidence.',
    icon: 'truck',
  },
  {
    id: 'allocations',
    label: 'Allocations',
    path: '/allocations',
    // reserve_allocate roles create reservations; issue_items roles (logistics) can issue
    capabilities: ['reserve_allocate', 'issue_items'],
    description: 'Reserve, issue and track items for activations.',
    icon: 'tag',
  },
  {
    id: 'events',
    label: 'Events',
    path: '/events',
    capabilities: ['reserve_allocate', 'view_finance'],
    description: 'Activations with consumption, costing and post-event reporting.',
    icon: 'calendar',
  },
  {
    id: 'cycle-counts',
    label: 'Cycle Counts',
    path: '/cycle-counts',
    capabilities: ['cycle_count'],
    description: 'Count by category and reconcile variances.',
    icon: 'clipboard',
  },
  {
    id: 'returns',
    label: 'Returns',
    path: '/returns',
    capabilities: ['manage_returns'],
    description: 'Log customer & vendor returns with reasons and disposition.',
    icon: 'rotate',
  },
  {
    id: 'procurement',
    label: 'Procurement',
    path: '/procurement',
    capabilities: ['view_procurement'],
    description: 'Reorder, stockout risk and supplier lead times.',
    icon: 'cart',
  },
  {
    id: 'purchase-orders',
    label: 'Purchase Orders',
    path: '/purchase-orders',
    // Procurement creates POs; the warehouse (receive_stock) reconciles receipts
    // against them, so both need the module.
    capabilities: ['view_procurement', 'receive_stock'],
    description: 'Create supplier POs and receive against them.',
    icon: 'list',
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    path: '/suppliers',
    capabilities: ['view_procurement'],
    description: 'Manage supplier information and lead times.',
    icon: 'building',
  },
  {
    id: 'storage',
    label: 'Storage areas',
    path: '/storage',
    // Anyone who physically handles stock benefits from scan-to-find; only
    // manage_locations roles can create/edit bins (enforced in-page).
    capabilities: ['receive_stock', 'manage_locations', 'transfer_stock', 'cycle_count'],
    description: 'Scannable bins & shelves — find where any order is stored.',
    icon: 'pin',
  },
  {
    id: 'locations',
    label: 'Locations',
    path: '/locations',
    capabilities: ['manage_locations'],
    description: 'Manage warehouses and event sites.',
    icon: 'building',
  },
  {
    id: 'finance',
    label: 'Finance',
    path: '/finance',
    capabilities: ['view_finance'],
    description: 'Valuation, costing, reconciliation and asset register.',
    icon: 'coins',
  },
  {
    id: 'pricing',
    label: 'Pricing',
    path: '/pricing',
    capabilities: ['view_pricing'],
    description: 'Landed cost, cost variance, turnover and bundle pricing.',
    icon: 'trend',
  },
  {
    id: 'data',
    label: 'Data & Reports',
    path: '/data',
    capabilities: ['view_analytics'],
    description: 'Raw data export, definitions and metric documentation.',
    icon: 'history',
  },
];

export function modulesForRole(role: Role): ModuleDef[] {
  return MODULES.filter((m) => m.capabilities.some((c) => can(role, c)));
}

/**
 * Preferred mobile bottom-nav order per role, so frequent action screens stay
 * one tap away instead of being buried under "More". IDs not visible to a role
 * are skipped; the set is topped up to 4 from the role's remaining modules.
 */
const MOBILE_PRIMARY: Partial<Record<Role, string[]>> = {
  logistics_supervisor: ['dashboard', 'receiving', 'cycle-counts', 'returns'],
  operations: ['dashboard', 'inventory', 'allocations', 'returns'],
  marketing: ['dashboard', 'inventory', 'allocations', 'returns'],
  finance: ['dashboard', 'finance', 'cycle-counts', 'inventory'],
  procurement: ['dashboard', 'procurement', 'purchase-orders', 'inventory'],
};

const MAX_PRIMARY = 4;

/** The (≤4) modules shown directly in the mobile bottom nav for a role. */
export function primaryModulesForRole(role: Role): ModuleDef[] {
  const visible = modulesForRole(role);
  if (visible.length <= MAX_PRIMARY) return visible;

  const pref = MOBILE_PRIMARY[role];
  if (!pref) return visible.slice(0, MAX_PRIMARY);

  const byId = new Map(visible.map((m) => [m.id, m]));
  const picked: ModuleDef[] = [];
  for (const id of pref) {
    const m = byId.get(id);
    if (m && !picked.includes(m)) picked.push(m);
    if (picked.length >= MAX_PRIMARY) break;
  }
  for (const m of visible) {
    if (picked.length >= MAX_PRIMARY) break;
    if (!picked.includes(m)) picked.push(m);
  }
  return picked.slice(0, MAX_PRIMARY);
}
