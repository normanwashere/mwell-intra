import type { Capability } from '@/auth/roles';
import {
  WAREHOUSE_ROUTE_BY_ID,
  type WarehouseRouteId,
} from '@/app/modules';

export const WAREHOUSE_MUTATION_CAPABILITIES = {
  relocate: 'transfer_stock',
  inspectQuality: 'inspect_quality',
  releaseHold: 'release_quality_hold',
  createVendorReturn: 'manage_returns',
} as const satisfies Record<string, Capability>;

export const STOCK_CHANGE_DECISION_CAPABILITIES = [
  'approve_stock_adjustment',
  'approve_stock_adjustment_finance',
] as const satisfies readonly Capability[];

export function canOpenWarehouseRoute(
  routeId: WarehouseRouteId,
  canAccess: (capability: Capability) => boolean,
): boolean {
  return WAREHOUSE_ROUTE_BY_ID[routeId].gateCapabilityIds.some(canAccess);
}

export function warehouseRouteIdForPath(path: string): WarehouseRouteId | undefined {
  const actual = path.split(/[?#]/, 1)[0]!.split('/').filter(Boolean);
  return Object.values(WAREHOUSE_ROUTE_BY_ID).find((contract) => {
    const expected = contract.path.split('/').filter(Boolean);
    return expected.length === actual.length && expected.every(
      (segment, index) => segment.startsWith(':') || segment === actual[index],
    );
  })?.id;
}
